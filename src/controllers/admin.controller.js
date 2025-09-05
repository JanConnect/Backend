import { Admin } from "../models/admin.model.js";
import { User } from "../models/user.model.js";
import { Report } from "../models/report.model.js";
import { Department } from "../models/department.model.js";
import { Municipality } from "../models/municipality.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";


import { generateAccessAndRefreshToken } from "../controllers/user.controller.js";

// Add this function to your existing admin controller
const adminLogin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new ApiError(400, "Email and password are required");
  }

  // Find user with admin role
  const user = await User.findOne({ 
    email: email.toLowerCase(),
    role: 'admin'  // Only allow admin users
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
      permissions: ["manage_reports", "manage_users", "view_analytics"],
      systemRole: "municipal_admin",
      isActive: true
    });
  }

  if (!admin.isActive) {
    throw new ApiError(403, "Admin account is deactivated");
  }

  // Generate tokens
  const { accessToken, refreshToken } = await generateAccessAndRefreshToken(user._id);
  
  // Log admin login activity
  await admin.logActivity(
    'admin_login',
    `Admin logged in from IP: ${req.ip}`,
    'auth'
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
        isActive: admin.isActive
      },
      accessToken,
    }, "Admin logged in successfully"));
});

// Get admin dashboard statistics
const getDashboardStats = asyncHandler(async (req, res) => {
  const adminId = req.user._id;
  
  // Get admin profile to check permissions and scope
  const admin = await Admin.findOne({ userId: adminId })
    .populate('assignedMunicipalities', 'name district')
    .populate('assignedDepartments', 'name');

  if (!admin) {
    throw new ApiError(404, "Admin profile not found");
  }

  // Build filter based on admin scope
  let reportFilter = {};
  let userFilter = {};
  
  if (admin.systemRole !== 'super_admin') {
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
        avgRating: { $avg: "$rating" },
        totalUpvotes: { $sum: "$upvoteCount" },
        avgPriority: { $avg: "$priority" }
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
          $sum: { $cond: [{ $eq: ["$role", "admin"] }, 1, 0] }
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
    date: { $gte: sevenDaysAgo }
  })
  .populate('reportedBy', 'name email')
  .populate('municipality', 'name')
  .populate('department', 'name')
  .sort({ date: -1 })
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
        avgResolutionTime: {
          $avg: {
            $cond: [
              { $ne: ["$resolvedDate", null] },
              { $subtract: ["$resolvedDate", "$date"] },
              null
            ]
          }
        },
        avgRating: { $avg: "$rating" }
      }
    },
    {
      $lookup: {
        from: "departments",
        localField: "_id",
        foreignField: "_id",
        as: "department"
      }
    }
  ]);

  res.status(200).json(
    new ApiResponse(200, {
      reportStats: reportStats[0] || {},
      userStats: userStats[0] || {},
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
const getAllReportsAdmin = asyncHandler(async (req, res) => {
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
    dateTo
  } = req.query;

  const admin = await Admin.findOne({ userId: req.user._id });
  if (!admin) {
    throw new ApiError(404, "Admin profile not found");
  }

  // Build filter based on admin permissions
  const filter = {};
  
  // Apply admin scope restrictions
  if (admin.systemRole !== 'super_admin') {
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

  // Date range filter
  if (dateFrom || dateTo) {
    filter.date = {};
    if (dateFrom) filter.date.$gte = new Date(dateFrom);
    if (dateTo) filter.date.$lte = new Date(dateTo);
  }

  // Search filter
  if (search) {
    filter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { reportId: { $regex: search, $options: 'i' } }
    ];
  }

  const sort = {};
  sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

  const reports = await Report.find(filter)
    .populate('reportedBy', 'name email phone avatar')
    .populate('municipality', 'name district')
    .populate('department', 'name contactPerson')
    .populate('assignedTo', 'name email')
    .populate('updates.updatedBy', 'name')
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .exec();

  const totalReports = await Report.countDocuments(filter);

  // Log admin activity
  await admin.logActivity(
    'view_reports',
    `Viewed reports list with filters: ${JSON.stringify(req.query)}`,
    'report'
  );

  res.status(200).json(
    new ApiResponse(200, {
      reports,
      totalPages: Math.ceil(totalReports / limit),
      currentPage: parseInt(page),
      totalReports,
      hasNextPage: page < Math.ceil(totalReports / limit),
      hasPrevPage: page > 1
    }, "Reports retrieved successfully")
  );
});

// Bulk update report status
const bulkUpdateReports = asyncHandler(async (req, res) => {
  const { reportIds, status, message, assignedTo } = req.body;
  
  if (!reportIds || !Array.isArray(reportIds) || reportIds.length === 0) {
    throw new ApiError(400, "Report IDs array is required");
  }

  const admin = await Admin.findOne({ userId: req.user._id });
  if (!admin || !admin.hasPermission('bulk_operations')) {
    throw new ApiError(403, "Insufficient permissions for bulk operations");
  }

  const validStatuses = ["pending", "acknowledged", "in-progress", "resolved", "rejected"];
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
    reportIds.join(',')
  );

  res.status(200).json(
    new ApiResponse(200, {
      modifiedCount: updateResult.modifiedCount,
      reportIds
    }, "Reports updated successfully")
  );
});

// Export reports data
const exportReports = asyncHandler(async (req, res) => {
  const { format = 'csv', ...filters } = req.query;
  
  const admin = await Admin.findOne({ userId: req.user._id });
  if (!admin || !admin.hasPermission('export_data')) {
    throw new ApiError(403, "Insufficient permissions for data export");
  }

  // Build filter (similar to getAllReportsAdmin)
  const filter = {};
  
  // Apply admin scope restrictions
  if (admin.systemRole !== 'super_admin') {
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
    .sort({ date: -1 });

  // Log export activity
  await admin.logActivity(
    'export_data',
    `Exported ${reports.length} reports in ${format} format`,
    'report'
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
        date: report.date,
        resolvedDate: report.resolvedDate,
        upvoteCount: report.upvoteCount,
        rating: report.rating
      })),
      totalCount: reports.length,
      exportedAt: new Date()
    }, "Reports exported successfully")
  );
});

// Get system users with admin filtering
const getSystemUsers = asyncHandler(async (req, res) => {
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
      totalPages: Math.ceil(totalUsers / limit),
      currentPage: parseInt(page),
      totalUsers
    }, "Users retrieved successfully")
  );
});

// Get admin activity logs
const getActivityLogs = asyncHandler(async (req, res) => {
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

export {
    adminLogin,
  getDashboardStats,
  getAllReportsAdmin,
  bulkUpdateReports,
  exportReports,
  getSystemUsers,
  getActivityLogs
};
