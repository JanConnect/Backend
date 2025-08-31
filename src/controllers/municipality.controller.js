import { Municipality } from "../models/municipality.model.js";
import { Department } from "../models/department.model.js";
import { Report } from "../models/report.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";

// Create new municipality (Admin only)
const createMunicipality = asyncHandler(async (req, res) => {
  const { name, district, state, contactPerson, location } = req.body;

  // Validate required fields
  if (!name || !district || !location?.coordinates) {
    throw new ApiError(400, "Name, district, and coordinates are required");
  }

  // Check if municipality already exists
  const existingMunicipality = await Municipality.findOne({
    name: { $regex: new RegExp(name, 'i') },
    district: { $regex: new RegExp(district, 'i') }
  });

  if (existingMunicipality) {
    throw new ApiError(409, "Municipality already exists in this district");
  }

  const municipality = await Municipality.create({
    name,
    state: state || "Jharkhand",
    district,
    contactPerson,
    location
  });

  res.status(201).json(
    new ApiResponse(201, municipality, "Municipality created successfully")
  );
});

// Get all municipalities with filtering and pagination
const getAllMunicipalities = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    district,
    state,
    search
  } = req.query;

  // Build filter object
  const filter = {};
  
  if (district) filter.district = { $regex: district, $options: 'i' };
  if (state) filter.state = { $regex: state, $options: 'i' };
  
  // Add search functionality
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { district: { $regex: search, $options: 'i' } }
    ];
  }

  // Execute query with pagination
  const municipalities = await Municipality.find(filter)
    .populate('departments', 'name')
    .sort({ name: 1 })
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .exec();

  const totalMunicipalities = await Municipality.countDocuments(filter);

  // Add report statistics for each municipality
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
            resolvedReports: {
              $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] }
            }
          }
        }
      ]);

      const municipalityObj = municipality.toObject();
      municipalityObj.reportStats = reportStats[0] || {
        totalReports: 0,
        pendingReports: 0,
        resolvedReports: 0
      };

      return municipalityObj;
    })
  );

  res.status(200).json(
    new ApiResponse(200, {
      municipalities: municipalitiesWithStats,
      totalPages: Math.ceil(totalMunicipalities / limit),
      currentPage: parseInt(page),
      totalMunicipalities,
      hasNextPage: page < Math.ceil(totalMunicipalities / limit),
      hasPrevPage: page > 1
    }, "Municipalities retrieved successfully")
  );
});

// Get municipality by ID
const getMunicipalityById = asyncHandler(async (req, res) => {
  const { municipalityId } = req.params;

  const municipality = await Municipality.findById(municipalityId)
    .populate('departments', 'name description categories contactPerson');

  if (!municipality) {
    throw new ApiError(404, "Municipality not found");
  }

  // Get municipality statistics
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
        avgRating: { $avg: "$rating" }
      }
    }
  ]);

  // Get category-wise report distribution
  const categoryStats = await Report.aggregate([
    { $match: { municipality: municipality._id } },
    {
      $group: {
        _id: "$category",
        count: { $sum: 1 }
      }
    },
    { $sort: { count: -1 } }
  ]);

  const municipalityData = municipality.toObject();
  municipalityData.reportStats = stats[0] || {
    totalReports: 0,
    pendingReports: 0,
    inProgressReports: 0,
    resolvedReports: 0,
    avgRating: 0
  };
  municipalityData.categoryStats = categoryStats;

  res.status(200).json(
    new ApiResponse(200, municipalityData, "Municipality retrieved successfully")
  );
});

// Update municipality (Admin only)
const updateMunicipality = asyncHandler(async (req, res) => {
  const { municipalityId } = req.params;
  const { name, district, state, contactPerson, location } = req.body;

  const municipality = await Municipality.findById(municipalityId);
  if (!municipality) {
    throw new ApiError(404, "Municipality not found");
  }

  // Update fields if provided
  if (name) municipality.name = name;
  if (district) municipality.district = district;
  if (state) municipality.state = state;
  if (contactPerson) municipality.contactPerson = contactPerson;
  if (location) municipality.location = location;

  await municipality.save();

  res.status(200).json(
    new ApiResponse(200, municipality, "Municipality updated successfully")
  );
});

// Delete municipality (Admin only)
const deleteMunicipality = asyncHandler(async (req, res) => {
  const { municipalityId } = req.params;

  const municipality = await Municipality.findById(municipalityId);
  if (!municipality) {
    throw new ApiError(404, "Municipality not found");
  }

  // Check if municipality has any reports
  const reportCount = await Report.countDocuments({ municipality: municipalityId });
  if (reportCount > 0) {
    throw new ApiError(400, "Cannot delete municipality with existing reports");
  }

  // Check if municipality has departments
  const departmentCount = await Department.countDocuments({ municipality: municipalityId });
  if (departmentCount > 0) {
    throw new ApiError(400, "Cannot delete municipality with existing departments");
  }

  await Municipality.findByIdAndDelete(municipalityId);

  res.status(200).json(
    new ApiResponse(200, {}, "Municipality deleted successfully")
  );
});

// Get municipalities near a location
const getMunicipalitiesNearLocation = asyncHandler(async (req, res) => {
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
  }).populate('departments', 'name categories');

  res.status(200).json(
    new ApiResponse(200, municipalities, "Nearby municipalities retrieved successfully")
  );
});

// Add department to municipality (Admin only)
const addDepartmentToMunicipality = asyncHandler(async (req, res) => {
  const { municipalityId, departmentId } = req.params;

  const municipality = await Municipality.findById(municipalityId);
  if (!municipality) {
    throw new ApiError(404, "Municipality not found");
  }

  const department = await Department.findById(departmentId);
  if (!department) {
    throw new ApiError(404, "Department not found");
  }

  // Check if department is already added
  if (municipality.departments.includes(departmentId)) {
    throw new ApiError(400, "Department already exists in this municipality");
  }

  municipality.departments.push(departmentId);
  await municipality.save();

  // Also update the department's municipality field
  department.municipality = municipalityId;
  await department.save();

  const updatedMunicipality = await Municipality.findById(municipalityId)
    .populate('departments', 'name description');

  res.status(200).json(
    new ApiResponse(200, updatedMunicipality, "Department added to municipality successfully")
  );
});

// Remove department from municipality (Admin only)
const removeDepartmentFromMunicipality = asyncHandler(async (req, res) => {
  const { municipalityId, departmentId } = req.params;

  const municipality = await Municipality.findById(municipalityId);
  if (!municipality) {
    throw new ApiError(404, "Municipality not found");
  }

  municipality.departments = municipality.departments.filter(
    dept => dept.toString() !== departmentId
  );
  await municipality.save();

  const updatedMunicipality = await Municipality.findById(municipalityId)
    .populate('departments', 'name description');

  res.status(200).json(
    new ApiResponse(200, updatedMunicipality, "Department removed from municipality successfully")
  );
});

export {
  createMunicipality,
  getAllMunicipalities,
  getMunicipalityById,
  updateMunicipality,
  deleteMunicipality,
  getMunicipalitiesNearLocation,
  addDepartmentToMunicipality,
  removeDepartmentFromMunicipality
};
