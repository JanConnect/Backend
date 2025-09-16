import { Municipality } from "../models/municipality.model.js";
import { Department } from "../models/department.model.js";
import { Report } from "../models/report.model.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Create new municipality (Super Admin only)
export const createMunicipality = asyncHandler(async (req, res) => {
    const { name, district, state, adminId, coordinates } = req.body;

    if (!name || !district || !adminId || !coordinates) {
        throw new ApiError(400, "Name, district, admin ID, and coordinates are required");
    }

    // Validate admin user
    const adminUser = await User.findById(adminId);
    if (!adminUser || !["admin", "superadmin"].includes(adminUser.role)) {
        throw new ApiError(400, "Invalid admin user or insufficient permissions");
    }

    // Check for existing municipality
    const existingMunicipality = await Municipality.findOne({
        name: { $regex: new RegExp(name, 'i') },
        district: { $regex: new RegExp(district, 'i') }
    });

    if (existingMunicipality) {
        throw new ApiError(409, "Municipality already exists in this district");
    }

    // Create municipality with initialized stats
    const municipality = await Municipality.create({
        name: name.trim(),
        state: state || "Jharkhand",
        district: district.trim(),
        admin: adminId,
        location: {
            type: "Point",
            coordinates: coordinates
        },
        stats: {
            reports: {
                total: 0, pending: 0, inProgress: 0, completed: 0, rejected: 0, pendingAssignment: 0
            },
            assignment: {
                autoAssigned: 0, manualAssigned: 0, unassigned: 0, assignmentRate: 0
            },
            categories: {
                infrastructure: 0, sanitation: 0, streetLighting: 0,
                waterSupply: 0, traffic: 0, parks: 0, other: 0
            },
            priority: { low: 0, medium: 0, high: 0, critical: 0 },
            performance: {
                avgResolutionTime: 0, completionRate: 0, citizenSatisfaction: 0,
                responseTimeAvg: 0, totalUpvotes: 0, avgPriority: 0
            },
            realtime: {
                lastUpdated: new Date(),
                currentLoad: 0,
                alertLevel: 'low',
                systemHealth: 100
            }
        }
    });

    const populatedMunicipality = await Municipality.findById(municipality._id)
        .populate('admin', 'name email username role');

    res.status(201).json(
        new ApiResponse(201, populatedMunicipality, "Municipality created successfully")
    );
});

// Get all municipalities with stats
export const getAllMunicipalities = asyncHandler(async (req, res) => {
    const {
        page = 1,
        limit = 10,
        district,
        state,
        search,
        sortBy = "name",
        sortOrder = "asc",
        alertLevel,
        minCompletionRate
    } = req.query;

    const filter = {};
    if (district) filter.district = { $regex: district, $options: 'i' };
    if (state) filter.state = { $regex: state, $options: 'i' };
    if (alertLevel) filter['stats.realtime.alertLevel'] = alertLevel;
    if (minCompletionRate) filter['stats.performance.completionRate'] = { $gte: parseInt(minCompletionRate) };

    if (search) {
        filter.$or = [
            { name: { $regex: search, $options: 'i' } },
            { district: { $regex: search, $options: 'i' } }
        ];
    }

    const sortConfig = {};
    sortConfig[sortBy] = sortOrder === "desc" ? -1 : 1;

    const municipalities = await Municipality.find(filter)
        .populate('admin', 'name email username role')
        .populate('departments', 'name categories')
        .sort(sortConfig)
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .exec();

    const totalMunicipalities = await Municipality.countDocuments(filter);

    // Update real-time stats for all municipalities
    await Promise.all(municipalities.map(municipality => municipality.updateRealTimeStats()));

    res.status(200).json(
        new ApiResponse(200, {
            municipalities: municipalities.map(m => m.getDashboardData()),
            pagination: {
                totalPages: Math.ceil(totalMunicipalities / limit),
                currentPage: parseInt(page),
                totalMunicipalities,
                hasNextPage: page < Math.ceil(totalMunicipalities / limit),
                hasPrevPage: page > 1,
                limit: parseInt(limit)
            }
        }, "Municipalities retrieved successfully")
    );
});

// Get municipality by ID with comprehensive stats
export const getMunicipalityById = asyncHandler(async (req, res) => {
    const { municipalityId } = req.params;

    const municipality = await Municipality.findById(municipalityId)
        .populate('admin', 'name email username role avatar')
        .populate({
            path: 'departments',
            populate: {
                path: 'staffMembers.userId',
                select: 'name username role'
            }
        })
        .populate({
            path: 'reports',
            select: 'title category status priority upvoteCount createdAt',
            options: { sort: { createdAt: -1 }, limit: 20 }
        });

    if (!municipality) {
        throw new ApiError(404, "Municipality not found");
    }

    // Calculate comprehensive stats
    await municipality.calculateComprehensiveStats();

    res.status(200).json(
        new ApiResponse(200, municipality, "Municipality retrieved successfully")
    );
});

// Update municipality
export const updateMunicipality = asyncHandler(async (req, res) => {
    const { municipalityId } = req.params;
    const { name, district, state, adminId, coordinates } = req.body;

    const municipality = await Municipality.findById(municipalityId);
    if (!municipality) {
        throw new ApiError(404, "Municipality not found");
    }

    // Validate new admin if provided
    if (adminId) {
        const adminUser = await User.findById(adminId);
        if (!adminUser || !["admin", "superadmin"].includes(adminUser.role)) {
            throw new ApiError(400, "Invalid admin user");
        }
        municipality.admin = adminId;
    }

    // Update fields
    if (name) municipality.name = name.trim();
    if (district) municipality.district = district.trim();
    if (state) municipality.state = state;
    if (coordinates) {
        municipality.location = {
            type: "Point",
            coordinates: coordinates
        };
    }

    await municipality.save();

    const updatedMunicipality = await Municipality.findById(municipalityId)
        .populate('admin', 'name email username role')
        .populate('departments', 'name categories');

    res.status(200).json(
        new ApiResponse(200, updatedMunicipality, "Municipality updated successfully")
    );
});

// Add department to municipality
export const addDepartmentToMunicipality = asyncHandler(async (req, res) => {
    const { municipalityId } = req.params;
    const { name, description, categories } = req.body;

    if (!name || !categories || categories.length === 0) {
        throw new ApiError(400, "Department name and categories are required");
    }

    const municipality = await Municipality.findById(municipalityId);
    if (!municipality) {
        throw new ApiError(404, "Municipality not found");
    }

    // Check for existing department
    const existingDepartment = await Department.findOne({
        name: { $regex: new RegExp(name, 'i') },
        municipality: municipalityId
    });

    if (existingDepartment) {
        throw new ApiError(409, "Department already exists in this municipality");
    }

    // Create department with initialized stats
    const department = await Department.create({
        name: name.trim(),
        description: description || "",
        municipality: municipalityId,
        categories,
        staffMembers: [],
        reports: [],
        stats: {
            totalReports: 0,
            pendingReports: 0,
            inProgressReports: 0,
            completedReports: 0,
            rejectedReports: 0,
            autoAssignedReports: 0,
            manualAssignedReports: 0,
            priorityDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
            performance: {
                avgResolutionTime: 0,
                completionRate: 0,
                avgRating: 0,
                totalUpvotes: 0,
                responseTimeAvg: 0
            },
            lastUpdated: new Date()
        }
    });

    // Add to municipality
    municipality.departments.push(department._id);
    municipality.stats.resources.departmentCount = municipality.departments.length;
    await municipality.save();

    res.status(201).json(
        new ApiResponse(201, department, "Department added successfully")
    );
});

// Get municipality analytics/dashboard
export const getMunicipalityAnalytics = asyncHandler(async (req, res) => {
    const { municipalityId } = req.params;
    const { timeframe = '30d' } = req.query;

    const municipality = await Municipality.findById(municipalityId);
    if (!municipality) {
        throw new ApiError(404, "Municipality not found");
    }

    // Calculate comprehensive stats
    await municipality.calculateComprehensiveStats();

    // Get dashboard data
    const dashboardData = municipality.getDashboardData();

    // Add additional analytics based on timeframe
    const timeframeMap = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
    const daysBack = timeframeMap[timeframe] || 30;
    const startDate = new Date(Date.now() - (daysBack * 24 * 60 * 60 * 1000));

    const timeBasedReports = await Report.find({
        municipality: municipalityId,
        createdAt: { $gte: startDate }
    });

    const analyticsData = {
        ...dashboardData,
        timeframe: {
            period: timeframe,
            reportCount: timeBasedReports.length,
            completionRate: timeBasedReports.length ? 
                (timeBasedReports.filter(r => r.status === 'completed').length / timeBasedReports.length) * 100 : 0,
            avgPriority: timeBasedReports.length ?
                timeBasedReports.reduce((acc, r) => acc + r.priority, 0) / timeBasedReports.length : 0
        },
        departmentComparison: municipality.stats.departmentPerformance
            .sort((a, b) => b.completionRate - a.completionRate),
        systemHealth: {
            score: municipality.stats.realtime.systemHealth,
            alertLevel: municipality.stats.realtime.alertLevel,
            currentLoad: municipality.stats.realtime.currentLoad
        }
    };

    res.status(200).json(
        new ApiResponse(200, analyticsData, "Municipality analytics retrieved successfully")
    );
});

// Get municipalities near location
export const getMunicipalitiesNearLocation = asyncHandler(async (req, res) => {
    const { longitude, latitude, maxDistance = 50000 } = req.query;

    if (!longitude || !latitude) {
        throw new ApiError(400, "Longitude and latitude are required");
    }

    const municipalities = await Municipality.find({
        location: {
            $near: {
                $geometry: {
                    type: "Point",
                    coordinates: [parseFloat(longitude), parseFloat(latitude)]
                },
                $maxDistance: parseInt(maxDistance)
            }
        }
    })
    .populate('admin', 'name email username role')
    .populate('departments', 'name categories')
    .limit(10);

    res.status(200).json(
        new ApiResponse(200, municipalities.map(m => m.getDashboardData()), 
        "Nearby municipalities retrieved successfully")
    );
});

// Manual assignment of "Other" category reports
export const manualAssignReport = asyncHandler(async (req, res) => {
    const { municipalityId } = req.params;
    const { reportId, departmentId, staffId } = req.body;
    const adminId = req.user._id;

    // Verify municipality admin
    const municipality = await Municipality.findById(municipalityId);
    if (!municipality || municipality.admin.toString() !== adminId.toString()) {
        throw new ApiError(403, "Only municipality admin can manually assign reports");
    }

    const report = await Report.findById(reportId);
    if (!report || report.municipality.toString() !== municipalityId) {
        throw new ApiError(404, "Report not found");
    }

    const department = await Department.findById(departmentId);
    if (!department || department.municipality.toString() !== municipalityId) {
        throw new ApiError(404, "Department not found");
    }

    // Assign report to department
    await Department.manualAssign(reportId, departmentId, adminId, staffId);

    // Update report
    await Report.findByIdAndUpdate(reportId, {
        department: departmentId,
        assignedTo: staffId,
        status: "assigned"
    });

    // Update municipality stats
    municipality.stats.assignment.manualAssigned += 1;
    municipality.stats.assignment.assignmentRate = 
        ((municipality.stats.assignment.autoAssigned + municipality.stats.assignment.manualAssigned) / 
         municipality.stats.reports.total) * 100;
    
    await municipality.save();

    res.status(200).json(
        new ApiResponse(200, {}, "Report manually assigned successfully")
    );
});

// Delete municipality (Super Admin only)
export const deleteMunicipality = asyncHandler(async (req, res) => {
    const { municipalityId } = req.params;

    const municipality = await Municipality.findById(municipalityId);
    if (!municipality) {
        throw new ApiError(404, "Municipality not found");
    }

    // Check for existing reports
    const reportCount = await Report.countDocuments({ municipality: municipalityId });
    if (reportCount > 0) {
        throw new ApiError(400, "Cannot delete municipality with existing reports");
    }

    // Delete all departments
    await Department.deleteMany({ municipality: municipalityId });

    // Delete municipality
    await Municipality.findByIdAndDelete(municipalityId);

    res.status(200).json(
        new ApiResponse(200, {}, "Municipality deleted successfully")
    );
});
