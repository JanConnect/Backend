import { Report } from "../models/report.model.js";
import { User } from "../models/user.model.js";
import { Department } from "../models/department.model.js";
import { Municipality } from "../models/municipality.model.js";
import { uploadOnCloudinary, deleteFromCloudinary } from "../utils/cloudinary.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import axios from 'axios';
import fs from 'fs';

const generateReportId = async (category) => {
  const categoryCode = category.substring(0, 4).toUpperCase();
  const count = await Report.countDocuments({ category });
  return `${categoryCode}-${String(count + 1).padStart(3, '0')}`;
};

const findNearestMunicipality = async (coordinates) => {
  const [longitude, latitude] = coordinates;
  
  const nearestMunicipality = await Municipality.findOne({
    location: {
      $near: {
        $geometry: {
          type: "Point",
          coordinates: [longitude, latitude]
        },
        $maxDistance: 20000 // 20km in meters
      }
    },
    
  });

  return nearestMunicipality;
};

const reverseGeocode = async (coordinates) => {
  const [longitude, latitude] = coordinates;
  
  try {
    const response = await axios.get(`https://api.opencagedata.com/geocode/v1/json`, {
      params: {
        q: `${latitude},${longitude}`,
        key: process.env.OPENCAGE_API_KEY,
        language: 'en',
        countrycode: 'in'
      }
    });

    if (response.data.results && response.data.results.length > 0) {
      const result = response.data.results[0];
      const district = result.components.state_district || 
                     result.components.county || 
                     result.components.district;
      return district;
    }
    return null;
  } catch (error) {
    console.error('Reverse geocoding error:', error);
    return null;
  }
};

const findMunicipalityByDistrict = async (districtName) => {
  if (!districtName) return null;
  
  const municipality = await Municipality.findOne({
    district: { $regex: new RegExp(districtName, 'i') },
  });

  return municipality;
};

const selectDepartmentByCategory = async (municipalityId, category) => {
  if (!municipalityId) return null;

  const department = await Department.findOne({
    municipality: municipalityId,
    categories: category,
  });

  return department;
};

const createReport = asyncHandler(async (req, res) => {
  const { title, category, urgency, description, location } = req.body;
  const userId = req.user._id;
  if (!title || !category || !description ) {
    throw new ApiError(400, "All required fields must be provided");
  }

    let coordinates;
  
  if (location.coordinates) {
    if (typeof location.coordinates === 'string') {
      try {
        coordinates = JSON.parse(location.coordinates);
      } catch (error) {
        throw new ApiError(400, "Invalid coordinates format - unable to parse JSON");
      }
    } else {
      coordinates = location.coordinates;
    }
  } else {
    throw new ApiError(400, "Location coordinates are required");
  }

  // Validate coordinates array
  if (!Array.isArray(coordinates) || coordinates.length !== 2) {
    throw new ApiError(400, "Coordinates must be an array with [longitude, latitude]");
  }

  // Convert to numbers and validate
  const [longitude, latitude] = coordinates.map(coord => parseFloat(coord));
  
  if (isNaN(longitude) || isNaN(latitude)) {
    throw new ApiError(400, "Coordinates must be valid numbers");
  }

  // Update location object with parsed coordinates
  location.coordinates = [longitude, latitude];

  console.log("✅ Parsed coordinates:", location.coordinates);


  if (!location.coordinates || location.coordinates.length !== 2) {
    throw new ApiError(400, "Valid coordinates (longitude, latitude) are required");
  }

  const reportId = await generateReportId(category);
  console.log(reportId)
  let media ;
  let uploadedFilePath ;

 try {
    // Handle single file upload (either image or video)
    if (req.file) {
      uploadedFilePath = req.file.path;
      
      // Determine media type from file mimetype
      let mediaType;
      if (req.file.mimetype.startsWith('image/')) {
        mediaType = 'image';
      } else if (req.file.mimetype.startsWith('video/')) {
        mediaType = 'video';
      } else {
        throw new ApiError(400, "Only images and videos are allowed");
      }
      
      console.log(`📁 Uploading ${mediaType} file:`, req.file.originalname);
      
      const uploadResult = await uploadOnCloudinary(req.file.path);
      if (uploadResult) {
        media = {
          url: uploadResult.secure_url,
          publicId: uploadResult.public_id,
          type: mediaType
        };
        console.log(`✅ ${mediaType} uploaded successfully`);
      }
    }

    let selectedMunicipality = await findNearestMunicipality(location.coordinates);
    let selectionMethod = "nearest";
    
    if (!selectedMunicipality) {
      console.log("No municipality found within 20km, trying reverse geocoding...");
      
      const districtName = await reverseGeocode(location.coordinates);
      if (districtName) {
        selectedMunicipality = await findMunicipalityByDistrict(districtName);
        selectionMethod = "district-based";
        console.log(`Found municipality in district: ${districtName}`);
      }
    }

    if (!selectedMunicipality) {
      throw new ApiError(404, "No municipality found for this location. Please contact support.");
    }
    

    const report = await Report.create({
      reportId,
      title,
      category,
      urgency: urgency || "medium",
      description,
      location,
      media,
      reportedBy: userId,
      priority: 2,
      municipality: selectedMunicipality._id,
    });

    const populatedReport = await Report.findById(report._id)
      .populate('reportedBy', 'name email')
      .populate('municipality', 'name district')

    res.status(201).json(
      new ApiResponse(201, {
        report: populatedReport,
        autoSelected: {
          municipality: selectedMunicipality.name,
          selectionMethod
        }
      }, "Report created successfully")
    );
  } catch (error) {
    if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
      fs.unlinkSync(uploadedFilePath);
    }
    throw error;
  }
});

const getAllReports = asyncHandler(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    status,
    category,
    urgency,
    priority,
    municipality,
    department,
    sortBy = 'priority',
    sortOrder = 'desc',
    search
  } = req.query;

  const filter = {};
  
  if (status) filter.status = status;
  if (category) filter.category = category;
  if (urgency) filter.urgency = urgency;
  if (priority) filter.priority = priority;
  if (municipality) filter.municipality = municipality;
  if (department) filter.department = department;
  
  if (search) {
    filter.$or = [
      { title: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { reportId: { $regex: search, $options: 'i' } }
    ];
  }

  if (req.user.role === 'citizen') {
    filter.isPublic = true;
  } else if (req.user.role === 'staff') {
    filter.$or = [
      { department: req.user.department },
      { isPublic: true }
    ];
  }

  const sort = {};
  sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

  // Execute query with pagination
  const reports = await Report.find(filter)
    .populate('reportedBy', 'name email')
    .populate('municipality', 'name')
    .populate('department', 'name')
    .populate('assignedTo', 'name')
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .exec();

  const totalReports = await Report.countDocuments(filter);

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


const getReportById = asyncHandler(async (req, res) => {
  const { reportId } = req.params;

  const report = await Report.findOne({ reportId })
    .populate('reportedBy', 'name email phone')
    .populate('municipality', 'name contactPerson')
    .populate('department', 'name contactPerson')
    .populate('assignedTo', 'name email')
    .populate('updates.updatedBy', 'name')
    .populate({
      path: 'upvotes.userId',
      select: 'name'
    });

  if (!report) {
    throw new ApiError(404, "Report not found");
  }

  // Check if user has permission to view this report
  const isOwner = report.reportedBy._id.toString() === req.user._id.toString();
  const isStaffOfDepartment = req.user.role === 'staff' && 
                             report.department?._id.toString() === req.user.department?.toString();
  const isAdmin = req.user.role === 'admin';
  const isPublic = report.isPublic;

  if (!isOwner && !isStaffOfDepartment && !isAdmin && !isPublic) {
    throw new ApiError(403, "Access denied");
  }

  // Check if current user has upvoted
  const hasUpvoted = report.upvotes.some(upvote => 
    upvote.userId._id.toString() === req.user._id.toString()
  );

  const reportData = report.toObject();
  reportData.hasUpvoted = hasUpvoted;

  res.status(200).json(
    new ApiResponse(200, reportData, "Report retrieved successfully")
  );
});

// Update report status (Staff/Admin only)
const updateReportStatus = asyncHandler(async (req, res) => {
  const { reportId } = req.params;
  const { status, message, estimatedResolutionDate } = req.body;

  const report = await Report.findOne({ reportId });
  if (!report) {
    throw new ApiError(404, "Report not found");
  }

  // Check if staff member is updating report from their department
  if (req.user.role === 'staff' && 
      report.department?.toString() !== req.user.department?.toString()) {
    throw new ApiError(403, "You can only update reports from your department");
  }

  // Update status
  if (status) {
    const validStatuses = ["pending", "acknowledged", "in-progress", "resolved", "rejected"];
    if (!validStatuses.includes(status)) {
      throw new ApiError(400, "Invalid status provided");
    }
    
    report.status = status;
    if (status === 'resolved') {
      report.resolvedDate = new Date();
    }
  }

  if (estimatedResolutionDate) {
    report.estimatedResolutionDate = new Date(estimatedResolutionDate);
  }

  // Add update message
  if (message) {
    report.updates.push({
      date: new Date(),
      message,
      updatedBy: req.user._id
    });
  }

  // Assign report to current user if not already assigned
  if (!report.assignedTo && req.user.role === 'staff') {
    report.assignedTo = req.user._id;
  }

  await report.save();

  const updatedReport = await Report.findById(report._id)
    .populate('reportedBy', 'name email')
    .populate('assignedTo', 'name')
    .populate('updates.updatedBy', 'name');

  res.status(200).json(
    new ApiResponse(200, updatedReport, "Report status updated successfully")
  );
});

// Add upvote to report
const upvoteReport = asyncHandler(async (req, res) => {
  const { reportId } = req.params;
  const userId = req.user._id;

  const report = await Report.findOne({ reportId });
  if (!report) {
    throw new ApiError(404, "Report not found");
  }

  // Check if report is resolved (can't upvote resolved reports)
  if (report.status === 'resolved') {
    throw new ApiError(400, "Cannot upvote resolved reports");
  }

  try {
    await report.addUpvote(userId);
    
    res.status(200).json(
      new ApiResponse(200, {
        upvoteCount: report.upvoteCount,
        priority: report.priority,
        priorityBreakdown: report.priorityBreakdown,
        hasUpvoted: true
      }, "Upvote added successfully")
    );
  } catch (error) {
    if (error.message === 'User has already upvoted this report') {
      throw new ApiError(400, error.message);
    }
    throw new ApiError(500, "Error adding upvote");
  }
});

// Remove upvote from report
const removeUpvote = asyncHandler(async (req, res) => {
  const { reportId } = req.params;
  const userId = req.user._id;

  const report = await Report.findOne({ reportId });
  if (!report) {
    throw new ApiError(404, "Report not found");
  }

  try {
    await report.removeUpvote(userId);
    
    res.status(200).json(
      new ApiResponse(200, {
        upvoteCount: report.upvoteCount,
        priority: report.priority,
        priorityBreakdown: report.priorityBreakdown,
        hasUpvoted: false
      }, "Upvote removed successfully")
    );
  } catch (error) {
    throw new ApiError(500, "Error removing upvote");
  }
});

// Add rating and feedback (Report creator only)
const addFeedback = asyncHandler(async (req, res) => {
  const { reportId } = req.params;
  const { rating, feedback } = req.body;

  const report = await Report.findOne({ reportId });
  if (!report) {
    throw new ApiError(404, "Report not found");
  }

  // Check if user is the report creator
  if (report.reportedBy.toString() !== req.user._id.toString()) {
    throw new ApiError(403, "Only the report creator can add feedback");
  }

  // Check if report is resolved
  if (report.status !== 'resolved') {
    throw new ApiError(400, "Feedback can only be added to resolved reports");
  }

  if (rating) {
    if (rating < 1 || rating > 5) {
      throw new ApiError(400, "Rating must be between 1 and 5");
    }
    report.rating = rating;
  }

  if (feedback) {
    report.feedback = feedback;
  }

  await report.save();

  res.status(200).json(
    new ApiResponse(200, { 
      rating: report.rating, 
      feedback: report.feedback 
    }, "Feedback added successfully")
  );
});

// Get user's reports
const getUserReports = asyncHandler(async (req, res) => {
  const userId = req.user._id;
  const { page = 1, limit = 10, status } = req.query;

  const filter = { reportedBy: userId };
  if (status) filter.status = status;

  const reports = await Report.find(filter)
    .populate('municipality', 'name')
    .populate('department', 'name')
    .populate('assignedTo', 'name')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .exec();

  const totalReports = await Report.countDocuments(filter);

  res.status(200).json(
    new ApiResponse(200, {
      reports,
      totalPages: Math.ceil(totalReports / limit),
      currentPage: parseInt(page),
      totalReports,
      hasNextPage: page < Math.ceil(totalReports / limit),
      hasPrevPage: page > 1
    }, "User reports retrieved successfully")
  );
});

// Get reports analytics (Admin/Staff only)
const getReportsAnalytics = asyncHandler(async (req, res) => {
  // Base filter for analytics
  let baseFilter = {};
  
  // If staff, only show analytics for their department
  if (req.user.role === 'staff') {
    baseFilter.department = req.user.department;
  }

  const analytics = await Report.aggregate([
    { $match: baseFilter },
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

  const categoryStats = await Report.aggregate([
    { $match: baseFilter },
    {
      $group: {
        _id: "$category",
        count: { $sum: 1 },
        avgPriority: { $avg: "$priority" },
        avgRating: { $avg: "$rating" },
        resolvedCount: {
          $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] }
        }
      }
    },
    { $sort: { count: -1 } }
  ]);

  const urgencyStats = await Report.aggregate([
    { $match: baseFilter },
    {
      $group: {
        _id: "$urgency",
        count: { $sum: 1 },
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
        ...baseFilter,
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
      overview: analytics[0] || {},
      categoryStats,
      urgencyStats,
      recentTrend,
      generatedAt: new Date()
    }, "Analytics retrieved successfully")
  );
});

// Delete report (Admin only)
const deleteReport = asyncHandler(async (req, res) => {
  const { reportId } = req.params;

  const report = await Report.findOne({ reportId });
  if (!report) {
    throw new ApiError(404, "Report not found");
  }

  // Delete associated media from Cloudinary
  if (report.media && report.media.publicId) {
    await deleteFromCloudinary(report.media.publicId);
  }

  await Report.findByIdAndDelete(report._id);

  res.status(200).json(
    new ApiResponse(200, {}, "Report deleted successfully")
  );
});

// Get reports by municipality (for municipal dashboard)
const getReportsByMunicipality = asyncHandler(async (req, res) => {
  const { municipalityId } = req.params;
  const { page = 1, limit = 10, status, category, priority } = req.query;

  // Check if user has access to this municipality
  if (req.user.role === 'staff' && req.user.municipality?.toString() !== municipalityId) {
    throw new ApiError(403, "Access denied to this municipality's reports");
  }

  const filter = { municipality: municipalityId };
  if (status) filter.status = status;
  if (category) filter.category = category;
  if (priority) filter.priority = priority;

  const reports = await Report.find(filter)
    .populate('reportedBy', 'name')
    .populate('department', 'name')
    .populate('assignedTo', 'name')
    .sort({ priority: -1, date: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .exec();

  const totalReports = await Report.countDocuments(filter);

  res.status(200).json(
    new ApiResponse(200, {
      reports,
      totalPages: Math.ceil(totalReports / limit),
      currentPage: parseInt(page),
      totalReports
    }, "Municipality reports retrieved successfully")
  );
});

export {
  createReport,
  getAllReports,
  getReportById,
  updateReportStatus,
  upvoteReport,
  removeUpvote,
  addFeedback,
  getUserReports,
  getReportsAnalytics,
  deleteReport,
  getReportsByMunicipality
};
