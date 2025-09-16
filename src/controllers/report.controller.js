import { Report } from "../models/report.model.js";
import { Municipality } from "../models/municipality.model.js";
import { Department } from "../models/department.model.js";
import { uploadMediaOnCloudinary, deleteMediaOnCloudinary } from "../utils/cloudinary.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import axios from 'axios';
import fs from 'fs';

// Helper Functions
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
        }
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

// Create report with single image + optional voice message
export const createReport = asyncHandler(async (req, res) => {
    const { title, category, urgency, description, location } = req.body;
    const userId = req.user._id;

    // Validate required fields
    if (!title || !category) {
        throw new ApiError(400, "Title and category are required");
    }

    // Check if we have either description OR voice message
    const hasDescription = description && description.trim();
    const hasVoiceMessage = req.files?.voiceMessage && req.files.voiceMessage[0];

    if (!hasDescription && !hasVoiceMessage) {
        throw new ApiError(400, "Either description or voice message is required");
    }

    // Parse and validate location coordinates
    let coordinates;
    if (location?.coordinates) {
        if (typeof location.coordinates === 'string') {
            try {
                coordinates = JSON.parse(location.coordinates);
            } catch (error) {
                throw new ApiError(400, "Invalid coordinates format");
            }
        } else {
            coordinates = location.coordinates;
        }
    } else {
        throw new ApiError(400, "Location coordinates are required");
    }

    if (!Array.isArray(coordinates) || coordinates.length !== 2) {
        throw new ApiError(400, "Coordinates must be an array with [longitude, latitude]");
    }

    const [longitude, latitude] = coordinates.map(coord => parseFloat(coord));
    if (isNaN(longitude) || isNaN(latitude)) {
        throw new ApiError(400, "Coordinates must be valid numbers");
    }

    location.coordinates = [longitude, latitude];

    const reportId = await generateReportId(category);
    
    let imageData = null;
    let voiceMessageData = null;
    let uploadedFiles = [];

    try {
        // Handle single image upload
        if (req.files?.image && req.files.image[0]) {
            const imageFile = req.files.image[0];
            uploadedFiles.push(imageFile.path);
            
            console.log(`📁 Uploading image:`, imageFile.originalname);
            const imageUpload = await uploadMediaOnCloudinary(imageFile.path, 'media');
            
            if (imageUpload) {
                imageData = {
                    url: imageUpload.url,
                    publicId: imageUpload.publicId,
                    uploadedAt: new Date()
                };
                console.log(`✅ Image uploaded successfully`);
            }
        }

        // Handle voice message upload
        if (hasVoiceMessage) {
            const voiceFile = req.files.voiceMessage[0];
            uploadedFiles.push(voiceFile.path);
            
            console.log(`📁 Uploading voice message:`, voiceFile.originalname);
            const voiceUpload = await uploadMediaOnCloudinary(voiceFile.path, 'voice');
            
            if (voiceUpload) {
                voiceMessageData = {
                    url: voiceUpload.url,
                    publicId: voiceUpload.publicId,
                    duration: voiceUpload.duration || 0,
                    uploadedAt: new Date()
                };
                console.log(`✅ Voice message uploaded successfully`);
            }
        }

        // Find municipality for the location
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

        // Create report data
        const reportData = {
            reportId,
            title,
            category,
            urgency: urgency || "medium",
            location,
            reportedBy: userId,
            municipality: selectedMunicipality._id
        };

        // Add description if provided
        if (hasDescription) {
            reportData.description = description.trim();
        }

        // Add voice message if provided
        if (voiceMessageData) {
            reportData.voiceMessage = voiceMessageData;
        }

        // Add image if provided
        if (imageData) {
            reportData.image = imageData;
        }

        // Auto-assign to department based on category (if not "Other")
        if (category !== "Other") {
            const department = await Department.findOne({
                municipality: selectedMunicipality._id,
                categories: { $in: [category] }
            });

            if (department) {
                reportData.department = department._id;
                reportData.assignmentType = "automatic";
                reportData.status = "assigned";
            }
        } else {
            reportData.status = "pending_assignment";
            reportData.assignmentType = "pending";
        }

        const report = await Report.create(reportData);

        const populatedReport = await Report.findById(report._id)
            .populate('reportedBy', 'name email')
            .populate('municipality', 'name district')
            .populate('department', 'name');

        // Clean up uploaded files
        uploadedFiles.forEach(path => {
            if (fs.existsSync(path)) {
                fs.unlinkSync(path);
            }
        });

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
        // Clean up uploaded files on error
        uploadedFiles.forEach(path => {
            if (fs.existsSync(path)) {
                fs.unlinkSync(path);
            }
        });

        // Clean up uploaded media from Cloudinary on error
        if (voiceMessageData?.publicId) {
            await deleteMediaOnCloudinary(voiceMessageData.publicId, 'video');
        }
        
        if (imageData?.publicId) {
            await deleteMediaOnCloudinary(imageData.publicId, 'image');
        }

        throw error;
    }
});

// Get all reports with enhanced filtering
export const getAllReports = asyncHandler(async (req, res) => {
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
        search,
        hasVoiceMessage,
        hasImage
    } = req.query;

    const filter = {};
    
    // Basic filters
    if (status) filter.status = status;
    if (category) filter.category = category;
    if (urgency) filter.urgency = urgency;
    if (priority) filter.priority = priority;
    if (municipality) filter.municipality = municipality;
    if (department) filter.department = department;

    // Media filters
    if (hasVoiceMessage === 'true') filter['voiceMessage.url'] = { $exists: true };
    if (hasImage === 'true') filter['image.url'] = { $exists: true };

    // Search functionality
    if (search) {
        filter.$or = [
            { title: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } },
            { reportId: { $regex: search, $options: 'i' } },
            { 'voiceMessage.transcription': { $regex: search, $options: 'i' } }
        ];
    }

    // Role-based filtering
    if (req.user.role === 'citizen') {
        filter.$or = [
            { reportedBy: req.user._id },
            { status: { $in: ['acknowledged', 'in-progress', 'resolved'] } }
        ];
    } else if (req.user.role === 'staff') {
        filter.department = req.user.department;
    }

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

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

    // Add content summary for each report
    const reportsWithSummary = reports.map(report => {
        const reportObj = report.toObject();
        reportObj.contentSummary = report.getContentSummary ? 
            report.getContentSummary() : 
            (report.description || '[Voice Message]');
        return reportObj;
    });

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

// Get report by ID
export const getReportById = asyncHandler(async (req, res) => {
    const { reportId } = req.params;

    const report = await Report.findOne({ reportId })
        .populate('reportedBy', 'name email phone')
        .populate('municipality', 'name admin')
        .populate('department', 'name')
        .populate('assignedTo', 'name email')
        .populate('updates.updatedBy', 'name')
        .populate('resolutionEvidence.workCompletedBy', 'name')
        .populate({
            path: 'upvotes.userId',
            select: 'name'
        });

    if (!report) {
        throw new ApiError(404, "Report not found");
    }

    // Check permissions
    const isOwner = report.reportedBy._id.toString() === req.user._id.toString();
    const isStaffOfDepartment = req.user.role === 'staff' &&
        report.department?._id.toString() === req.user.department?.toString();
    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);

    if (!isOwner && !isStaffOfDepartment && !isAdmin) {
        throw new ApiError(403, "Access denied");
    }

    // Check if current user has upvoted
    const hasUpvoted = report.upvotes.some(upvote =>
        upvote.userId._id.toString() === req.user._id.toString()
    );

    const reportData = report.toObject();
    reportData.hasUpvoted = hasUpvoted;
    reportData.contentSummary = report.getContentSummary ? report.getContentSummary() : 
        (report.description || '[Voice Message]');

    res.status(200).json(
        new ApiResponse(200, reportData, "Report retrieved successfully")
    );
});

// Update report status with single resolution image
export const updateReportStatus = asyncHandler(async (req, res) => {
    const { reportId } = req.params;
    const { status, message, resolutionNotes, materialsCost, laborHours } = req.body;

    const report = await Report.findOne({ reportId });
    if (!report) {
        throw new ApiError(404, "Report not found");
    }

    // Permission check
    if (req.user.role === 'staff' &&
        report.department?.toString() !== req.user.department?.toString()) {
        throw new ApiError(403, "You can only update reports from your department");
    }

    const validStatuses = ["pending", "acknowledged", "in-progress", "resolved", "rejected", "pending_assignment"];
    if (status && !validStatuses.includes(status)) {
        throw new ApiError(400, "Invalid status provided");
    }

    let resolutionImageData = null;
    
    // Handle single resolution image upload for resolved reports
    if (status === 'resolved' && req.file) {
        try {
            console.log(`📁 Uploading resolution image:`, req.file.originalname);
            const imageUpload = await uploadMediaOnCloudinary(req.file.path, 'resolution');
            
            if (imageUpload) {
                resolutionImageData = {
                    url: imageUpload.url,
                    publicId: imageUpload.publicId,
                    uploadedAt: new Date(),
                    description: `Resolution evidence for ${report.title}`,
                    uploadedBy: req.user._id
                };
                console.log(`✅ Resolution image uploaded successfully`);
            }

            // Clean up local file
            if (fs.existsSync(req.file.path)) {
                fs.unlinkSync(req.file.path);
            }
        } catch (error) {
            // Clean up uploaded image on error
            if (resolutionImageData?.publicId) {
                await deleteMediaOnCloudinary(resolutionImageData.publicId, 'image');
            }
            throw error;
        }
    }

    // Update report status
    if (status) {
        report.status = status;
        
        if (status === 'resolved') {
            report.resolvedDate = new Date();
            report.resolutionTime = (new Date() - report.date) / (1000 * 60 * 60); // hours
            
            if (resolutionImageData || resolutionNotes || materialsCost || laborHours) {
                report.resolutionEvidence = {
                    ...report.resolutionEvidence,
                    resolutionImage: resolutionImageData,
                    resolutionNotes,
                    workCompletedBy: req.user._id,
                    completionDate: new Date(),
                    materialsCost,
                    laborHours
                };
            }
        }
    }

    // Add status update message
    if (message) {
        report.updates.push({
            date: new Date(),
            message,
            updatedBy: req.user._id
        });
    }

    // Auto-assign to current staff member if not assigned
    if (!report.assignedTo && req.user.role === 'staff') {
        report.assignedTo = req.user._id;
    }

    await report.save();

    const updatedReport = await Report.findById(report._id)
        .populate('reportedBy', 'name email')
        .populate('assignedTo', 'name')
        .populate('updates.updatedBy', 'name')
        .populate('resolutionEvidence.workCompletedBy', 'name');

    res.status(200).json(
        new ApiResponse(200, updatedReport, "Report status updated successfully")
    );
});

// Add upvote to report
export const upvoteReport = asyncHandler(async (req, res) => {
    const { reportId } = req.params;
    const userId = req.user._id;

    const report = await Report.findOne({ reportId });
    if (!report) {
        throw new ApiError(404, "Report not found");
    }

    if (report.status === 'resolved') {
        throw new ApiError(400, "Cannot upvote resolved reports");
    }

    try {
        if (report.addUpvote) {
            await report.addUpvote(userId);
        } else {
            // Fallback manual implementation
            const existingUpvote = report.upvotes.find(upvote =>
                upvote.userId.toString() === userId.toString()
            );
            
            if (existingUpvote) {
                throw new ApiError(400, "User has already upvoted this report");
            }
            
            report.upvotes.push({ userId });
            report.upvoteCount = report.upvotes.length;
            await report.save();
        }

        res.status(200).json(
            new ApiResponse(200, {
                upvoteCount: report.upvoteCount,
                priority: report.priority,
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
export const removeUpvote = asyncHandler(async (req, res) => {
    const { reportId } = req.params;
    const userId = req.user._id;

    const report = await Report.findOne({ reportId });
    if (!report) {
        throw new ApiError(404, "Report not found");
    }

    try {
        if (report.removeUpvote) {
            await report.removeUpvote(userId);
        } else {
            // Fallback manual implementation
            report.upvotes = report.upvotes.filter(upvote =>
                upvote.userId.toString() !== userId.toString()
            );
            report.upvoteCount = report.upvotes.length;
            await report.save();
        }

        res.status(200).json(
            new ApiResponse(200, {
                upvoteCount: report.upvoteCount,
                priority: report.priority,
                hasUpvoted: false
            }, "Upvote removed successfully")
        );
    } catch (error) {
        throw new ApiError(500, "Error removing upvote");
    }
});

// Add rating and feedback
export const addFeedback = asyncHandler(async (req, res) => {
    const { reportId } = req.params;
    const { rating, feedback } = req.body;

    const report = await Report.findOne({ reportId });
    if (!report) {
        throw new ApiError(404, "Report not found");
    }

    if (report.reportedBy.toString() !== req.user._id.toString()) {
        throw new ApiError(403, "Only the report creator can add feedback");
    }

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
export const getUserReports = asyncHandler(async (req, res) => {
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

    // Add content summary for each report
    const reportsWithSummary = reports.map(report => {
        const reportObj = report.toObject();
        reportObj.contentSummary = report.getContentSummary ? 
            report.getContentSummary() : 
            (report.description || '[Voice Message]');
        return reportObj;
    });

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
        }, "User reports retrieved successfully")
    );
});

// Get reports analytics
export const getReportsAnalytics = asyncHandler(async (req, res) => {
    let baseFilter = {};

    // Role-based filter
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
                resolvedReports: {
                    $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] }
                },
                reportsWithVoice: {
                    $sum: { $cond: [{ $ne: ["$voiceMessage.url", null] }, 1, 0] }
                },
                reportsWithImage: {
                    $sum: { $cond: [{ $ne: ["$image.url", null] }, 1, 0] }
                },
                avgRating: { $avg: "$rating" },
                totalUpvotes: { $sum: "$upvoteCount" },
                avgPriority: { $avg: "$priority" }
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
                voiceMessageCount: {
                    $sum: { $cond: [{ $ne: ["$voiceMessage.url", null] }, 1, 0] }
                }
            }
        },
        { $sort: { count: -1 } }
    ]);

    res.status(200).json(
        new ApiResponse(200, {
            overview: analytics[0] || {},
            categoryStats,
            generatedAt: new Date()
        }, "Analytics retrieved successfully")
    );
});

// Add comment to report
export const addComment = asyncHandler(async (req, res) => {
    const { reportId } = req.params;
    const { message } = req.body;

    if (!message || !message.trim()) {
        throw new ApiError(400, "Comment message is required");
    }

    const report = await Report.findOne({ reportId });
    if (!report) {
        throw new ApiError(404, "Report not found");
    }

    report.updates.push({
        date: new Date(),
        message: message.trim(),
        updatedBy: req.user._id
    });

    await report.save();

    const updatedReport = await Report.findById(report._id)
        .populate('updates.updatedBy', 'name role');

    res.status(200).json(
        new ApiResponse(200, updatedReport.updates, "Comment added successfully")
    );
});

// Get report comments
export const getReportComments = asyncHandler(async (req, res) => {
    const { reportId } = req.params;

    const report = await Report.findOne({ reportId })
        .populate('updates.updatedBy', 'name role avatar')
        .select('updates');

    if (!report) {
        throw new ApiError(404, "Report not found");
    }

    res.status(200).json(
        new ApiResponse(200, report.updates, "Comments retrieved successfully")
    );
});

// Delete report (Admin only)
export const deleteReport = asyncHandler(async (req, res) => {
    const { reportId } = req.params;

    const report = await Report.findOne({ reportId });
    if (!report) {
        throw new ApiError(404, "Report not found");
    }

    // Delete associated media from Cloudinary
    if (report.image?.publicId) {
        await deleteMediaOnCloudinary(report.image.publicId, 'image');
    }

    // Delete voice message from Cloudinary
    if (report.voiceMessage?.publicId) {
        await deleteMediaOnCloudinary(report.voiceMessage.publicId, 'video');
    }

    // Delete resolution evidence from Cloudinary
    if (report.resolutionEvidence?.resolutionImage?.publicId) {
        await deleteMediaOnCloudinary(report.resolutionEvidence.resolutionImage.publicId, 'image');
    }

    await Report.findByIdAndDelete(report._id);

    res.status(200).json(
        new ApiResponse(200, {}, "Report deleted successfully")
    );
});

