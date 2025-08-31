import { Department } from "../models/department.model.js";
import { Municipality } from "../models/municipality.model.js";
import { Report } from "../models/report.model.js";
import { User } from "../models/user.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Create new department (Admin only)
const createDepartment = asyncHandler(async (req, res) => {
  const { name, description, municipality, categories, contactPerson } = req.body;

  // Validate required fields
  if (!name || !municipality) {
    throw new ApiError(400, "Name and municipality are required");
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

  // Create department
  const department = await Department.create({
    name,
    description,
    municipality,
    categories: categories || [],
    contactPerson
  });

  // Add department to municipality's departments array
  await Municipality.findByIdAndUpdate(
    municipality,
    { $push: { departments: department._id } }
  );

  const populatedDepartment = await Department.findById(department._id)
    .populate('municipality', 'name district');

  res.status(201).json(
    new ApiResponse(201, populatedDepartment, "Department created successfully")
  );
});

// Get all departments with filtering and pagination
const getAllDepartments = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    municipality,
    category,
    search
  } = req.query;

  // Build filter object
  const filter = {};
  
  if (municipality) filter.municipality = municipality;
  if (category) filter.categories = { $in: [category] };
  
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

  // Execute query with pagination
  const departments = await Department.find(filter)
    .populate('municipality', 'name district')
    .sort({ name: 1 })
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .exec();

  const totalDepartments = await Department.countDocuments(filter);

  // Add report statistics for each department
  const departmentsWithStats = await Promise.all(
    departments.map(async (department) => {
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
            avgRating: { $avg: "$rating" }
          }
        }
      ]);

      const departmentObj = department.toObject();
      departmentObj.reportStats = reportStats[0] || {
        totalReports: 0,
        pendingReports: 0,
        inProgressReports: 0,
        resolvedReports: 0,
        avgRating: 0
      };

      return departmentObj;
    })
  );

  res.status(200).json(
    new ApiResponse(200, {
      departments: departmentsWithStats,
      totalPages: Math.ceil(totalDepartments / limit),
      currentPage: parseInt(page),
      totalDepartments,
      hasNextPage: page < Math.ceil(totalDepartments / limit),
      hasPrevPage: page > 1
    }, "Departments retrieved successfully")
  );
});

// Get department by ID
const getDepartmentById = asyncHandler(async (req, res) => {
  const { departmentId } = req.params;

  const department = await Department.findById(departmentId)
    .populate('municipality', 'name district contactPerson');

  if (!department) {
    throw new ApiError(404, "Department not found");
  }

  // Check if staff user can access this department
  if (req.user?.role === 'staff' && req.user.department?.toString() !== departmentId) {
    throw new ApiError(403, "Access denied to this department");
  }

  // Get department statistics
  const stats = await Report.aggregate([
    { $match: { department: department._id } },
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

  // Get staff members in this department
  const staffMembers = await User.find({
    department: departmentId,
    role: 'staff'
  }).select('name email phone');

  const departmentData = department.toObject();
  departmentData.reportStats = stats[0] || {
    totalReports: 0,
    pendingReports: 0,
    acknowledgedReports: 0,
    inProgressReports: 0,
    resolvedReports: 0,
    rejectedReports: 0,
    avgRating: 0,
    totalUpvotes: 0,
    avgPriority: 0
  };
  departmentData.categoryStats = categoryStats;
  departmentData.staffMembers = staffMembers;

  res.status(200).json(
    new ApiResponse(200, departmentData, "Department retrieved successfully")
  );
});

// Update department (Admin only)
const updateDepartment = asyncHandler(async (req, res) => {
  const { departmentId } = req.params;
  const { name, description, categories, contactPerson } = req.body;

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
  if (name) department.name = name;
  if (description !== undefined) department.description = description;
  if (categories) department.categories = categories;
  if (contactPerson) department.contactPerson = contactPerson;

  await department.save();

  const updatedDepartment = await Department.findById(departmentId)
    .populate('municipality', 'name district');

  res.status(200).json(
    new ApiResponse(200, updatedDepartment, "Department updated successfully")
  );
});

// Delete department (Admin only)
const deleteDepartment = asyncHandler(async (req, res) => {
  const { departmentId } = req.params;

  const department = await Department.findById(departmentId);
  if (!department) {
    throw new ApiError(404, "Department not found");
  }

  // Check if department has any reports
  const reportCount = await Report.countDocuments({ department: departmentId });
  if (reportCount > 0) {
    throw new ApiError(400, "Cannot delete department with existing reports");
  }

  // Check if department has any staff members
  const staffCount = await User.countDocuments({ department: departmentId, role: 'staff' });
  if (staffCount > 0) {
    throw new ApiError(400, "Cannot delete department with existing staff members");
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

// Get departments by municipality
const getDepartmentsByMunicipality = asyncHandler(async (req, res) => {
  const { municipalityId } = req.params;

  // Check if municipality exists
  const municipalityExists = await Municipality.findById(municipalityId);
  if (!municipalityExists) {
    throw new ApiError(404, "Municipality not found");
  }

  const departments = await Department.find({ municipality: municipalityId })
    .populate('municipality', 'name district')
    .sort({ name: 1 });

  res.status(200).json(
    new ApiResponse(200, departments, "Departments retrieved successfully")
  );
});

// Get departments by category
const getDepartmentsByCategory = asyncHandler(async (req, res) => {
  const { category } = req.params;

  const validCategories = ["Infrastructure", "Sanitation", "Street Lighting", "Water Supply", "Traffic", "Parks", "Other"];
  
  if (!validCategories.includes(category)) {
    throw new ApiError(400, "Invalid category provided");
  }

  const departments = await Department.find({
    categories: { $in: [category] }
  })
  .populate('municipality', 'name district')
  .sort({ name: 1 });

  res.status(200).json(
    new ApiResponse(200, departments, `Departments handling ${category} retrieved successfully`)
  );
});

// Get department analytics (Admin/Staff only)
const getDepartmentAnalytics = asyncHandler(async (req, res) => {
  const { departmentId } = req.params;

  const department = await Department.findById(departmentId);
  if (!department) {
    throw new ApiError(404, "Department not found");
  }

  // Check if staff user can access this department
  if (req.user?.role === 'staff' && req.user.department?.toString() !== departmentId) {
    throw new ApiError(403, "Access denied to this department analytics");
  }

  // Get comprehensive analytics
  const analytics = await Report.aggregate([
    { $match: { department: department._id } },
    {
      $group: {
        _id: null,
        totalReports: { $sum: 1 },
        pendingReports: { $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] } },
        acknowledgedReports: { $sum: { $cond: [{ $eq: ["$status", "acknowledged"] }, 1, 0] } },
        inProgressReports: { $sum: { $cond: [{ $eq: ["$status", "in-progress"] }, 1, 0] } },
        resolvedReports: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } },
        rejectedReports: { $sum: { $cond: [{ $eq: ["$status", "rejected"] }, 1, 0] } },
        avgRating: { $avg: "$rating" },
        totalUpvotes: { $sum: "$upvoteCount" },
        avgPriority: { $avg: "$priority" },
        avgResolutionTime: {
          $avg: {
            $cond: [
              { $ne: ["$resolvedDate", null] },
              { $subtract: ["$resolvedDate", "$date"] },
              null
            ]
          }
        }
      }
    }
  ]);

  // Recent reports trend (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const recentTrend = await Report.aggregate([
    { 
      $match: { 
        department: department._id,
        date: { $gte: thirtyDaysAgo }
      }
    },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m-%d", date: "$date" }
        },
        count: { $sum: 1 }
      }
    },
    { $sort: { "_id": 1 } }
  ]);

  res.status(200).json(
    new ApiResponse(200, {
      department: {
        id: department._id,
        name: department.name,
        categories: department.categories
      },
      overview: analytics[0] || {},
      recentTrend,
      generatedAt: new Date()
    }, "Department analytics retrieved successfully")
  );
});

export {
  createDepartment,
  getAllDepartments,
  getDepartmentById,
  updateDepartment,
  deleteDepartment,
  getDepartmentsByMunicipality,
  getDepartmentsByCategory,
  getDepartmentAnalytics
};
