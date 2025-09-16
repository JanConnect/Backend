import { Admin } from "../models/admin.model.js";
import { User } from "../models/user.model.js";
import { Report } from "../models/report.model.js";
import { Department } from "../models/department.model.js";
import { Municipality } from "../models/municipality.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import jwt from "jsonwebtoken";

// Generate tokens helper function
const generateTokens = async (userId) => {
    try {
        const user = await User.findById(userId);
        const accessToken = user.generateAccessToken();
        const refreshToken = user.generateRefreshToken();
        
        user.refreshToken = refreshToken;
        await user.save({ validateBeforeSave: false });
        
        return { accessToken, refreshToken };
    } catch (error) {
        throw new ApiError(500, "Something went wrong while generating tokens");
    }
};

// Admin login
export const adminLogin = asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        throw new ApiError(400, "Email and password are required");
    }

    // Find user with admin role
    const user = await User.findOne({
        email: email.toLowerCase(),
        role: { $in: ['admin', 'superadmin'] }
    });

    if (!user) {
        throw new ApiError(404, "Admin user not found");
    }

    const isPasswordValid = await user.isPasswordCorrect(password);
    if (!isPasswordValid) {
        throw new ApiError(401, "Invalid admin credentials");
    }

    // Check if admin profile exists and is active
    let admin = await Admin.findOne({ userId: user._id });
    if (!admin) {
        // Create admin profile if it doesn't exist
        admin = await Admin.create({
            userId: user._id,
            permissions: user.role === 'superadmin' ? 
                ["manage_users", "manage_departments", "manage_municipalities", "manage_reports", "view_analytics", "system_settings", "bulk_operations", "export_data"] :
                ["manage_reports", "view_analytics"],
            systemRole: user.role === 'superadmin' ? 'superadmin' : 'admin',
            isActive: true
        });
    }

    if (!admin.isActive) {
        throw new ApiError(403, "Admin account is deactivated");
    }

    // Generate tokens
    const { accessToken, refreshToken } = await generateTokens(user._id);

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    // Log admin login activity
    await admin.logActivity(
        'admin_login',
        `Admin logged in successfully`,
        'auth',
        null,
        req
    );

    const loggedInUser = await User.findById(user._id).select("-password -refreshToken");

    const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
    };

    return res
        .status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(new ApiResponse(200, {
            user: loggedInUser,
            admin: {
                systemRole: admin.systemRole,
                permissions: admin.permissions,
                isActive: admin.isActive,
                assignedMunicipalities: admin.assignedMunicipalities,
                assignedDepartments: admin.assignedDepartments
            },
            accessToken,
        }, "Admin logged in successfully"));
});

// Get admin dashboard statistics
export const getDashboardStats = asyncHandler(async (req, res) => {
    const adminId = req.user._id;

    // Get admin profile
    const admin = await Admin.findOne({ userId: adminId })
        .populate('assignedMunicipalities', 'name district')
        .populate('assignedDepartments', 'name');

    if (!admin) {
        throw new ApiError(404, "Admin profile not found");
    }

    // Build filter based on admin scope
    let reportFilter = {};
    let userFilter = {};
    
    if (admin.systemRole !== 'superadmin') {
        if (admin.assignedMunicipalities.length > 0) {
            reportFilter.municipality = { $in: admin.assignedMunicipalities.map(m => m._id) };
        }
        if (admin.assignedDepartments.length > 0) {
            reportFilter.department = { $in: admin.assignedDepartments.map(d => d._id) };
        }
    }

    // Get report statistics
    const reportStats = await Report.aggregate([
        { $match: reportFilter },
        {
            $group: {
                _id: null,
                totalReports: { $sum: 1 },
                pendingReports: {
                    $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] }
                },
                acknowledgedReports: {
                    $sum: { $cond: [{ $eq: ["$status", "acknowledged"] }, 1, 0] }
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
                pendingAssignmentReports: {
                    $sum: { $cond: [{ $eq: ["$status", "pending_assignment"] }, 1, 0] }
                },
                reportsWithVoice: {
                    $sum: { $cond: [{ $ne: ["$voiceMessage.url", null] }, 1, 0] }
                },
                reportsWithImage: {
                    $sum: { $cond: [{ $ne: ["$image.url", null] }, 1, 0] }
                },
                avgRating: { $avg: "$rating" },
                totalUpvotes: { $sum: "$upvoteCount" },
                avgPriority: { $avg: "$priority" },
                avgResolutionTime: { $avg: "$resolutionTime" }
            }
        }
    ]);

    // Get user statistics
    const userStats = await User.aggregate([
        { $match: userFilter },
        {
            $group: {
                _id: null,
                totalUsers: { $sum: 1 },
                activeUsers: {
                    $sum: { $cond: [{ $gte: ["$updatedAt", new Date(Date.now() - 30*24*60*60*1000)] }, 1, 0] }
                },
                citizenCount: {
                    $sum: { $cond: [{ $eq: ["$role", "citizen"] }, 1, 0] }
                },
                staffCount: {
                    $sum: { $cond: [{ $eq: ["$role", "staff"] }, 1, 0] }
                },
                adminCount: {
                    $sum: { $cond: [{ $in: ["$role", ["admin", "superadmin"]] }, 1, 0] }
                }
            }
        }
    ]);

    // Get category-wise report distribution
    const categoryStats = await Report.aggregate([
        { $match: reportFilter },
        {
            $group: {
                _id: "$category",
                count: { $sum: 1 },
                avgPriority: { $avg: "$priority" },
                resolvedCount: {
                    $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] }
                },
                voiceMessageCount: {
                    $sum: { $cond: [{ $ne: ["$voiceMessage.url", null] }, 1, 0] }
                },
                completionRate: {
                    $multiply: [
                        { $divide: [
                            { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } },
                            { $sum: 1 }
                        ]},
                        100
                    ]
                }
            }
        },
        { $sort: { count: -1 } }
    ]);

    // Get recent activity (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentActivity = await Report.find({
        ...reportFilter,
        createdAt: { $gte: sevenDaysAgo }
    })
    .populate('reportedBy', 'name email')
    .populate('municipality', 'name')
    .populate('department', 'name')
    .sort({ createdAt: -1 })
    .limit(10);

    // Get department performance
    const departmentStats = await Report.aggregate([
        { $match: { ...reportFilter, department: { $ne: null } } },
        {
            $group: {
                _id: "$department",
                totalReports: { $sum: 1 },
                resolvedReports: {
                    $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] }
                },
                avgResolutionTime: { $avg: "$resolutionTime" },
                avgRating: { $avg: "$rating" },
                completionRate: {
                    $multiply: [
                        { $divide: [
                            { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } },
                            { $sum: 1 }
                        ]},
                        100
                    ]
                }
            }
        },
        {
            $lookup: {
                from: "departments",
                localField: "_id",
                foreignField: "_id",
                as: "department"
            }
        },
        { $sort: { completionRate: -1 } }
    ]);

    // Log dashboard access
    await admin.logActivity(
        'view_dashboard',
        'Accessed admin dashboard',
        'dashboard',
        null,
        req
    );

    res.status(200).json(
        new ApiResponse(200, {
            reportStats: reportStats || {},
            userStats: userStats || {},
            categoryStats,
            departmentStats,
            recentActivity,
            adminScope: {
                role: admin.systemRole,
                municipalities: admin.assignedMunicipalities,
                departments: admin.assignedDepartments
            }
        }, "Dashboard statistics retrieved successfully")
    );
});

// Get all reports with admin-level filtering
export const getAllReportsAdmin = asyncHandler(async (req, res) => {
    const {
        page = 1,
        limit = 20,
        status,
        category,
        urgency,
        priority,
        municipality,
        department,
        sortBy = 'priority',
        sortOrder = 'desc',
        search,
        dateFrom,
        dateTo,
        hasVoiceMessage,
        hasImage
    } = req.query;

    const admin = await Admin.findOne({ userId: req.user._id });
    if (!admin) {
        throw new ApiError(404, "Admin profile not found");
    }

    // Build filter based on admin permissions
    const filter = {};

    // Apply admin scope restrictions
    if (admin.systemRole !== 'superadmin') {
        if (admin.assignedMunicipalities.length > 0) {
            filter.municipality = { $in: admin.assignedMunicipalities };
        }
        if (admin.assignedDepartments.length > 0) {
            filter.department = { $in: admin.assignedDepartments };
        }
    }

    // Apply query filters
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (urgency) filter.urgency = urgency;
    if (priority) filter.priority = priority;
    if (municipality) filter.municipality = municipality;
    if (department) filter.department = department;

    // Media filters
    if (hasVoiceMessage === 'true') filter['voiceMessage.url'] = { $exists: true };
    if (hasImage === 'true') filter['image.url'] = { $exists: true };

    // Date range filter
    if (dateFrom || dateTo) {
        filter.createdAt = {};
        if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
        if (dateTo) filter.createdAt.$lte = new Date(dateTo);
    }

    // Search filter
    if (search) {
        filter.$or = [
            { title: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } },
            { reportId: { $regex: search, $options: 'i' } },
            { 'voiceMessage.transcription': { $regex: search, $options: 'i' } }
        ];
    }

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const reports = await Report.find(filter)
        .populate('reportedBy', 'name email phone avatar')
        .populate('municipality', 'name district')
        .populate('department', 'name')
        .populate('assignedTo', 'name email')
        .populate('updates.updatedBy', 'name')
        .sort(sort)
        .limit(limit * 1)
        .skip((page - 1) * limit)
        .exec();

    const totalReports = await Report.countDocuments(filter);

    // Add content summary for each report
    const reportsWithSummary = reports.map(report => {
        const reportObj = report.toObject();
        reportObj.contentSummary = report.getContentSummary ? 
            report.getContentSummary() : 
            (report.description || '[Voice Message]');
        return reportObj;
    });

    // Log admin activity
    await admin.logActivity(
        'view_reports',
        `Viewed reports list with filters: ${JSON.stringify(req.query)}`,
        'report',
        null,
        req
    );

    res.status(200).json(
        new ApiResponse(200, {
            reports: reportsWithSummary,
            pagination: {
                totalPages: Math.ceil(totalReports / limit),
                currentPage: parseInt(page),
                totalReports,
                hasNextPage: page < Math.ceil(totalReports / limit),
                hasPrevPage: page > 1,
                limit: parseInt(limit)
            }
        }, "Reports retrieved successfully")
    );
});

// Bulk update report status
export const bulkUpdateReports = asyncHandler(async (req, res) => {
    const { reportIds, status, message, assignedTo } = req.body;

    if (!reportIds || !Array.isArray(reportIds) || reportIds.length === 0) {
        throw new ApiError(400, "Report IDs array is required");
    }

    const admin = await Admin.findOne({ userId: req.user._id });
    if (!admin || !admin.hasPermission('bulk_operations')) {
        throw new ApiError(403, "Insufficient permissions for bulk operations");
    }

    const validStatuses = ["pending", "acknowledged", "in-progress", "resolved", "rejected", "pending_assignment"];
    if (status && !validStatuses.includes(status)) {
        throw new ApiError(400, "Invalid status provided");
    }

    // Build update object
    const updateObj = {};
    if (status) {
        updateObj.status = status;
        if (status === 'resolved') {
            updateObj.resolvedDate = new Date();
        }
    }
    if (assignedTo) updateObj.assignedTo = assignedTo;

    // Update reports
    const updateResult = await Report.updateMany(
        { reportId: { $in: reportIds } },
        updateObj
    );

    // Add update messages if provided
    if (message) {
        const reports = await Report.find({ reportId: { $in: reportIds } });
        await Promise.all(reports.map(async (report) => {
            report.updates.push({
                date: new Date(),
                message,
                updatedBy: req.user._id
            });
            return report.save();
        }));
    }

    // Log admin activity
    await admin.logActivity(
        'bulk_update_reports',
        `Bulk updated ${updateResult.modifiedCount} reports`,
        'report',
        reportIds.join(','),
        req
    );

    res.status(200).json(
        new ApiResponse(200, {
            modifiedCount: updateResult.modifiedCount,
            reportIds
        }, "Reports updated successfully")
    );
});

// Export reports data
export const exportReports = asyncHandler(async (req, res) => {
    const { format = 'json', ...filters } = req.query;

    const admin = await Admin.findOne({ userId: req.user._id });
    if (!admin || !admin.hasPermission('export_data')) {
        throw new ApiError(403, "Insufficient permissions for data export");
    }

    // Build filter (similar to getAllReportsAdmin)
    const filter = {};

    // Apply admin scope restrictions
    if (admin.systemRole !== 'superadmin') {
        if (admin.assignedMunicipalities.length > 0) {
            filter.municipality = { $in: admin.assignedMunicipalities };
        }
    }

    // Apply other filters from query
    Object.keys(filters).forEach(key => {
        if (filters[key] && filters[key] !== 'all') {
            filter[key] = filters[key];
        }
    });

    const reports = await Report.find(filter)
        .populate('reportedBy', 'name email')
        .populate('municipality', 'name district')
        .populate('department', 'name')
        .populate('assignedTo', 'name')
        .sort({ createdAt: -1 });

    // Log export activity
    await admin.logActivity(
        'export_data',
        `Exported ${reports.length} reports in ${format} format`,
        'report',
        null,
        req
    );

    // Return data for frontend processing
    res.status(200).json(
        new ApiResponse(200, {
            reports: reports.map(report => ({
                reportId: report.reportId,
                title: report.title,
                category: report.category,
                status: report.status,
                priority: report.priority,
                urgency: report.urgency,
                reportedBy: report.reportedBy?.name || 'Unknown',
                municipality: report.municipality?.name || 'Unknown',
                department: report.department?.name || 'Unassigned',
                assignedTo: report.assignedTo?.name || 'Unassigned',
                date: report.createdAt,
                resolvedDate: report.resolvedDate,
                upvoteCount: report.upvoteCount,
                rating: report.rating,
                hasVoiceMessage: !!report.voiceMessage?.url,
                hasImage: !!report.image?.url,
                resolutionTime: report.resolutionTime
            })),
            totalCount: reports.length,
            exportedAt: new Date()
        }, "Reports exported successfully")
    );
});

// Get system users with admin filtering
export const getSystemUsers = asyncHandler(async (req, res) => {
    const {
        page = 1,
        limit = 20,
        role,
        search,
        isActive
    } = req.query;

    const admin = await Admin.findOne({ userId: req.user._id });
    if (!admin || !admin.hasPermission('manage_users')) {
        throw new ApiError(403, "Insufficient permissions to view users");
    }

    const filter = {};
    if (role) filter.role = role;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    if (search) {
        filter.$or = [
            { name: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } },
            { username: { $regex: search, $options: 'i' } }
        ];
    }

    const users = await User.find(filter)
        .select('-password -refreshToken')
        .populate('department', 'name')
        .sort({ createdAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit);

    const totalUsers = await User.countDocuments(filter);

    res.status(200).json(
        new ApiResponse(200, {
            users,
            pagination: {
                totalPages: Math.ceil(totalUsers / limit),
                currentPage: parseInt(page),
                totalUsers
            }
        }, "Users retrieved successfully")
    );
});

// Get admin activity logs
export const getActivityLogs = asyncHandler(async (req, res) => {
    const { page = 1, limit = 50 } = req.query;

    const admin = await Admin.findOne({ userId: req.user._id });
    if (!admin) {
        throw new ApiError(404, "Admin profile not found");
    }

    const logs = admin.activityLog
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice((page - 1) * limit, page * limit);

    res.status(200).json(
        new ApiResponse(200, {
            logs,
            totalLogs: admin.activityLog.length,
            currentPage: parseInt(page),
            totalPages: Math.ceil(admin.activityLog.length / limit)
        }, "Activity logs retrieved successfully")
    );
});

// Create admin user (Super Admin only)
export const createAdminUser = asyncHandler(async (req, res) => {
    const { name, username, email, password, role = 'admin', permissions = [] } = req.body;

    const admin = await Admin.findOne({ userId: req.user._id });
    if (!admin || admin.systemRole !== 'superadmin') {
        throw new ApiError(403, "Only super admin can create admin users");
    }

    // Check if user already exists
    const existingUser = await User.findOne({
        $or: [{ email }, { username }]
    });

    if (existingUser) {
        throw new ApiError(409, "User with email or username already exists");
    }

    // Create user
    const user = await User.create({
        name,
        username,
        email,
        password,
        role,
        avatar: "https://via.placeholder.com/150", // Default avatar
        avatarPublicId: "default"
    });

    // Create admin profile
    const newAdmin = await Admin.create({
        userId: user._id,
        permissions,
        systemRole: role === 'superadmin' ? 'superadmin' : 'admin',
        isActive: true
    });

    // Log activity
    await admin.logActivity(
        'create_admin',
        `Created new admin user: ${email}`,
        'user',
        user._id.toString(),
        req
    );

    const createdUser = await User.findById(user._id).select('-password -refreshToken');

    res.status(201).json(
        new ApiResponse(201, {
            user: createdUser,
            admin: newAdmin
        }, "Admin user created successfully")
    );
});

// Get system health
export const getSystemHealth = asyncHandler(async (req, res) => {
    const admin = await Admin.findOne({ userId: req.user._id });
    if (!admin || !admin.hasPermission('system_settings')) {
        throw new ApiError(403, "Insufficient permissions to view system health");
    }

    // Calculate system health metrics
    const totalReports = await Report.countDocuments();
    const pendingReports = await Report.countDocuments({ status: 'pending' });
    const totalUsers = await User.countDocuments();
    const totalDepartments = await Department.countDocuments();
    const totalMunicipalities = await Municipality.countDocuments();

    const healthScore = Math.round(((totalReports - pendingReports) / totalReports) * 100) || 100;

    res.status(200).json(
        new ApiResponse(200, {
            systemHealth: {
                score: healthScore,
                status: healthScore > 80 ? 'healthy' : healthScore > 60 ? 'warning' : 'critical'
            },
            metrics: {
                totalReports,
                pendingReports,
                totalUsers,
                totalDepartments,
                totalMunicipalities
            },
            uptime: process.uptime(),
            timestamp: new Date()
        }, "System health retrieved successfully")
    );
});

