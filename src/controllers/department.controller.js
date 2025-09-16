import { Department } from "../models/department.model.js";
import { Municipality } from "../models/municipality.model.js";
import { Report } from "../models/report.model.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Create new department (Admin only)
export const createDepartment = asyncHandler(async (req, res) => {
    const { name, description, municipality, categories } = req.body;

    // Validate required fields
    if (!name || !municipality || !categories || categories.length === 0) {
        throw new ApiError(400, "Name, municipality, and categories are required");
    }

    // Check if municipality exists
    const municipalityExists = await Municipality.findById(municipality);
    if (!municipalityExists) {
        throw new ApiError(404, "Municipality not found");
    }

    // Check if department with same name exists in this municipality
    const existingDepartment = await Department.findOne({
        name: { $regex: new RegExp(name, 'i') },
        municipality
    });

    if (existingDepartment) {
        throw new ApiError(409, "Department with this name already exists in the municipality");
    }

    // Create department with initialized stats
    const department = await Department.create({
        name: name.trim(),
        description: description || "",
        municipality,
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
            categoryStats: categories.map(cat => ({
                category: cat,
                totalReports: 0,
                completedReports: 0,
                avgResolutionTime: 0,
                completionRate: 0
            })),
            performance: {
                avgResolutionTime: 0,
                completionRate: 0,
                avgRating: 0,
                totalUpvotes: 0,
                responseTimeAvg: 0
            },
            staffPerformance: [],
            lastUpdated: new Date()
        }
    });

    // Add department to municipality's departments array
    municipalityExists.departments.push(department._id);
    await municipalityExists.save();

    const populatedDepartment = await Department.findById(department._id)
        .populate('municipality', 'name district')
        .populate('staffMembers.userId', 'name username role');

    res.status(201).json(
        new ApiResponse(201, populatedDepartment, "Department created successfully")
    );
});

// Get all departments with filtering and pagination
export const getAllDepartments = asyncHandler(async (req, res) => {
    const {
        page = 1,
        limit = 10,
        municipality,
        category,
        search,
        sortBy = "name",
        sortOrder = "asc",
        minCompletionRate
    } = req.query;

    // Build filter object
    const filter = {};
    if (municipality) filter.municipality = municipality;
    if (category) filter.categories = { $in: [category] };
    if (minCompletionRate) filter['stats.performance.completionRate'] = { $gte: parseInt(minCompletionRate) };

    // Add search functionality
    if (search) {
        filter.$or = [
            { name: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } }
        ];
    }

    // For staff users, only show their own department
    if (req.user?.role === 'staff' && req.user.department) {
        filter._id = req.user.department;
    }

    const sortConfig = {};
    sortConfig[sortBy] = sortOrder === "desc" ? -1 : 1;

    // Execute query with pagination
    const departments = await Department.find(filter)
        .populate('municipality', 'name district')
        .populate('staffMembers.userId', 'name username role avatar')
        .sort(sortConfig)
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .exec();

    const totalDepartments = await Department.countDocuments(filter);

    // Calculate stats for each department
    const departmentsWithStats = await Promise.all(
        departments.map(async (department) => {
            // Calculate real-time stats if needed
            if (department.calculateDetailedStats) {
                await department.calculateDetailedStats();
            }
            
            const departmentObj = department.toObject();
            departmentObj.dashboardStats = department.getDashboardStats ? 
                department.getDashboardStats() : 
                {
                    overview: {
                        totalReports: department.stats?.totalReports || 0,
                        pendingReports: department.stats?.pendingReports || 0,
                        completedReports: department.stats?.completedReports || 0,
                        completionRate: department.stats?.performance?.completionRate || 0
                    },
                    staffCount: department.staffMembers?.filter(staff => staff.isActive)?.length || 0
                };

            return departmentObj;
        })
    );

    res.status(200).json(
        new ApiResponse(200, {
            departments: departmentsWithStats,
            pagination: {
                totalPages: Math.ceil(totalDepartments / limit),
                currentPage: parseInt(page),
                totalDepartments,
                hasNextPage: page < Math.ceil(totalDepartments / limit),
                hasPrevPage: page > 1,
                limit: parseInt(limit)
            }
        }, "Departments retrieved successfully")
    );
});

// Get department by ID
export const getDepartmentById = asyncHandler(async (req, res) => {
    const { departmentId } = req.params;

    const department = await Department.findById(departmentId)
        .populate('municipality', 'name district admin')
        .populate('staffMembers.userId', 'name username role avatar email')
        .populate({
            path: 'reports.reportId',
            select: 'title category status priority upvoteCount createdAt rating',
            options: { sort: { createdAt: -1 }, limit: 20 }
        });

    if (!department) {
        throw new ApiError(404, "Department not found");
    }

    // Check if staff user can access this department
    if (req.user?.role === 'staff' && req.user.department?.toString() !== departmentId) {
        throw new ApiError(403, "Access denied to this department");
    }

    // Calculate detailed stats
    if (department.calculateDetailedStats) {
        await department.calculateDetailedStats();
    }

    // Get additional report statistics
    const reportStats = await Report.aggregate([
        { $match: { department: department._id } },
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
                rejectedReports: {
                    $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] }
                },
                avgRating: { $avg: "$rating" },
                totalUpvotes: { $sum: "$upvoteCount" },
                avgPriority: { $avg: "$priority" }
            }
        }
    ]);

    // Get category-wise report distribution
    const categoryStats = await Report.aggregate([
        { $match: { department: department._id } },
        {
            $group: {
                _id: "$category",
                count: { $sum: 1 },
                avgPriority: { $avg: "$priority" },
                resolvedCount: {
                    $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] }
                }
            }
        },
        { $sort: { count: -1 } }
    ]);

    const departmentData = department.toObject();
    departmentData.reportStats = reportStats || {
        totalReports: 0,
        pendingReports: 0,
        inProgressReports: 0,
        resolvedReports: 0,
        rejectedReports: 0,
        avgRating: 0,
        totalUpvotes: 0,
        avgPriority: 0
    };
    departmentData.categoryStats = categoryStats;

    res.status(200).json(
        new ApiResponse(200, departmentData, "Department retrieved successfully")
    );
});

// Update department (Admin only)
export const updateDepartment = asyncHandler(async (req, res) => {
    const { departmentId } = req.params;
    const { name, description, categories } = req.body;

    const department = await Department.findById(departmentId);
    if (!department) {
        throw new ApiError(404, "Department not found");
    }

    // Check if name already exists in the same municipality (if name is being updated)
    if (name && name !== department.name) {
        const existingDepartment = await Department.findOne({
            name: { $regex: new RegExp(name, 'i') },
            municipality: department.municipality,
            _id: { $ne: departmentId }
        });

        if (existingDepartment) {
            throw new ApiError(409, "Department with this name already exists in the municipality");
        }
    }

    // Update fields if provided
    if (name) department.name = name.trim();
    if (description !== undefined) department.description = description;
    if (categories) department.categories = categories;

    // Update lastUpdated in stats
    if (department.stats) {
        department.stats.lastUpdated = new Date();
    }

    await department.save();

    const updatedDepartment = await Department.findById(departmentId)
        .populate('municipality', 'name district')
        .populate('staffMembers.userId', 'name username role');

    res.status(200).json(
        new ApiResponse(200, updatedDepartment, "Department updated successfully")
    );
});

// Add staff member to department
export const addStaffMember = asyncHandler(async (req, res) => {
    const { departmentId } = req.params;
    const { userId, role = "junior_staff", responsibilities = [] } = req.body;

    if (!userId) {
        throw new ApiError(400, "User ID is required");
    }

    const department = await Department.findById(departmentId);
    if (!department) {
        throw new ApiError(404, "Department not found");
    }

    // Validate user exists and has staff role
    const user = await User.findById(userId);
    if (!user) {
        throw new ApiError(404, "User not found");
    }

    if (!["staff", "admin"].includes(user.role)) {
        throw new ApiError(400, "User must have staff or admin role");
    }

    // Check if user is already a staff member
    const existingMember = department.staffMembers?.find(staff =>
        staff.userId.toString() === userId.toString()
    );

    if (existingMember) {
        throw new ApiError(409, "User is already a staff member of this department");
    }

    // Add staff member using model method if available
    if (department.addStaffMember) {
        await department.addStaffMember(userId, role, responsibilities);
    } else {
        // Fallback: Add manually
        if (!department.staffMembers) department.staffMembers = [];
        department.staffMembers.push({
            userId,
            role,
            responsibilities,
            isActive: true,
            joinedAt: new Date()
        });
        await department.save();
    }

    const updatedDepartment = await Department.findById(departmentId)
        .populate('staffMembers.userId', 'name username role avatar');

    res.status(200).json(
        new ApiResponse(200, updatedDepartment, "Staff member added successfully")
    );
});

// Remove staff member from department
export const removeStaffMember = asyncHandler(async (req, res) => {
    const { departmentId, userId } = req.params;

    const department = await Department.findById(departmentId);
    if (!department) {
        throw new ApiError(404, "Department not found");
    }

    // Check if user is a staff member
    const staffMember = department.staffMembers?.find(staff =>
        staff.userId.toString() === userId.toString()
    );

    if (!staffMember) {
        throw new ApiError(404, "User is not a staff member of this department");
    }

    // Check for assigned reports
    const assignedReports = department.reports?.filter(report =>
        report.assignedTo && 
        report.assignedTo.toString() === userId.toString() &&
        report.status === "assigned"
    ) || [];

    if (assignedReports.length > 0) {
        throw new ApiError(400, "Cannot remove staff member with assigned reports");
    }

    // Remove staff member using model method if available
    if (department.removeStaffMember) {
        await department.removeStaffMember(userId);
    } else {
        // Fallback: Remove manually
        department.staffMembers = department.staffMembers?.filter(staff =>
            staff.userId.toString() !== userId.toString()
        ) || [];
        await department.save();
    }

    res.status(200).json(
        new ApiResponse(200, {}, "Staff member removed successfully")
    );
});

// Assign report to staff member
export const assignReportToStaff = asyncHandler(async (req, res) => {
    const { departmentId } = req.params;
    const { reportId, staffId } = req.body;

    const department = await Department.findById(departmentId);
    if (!department) {
        throw new ApiError(404, "Department not found");
    }

    // Verify report exists and belongs to this department
    const reportIndex = department.reports?.findIndex(r =>
        r.reportId.toString() === reportId.toString()
    ) ?? -1;

    if (reportIndex === -1) {
        throw new ApiError(404, "Report not found in this department");
    }

    // Verify staff member exists in department
    const staffMember = department.staffMembers?.find(staff =>
        staff.userId.toString() === staffId.toString() && staff.isActive
    );

    if (!staffMember) {
        throw new ApiError(404, "Staff member not found or inactive");
    }

    // Assign report to staff
    if (department.reports && department.reports[reportIndex]) {
        department.reports[reportIndex].assignedTo = staffId;
        department.reports[reportIndex].status = "assigned";
    }

    // Update staff performance stats
    if (department.stats?.staffPerformance) {
        let staffStats = department.stats.staffPerformance.find(stat =>
            stat.userId.toString() === staffId.toString()
        );

        if (!staffStats) {
            department.stats.staffPerformance.push({
                userId: staffId,
                assignedReports: 1,
                completedReports: 0,
                avgResolutionTime: 0,
                completionRate: 0,
                lastAssignedAt: new Date()
            });
        } else {
            staffStats.assignedReports += 1;
            staffStats.lastAssignedAt = new Date();
        }
    }

    await department.save();

    // Update report in Report collection
    await Report.findByIdAndUpdate(reportId, {
        assignedTo: staffId,
        status: "assigned"
    });

    res.status(200).json(
        new ApiResponse(200, {}, "Report assigned to staff member successfully")
    );
});

// Update report status
export const updateReportStatus = asyncHandler(async (req, res) => {
    const { departmentId } = req.params;
    const { reportId, status, rating, upvotes = 0 } = req.body;

    const department = await Department.findById(departmentId);
    if (!department) {
        throw new ApiError(404, "Department not found");
    }

    // Update report status in department using model method if available
    if (department.updateReportStatus) {
        await department.updateReportStatus(reportId, status, rating, upvotes);
    } else {
        // Fallback: Update manually
        const reportIndex = department.reports?.findIndex(r =>
            r.reportId.toString() === reportId.toString()
        ) ?? -1;

        if (reportIndex !== -1 && department.reports) {
            department.reports[reportIndex].status = status;
            if (status === 'completed') {
                department.reports[reportIndex].completedAt = new Date();
            }
        }

        // Update basic stats
        if (department.stats) {
            if (status === 'completed') {
                department.stats.pendingReports -= 1;
                department.stats.completedReports += 1;
                department.stats.performance.completionRate = 
                    (department.stats.completedReports / department.stats.totalReports) * 100;
            }
            department.stats.lastUpdated = new Date();
        }

        await department.save();
    }

    // Update report in Report collection
    await Report.findByIdAndUpdate(reportId, { status });

    res.status(200).json(
        new ApiResponse(200, {}, "Report status updated successfully")
    );
});

// Get available staff for assignment
export const getAvailableStaff = asyncHandler(async (req, res) => {
    const { departmentId } = req.params;
    const { category } = req.query;

    const department = await Department.findById(departmentId)
        .populate('staffMembers.userId', 'name username role avatar');

    if (!department) {
        throw new ApiError(404, "Department not found");
    }

    let availableStaff = department.staffMembers?.filter(staff => staff.isActive) || [];

    // Filter by category if model method exists
    if (department.getAvailableStaff) {
        availableStaff = department.getAvailableStaff(category);
    } else if (category) {
        // Fallback: filter by responsibilities
        availableStaff = availableStaff.filter(staff => 
            !staff.responsibilities || 
            staff.responsibilities.length === 0 || 
            staff.responsibilities.includes(category)
        );
    }

    // Get workload information
    const workload = department.getWorkload ? department.getWorkload() : {};

    const staffWithWorkload = availableStaff.map(staff => ({
        ...staff.toObject(),
        workload: workload[staff.userId.toString()] || { assignedReports: 0 }
    }));

    res.status(200).json(
        new ApiResponse(200, staffWithWorkload, "Available staff retrieved successfully")
    );
});

// Get departments by municipality
export const getDepartmentsByMunicipality = asyncHandler(async (req, res) => {
    const { municipalityId } = req.params;

    // Check if municipality exists
    const municipalityExists = await Municipality.findById(municipalityId);
    if (!municipalityExists) {
        throw new ApiError(404, "Municipality not found");
    }

    const departments = await Department.find({ municipality: municipalityId })
        .populate('municipality', 'name district')
        .populate('staffMembers.userId', 'name username role')
        .sort({ name: 1 });

    res.status(200).json(
        new ApiResponse(200, departments, "Departments retrieved successfully")
    );
});

// Get departments by category
export const getDepartmentsByCategory = asyncHandler(async (req, res) => {
    const { category } = req.params;

    const validCategories = ["Infrastructure", "Sanitation", "Street Lighting", "Water Supply", "Traffic", "Parks"];
    
    if (!validCategories.includes(category)) {
        throw new ApiError(400, "Invalid category provided");
    }

    const departments = await Department.find({
        categories: { $in: [category] }
    })
    .populate('municipality', 'name district')
    .populate('staffMembers.userId', 'name username role')
    .sort({ name: 1 });

    res.status(200).json(
        new ApiResponse(200, departments, `Departments handling ${category} retrieved successfully`)
    );
});

// Get department analytics (Admin/Staff only)
export const getDepartmentAnalytics = asyncHandler(async (req, res) => {
    const { departmentId } = req.params;
    const { timeframe = '30d' } = req.query;

    const department = await Department.findById(departmentId);
    if (!department) {
        throw new ApiError(404, "Department not found");
    }

    // Check if staff user can access this department
    if (req.user?.role === 'staff' && req.user.department?.toString() !== departmentId) {
        throw new ApiError(403, "Access denied to this department analytics");
    }

    // Calculate detailed stats using model method if available
    if (department.calculateDetailedStats) {
        await department.calculateDetailedStats();
    }

    // Get time-based analytics
    const timeframeMap = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
    const daysBack = timeframeMap[timeframe] || 30;
    const startDate = new Date(Date.now() - (daysBack * 24 * 60 * 60 * 1000));

    const timeBasedReports = await Report.find({
        department: departmentId,
        createdAt: { $gte: startDate }
    });

    // Recent reports trend
    const recentTrend = await Report.aggregate([
        {
            $match: {
                department: department._id,
                createdAt: { $gte: startDate }
            }
        },
        {
            $group: {
                _id: {
                    $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
                },
                count: { $sum: 1 }
            }
        },
        { $sort: { "_id": 1 } }
    ]);

    const analyticsData = {
        department: {
            id: department._id,
            name: department.name,
            categories: department.categories
        },
        overview: department.getDashboardStats ? 
            department.getDashboardStats() : 
            department.stats || {},
        timeframe: {
            period: timeframe,
            reportCount: timeBasedReports.length,
            completionRate: timeBasedReports.length ?
                (timeBasedReports.filter(r => r.status === 'completed').length / timeBasedReports.length) * 100 : 0
        },
        staffPerformance: department.stats?.staffPerformance || [],
        categoryBreakdown: department.stats?.categoryStats || [],
        workloadDistribution: department.getWorkload ? department.getWorkload() : {},
        trends: recentTrend,
        generatedAt: new Date()
    };

    res.status(200).json(
        new ApiResponse(200, analyticsData, "Department analytics retrieved successfully")
    );
});

// Delete department (Admin only)
export const deleteDepartment = asyncHandler(async (req, res) => {
    const { departmentId } = req.params;

    const department = await Department.findById(departmentId);
    if (!department) {
        throw new ApiError(404, "Department not found");
    }

    // Check if department has any reports
    const reportCount = await Report.countDocuments({ department: departmentId });
    if (reportCount > 0) {
        throw new ApiError(400, "Cannot delete department with existing reports. Transfer or resolve reports first.");
    }

    // Check if department has any staff members
    const activeStaffCount = department.staffMembers?.filter(staff => staff.isActive)?.length || 0;
    if (activeStaffCount > 0) {
        throw new ApiError(400, "Cannot delete department with active staff members. Remove staff first.");
    }

    // Remove department from municipality's departments array
    await Municipality.findByIdAndUpdate(
        department.municipality,
        { $pull: { departments: departmentId } }
    );

    await Department.findByIdAndDelete(departmentId);

    res.status(200).json(
        new ApiResponse(200, {}, "Department deleted successfully")
    );
});
