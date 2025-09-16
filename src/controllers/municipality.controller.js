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

    // Validate required fields
    if (!name || !district || !adminId || !coordinates) {
        throw new ApiError(400, "Name, district, admin ID, and coordinates are required");
    }

    // Validate admin user exists and has proper role
    const adminUser = await User.findById(adminId);
    if (!adminUser) {
        throw new ApiError(404, "Admin user not found");
    }

    if (!["admin", "superadmin"].includes(adminUser.role)) {
        throw new ApiError(400, "User must have admin or superadmin role");
    }

    // Check if municipality already exists
    const existingMunicipality = await Municipality.findOne({
        name: { $regex: new RegExp(name, 'i') },
        district: { $regex: new RegExp(district, 'i') }
    });

    if (existingMunicipality) {
        throw new ApiError(409, "Municipality already exists in this district");
    }

    // Create municipality
    const municipality = await Municipality.create({
        name: name.trim(),
        state: state || "Jharkhand",
        district: district.trim(),
        admin: adminId,
        location: {
            type: "Point",
            coordinates: coordinates // [longitude, latitude]
        }
    });

    const populatedMunicipality = await Municipality.findById(municipality._id)
        .populate('admin', 'name email username role');

    res.status(201).json(
        new ApiResponse(201, populatedMunicipality, "Municipality created successfully")
    );
});

// Get all municipalities with advanced filtering and pagination
export const getAllMunicipalities = asyncHandler(async (req, res) => {
    const {
        page = 1,
        limit = 10,
        district,
        state,
        search,
        adminId,
        hasReports,
        sortBy = "name",
        sortOrder = "asc"
    } = req.query;

    // Build filter object
    const filter = {};
    if (district) filter.district = { $regex: district, $options: 'i' };
    if (state) filter.state = { $regex: state, $options: 'i' };
    if (adminId) filter.admin = adminId;

    // Add search functionality
    if (search) {
        filter.$or = [
            { name: { $regex: search, $options: 'i' } },
            { district: { $regex: search, $options: 'i' } }
        ];
    }

    // Sort configuration
    const sortConfig = {};
    sortConfig[sortBy] = sortOrder === "desc" ? -1 : 1;

    // Execute query with pagination
    const municipalities = await Municipality.find(filter)
        .populate('admin', 'name email username role')
        .populate('departments', 'name description categories')
        .sort(sortConfig)
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .exec();

    const totalMunicipalities = await Municipality.countDocuments(filter);

    // Add comprehensive statistics for each municipality
    const municipalitiesWithStats = await Promise.all(
        municipalities.map(async (municipality) => {
            const reportStats = await Report.aggregate([
                { $match: { municipality: municipality._id } },
                {
                    $group: {
                        _id: null,
                        totalReports: { $sum: 1 },
                        pendingReports: {
                            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] }
                        },
                        inProgressReports: {
                            $sum: { $cond: [{ $eq: ["$status", "in-progress"] }, 1, 0] }
                        },
                        resolvedReports: {
                            $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] }
                        },
                        avgRating: { $avg: "$rating" },
                        totalUpvotes: { $sum: "$upvoteCount" },
                        highPriorityCount: {
                            $sum: { $cond: [{ $gte: ["$priority", 4] }, 1, 0] }
                        }
                    }
                }
            ]);

            const municipalityObj = municipality.toObject();
            municipalityObj.stats = reportStats || {
                totalReports: 0,
                pendingReports: 0,
                inProgressReports: 0,
                resolvedReports: 0,
                avgRating: 0,
                totalUpvotes: 0,
                highPriorityCount: 0
            };

            return municipalityObj;
        })
    );

    // Filter by hasReports if specified
    const filteredMunicipalities = hasReports === 'true' 
        ? municipalitiesWithStats.filter(m => m.stats.totalReports > 0)
        : hasReports === 'false'
        ? municipalitiesWithStats.filter(m => m.stats.totalReports === 0)
        : municipalitiesWithStats;

    res.status(200).json(
        new ApiResponse(200, {
            municipalities: filteredMunicipalities,
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

// Get municipality by ID with comprehensive details
export const getMunicipalityById = asyncHandler(async (req, res) => {
    const { municipalityId } = req.params;

    const municipality = await Municipality.findById(municipalityId)
        .populate('admin', 'name email username role avatar')
        .populate('departments', 'name description categories')
        .populate({
            path: 'reports',
            select: 'title category status priority upvoteCount createdAt',
            options: { sort: { createdAt: -1 }, limit: 10 }
        });

    if (!municipality) {
        throw new ApiError(404, "Municipality not found");
    }

    // Get comprehensive statistics
    const stats = await Report.aggregate([
        { $match: { municipality: municipality._id } },
        {
            $group: {
                _id: null,
                totalReports: { $sum: 1 },
                pendingReports: {
                    $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] }
                },
                inProgressReports: {
                    $sum: { $cond: [{ $eq: ["$status", "in-progress"] }, 1, 0] }
                },
                resolvedReports: {
                    $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] }
                },
                avgRating: { $avg: "$rating" },
                avgPriority: { $avg: "$priority" },
                totalUpvotes: { $sum: "$upvoteCount" }
            }
        }
    ]);

    // Get category-wise distribution
    const categoryStats = await Report.aggregate([
        { $match: { municipality: municipality._id } },
        {
            $group: {
                _id: "$category",
                count: { $sum: 1 },
                avgPriority: { $avg: "$priority" }
            }
        },
        { $sort: { count: -1 } }
    ]);

    // Get monthly report trends
    const monthlyTrends = await Report.aggregate([
        { $match: { municipality: municipality._id } },
        {
            $group: {
                _id: {
                    year: { $year: "$createdAt" },
                    month: { $month: "$createdAt" }
                },
                count: { $sum: 1 }
            }
        },
        { $sort: { "_id.year": -1, "_id.month": -1 } },
        { $limit: 12 }
    ]);

    const municipalityData = municipality.toObject();
    municipalityData.stats = stats || {
        totalReports: 0,
        pendingReports: 0,
        inProgressReports: 0,
        resolvedReports: 0,
        avgRating: 0,
        avgPriority: 0,
        totalUpvotes: 0
    };
    municipalityData.categoryStats = categoryStats;
    municipalityData.monthlyTrends = monthlyTrends;

    res.status(200).json(
        new ApiResponse(200, municipalityData, "Municipality retrieved successfully")
    );
});

// Update municipality (Admin/Super Admin only)
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
        if (!adminUser) {
            throw new ApiError(404, "Admin user not found");
        }
        if (!["admin", "superadmin"].includes(adminUser.role)) {
            throw new ApiError(400, "User must have admin or superadmin role");
        }
    }

    // Update fields if provided
    if (name) municipality.name = name.trim();
    if (district) municipality.district = district.trim();
    if (state) municipality.state = state;
    if (adminId) municipality.admin = adminId;
    if (coordinates) {
        municipality.location = {
            type: "Point",
            coordinates: coordinates
        };
    }

    await municipality.save();

    const updatedMunicipality = await Municipality.findById(municipalityId)
        .populate('admin', 'name email username role')
        .populate('departments', 'name description');

    res.status(200).json(
        new ApiResponse(200, updatedMunicipality, "Municipality updated successfully")
    );
});

// Add department to municipality
export const addDepartmentToMunicipality = asyncHandler(async (req, res) => {
    const { municipalityId } = req.params;
    const { name, description, categories, contactPerson } = req.body;

    if (!name || !categories || categories.length === 0) {
        throw new ApiError(400, "Department name and categories are required");
    }

    const municipality = await Municipality.findById(municipalityId);
    if (!municipality) {
        throw new ApiError(404, "Municipality not found");
    }

    // Check if department already exists in this municipality
    const existingDepartment = await Department.findOne({
        name: { $regex: new RegExp(name, 'i') },
        municipality: municipalityId
    });

    if (existingDepartment) {
        throw new ApiError(409, "Department with this name already exists in this municipality");
    }

    // Create new department
    const department = await Department.create({
        name: name.trim(),
        description: description || "",
        municipality: municipalityId,
        categories,
        contactPerson
    });

    // Add department to municipality
    municipality.departments.push(department._id);
    await municipality.save();

    const updatedMunicipality = await Municipality.findById(municipalityId)
        .populate('departments', 'name description categories')
        .populate('admin', 'name email username role');

    res.status(201).json(
        new ApiResponse(201, updatedMunicipality, "Department added to municipality successfully")
    );
});

// Remove department from municipality
export const removeDepartmentFromMunicipality = asyncHandler(async (req, res) => {
    const { municipalityId, departmentId } = req.params;

    const municipality = await Municipality.findById(municipalityId);
    if (!municipality) {
        throw new ApiError(404, "Municipality not found");
    }

    const department = await Department.findById(departmentId);
    if (!department) {
        throw new ApiError(404, "Department not found");
    }

    // Check if department has any reports
    const reportCount = await Report.countDocuments({ department: departmentId });
    if (reportCount > 0) {
        throw new ApiError(400, "Cannot remove department with existing reports");
    }

    // Remove department from municipality
    municipality.departments = municipality.departments.filter(
        dept => dept.toString() !== departmentId
    );
    await municipality.save();

    // Delete the department
    await Department.findByIdAndDelete(departmentId);

    const updatedMunicipality = await Municipality.findById(municipalityId)
        .populate('departments', 'name description categories')
        .populate('admin', 'name email username role');

    res.status(200).json(
        new ApiResponse(200, updatedMunicipality, "Department removed from municipality successfully")
    );
});

// Get municipalities near a location
export const getMunicipalitiesNearLocation = asyncHandler(async (req, res) => {
    const { longitude, latitude, maxDistance = 50000 } = req.query; // default 50km

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
    .limit(20);

    res.status(200).json(
        new ApiResponse(200, municipalities, "Nearby municipalities retrieved successfully")
    );
});

// Get municipality analytics/dashboard data
export const getMunicipalityAnalytics = asyncHandler(async (req, res) => {
    const { municipalityId } = req.params;
    const { timeframe = '30d' } = req.query; // 7d, 30d, 90d, 1y

    const municipality = await Municipality.findById(municipalityId);
    if (!municipality) {
        throw new ApiError(404, "Municipality not found");
    }

    // Calculate date range based on timeframe
    const now = new Date();
    const timeframeMap = {
        '7d': 7,
        '30d': 30,
        '90d': 90,
        '1y': 365
    };
    const daysBack = timeframeMap[timeframe] || 30;
    const startDate = new Date(now.getTime() - (daysBack * 24 * 60 * 60 * 1000));

    // Get analytics data
    const analytics = await Report.aggregate([
        { 
            $match: { 
                municipality: municipality._id,
                createdAt: { $gte: startDate }
            } 
        },
        {
            $facet: {
                totalStats: [
                    {
                        $group: {
                            _id: null,
                            totalReports: { $sum: 1 },
                            avgRating: { $avg: "$rating" },
                            avgPriority: { $avg: "$priority" },
                            totalUpvotes: { $sum: "$upvoteCount" }
                        }
                    }
                ],
                statusDistribution: [
                    {
                        $group: {
                            _id: "$status",
                            count: { $sum: 1 }
                        }
                    }
                ],
                categoryDistribution: [
                    {
                        $group: {
                            _id: "$category",
                            count: { $sum: 1 },
                            avgPriority: { $avg: "$priority" }
                        }
                    },
                    { $sort: { count: -1 } }
                ],
                dailyTrends: [
                    {
                        $group: {
                            _id: {
                                date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } }
                            },
                            count: { $sum: 1 }
                        }
                    },
                    { $sort: { "_id.date": 1 } }
                ]
            }
        }
    ]);

    res.status(200).json(
        new ApiResponse(200, {
            municipality: municipality.name,
            timeframe,
            analytics: analytics
        }, "Municipality analytics retrieved successfully")
    );
});

// Delete municipality (Super Admin only)
export const deleteMunicipality = asyncHandler(async (req, res) => {
    const { municipalityId } = req.params;

    const municipality = await Municipality.findById(municipalityId);
    if (!municipality) {
        throw new ApiError(404, "Municipality not found");
    }

    // Check if municipality has any reports
    const reportCount = await Report.countDocuments({ municipality: municipalityId });
    if (reportCount > 0) {
        throw new ApiError(400, "Cannot delete municipality with existing reports. Transfer or resolve reports first.");
    }

    // Delete all departments in this municipality
    await Department.deleteMany({ municipality: municipalityId });

    // Delete the municipality
    await Municipality.findByIdAndDelete(municipalityId);

    res.status(200).json(
        new ApiResponse(200, {}, "Municipality and associated departments deleted successfully")
    );
});
