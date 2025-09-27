// report.controller.js
import { Report } from "../models/report.model.js";
import { Municipality } from "../models/municipality.model.js";
import { Department } from "../models/department.model.js";
import { uploadMediaOnCloudinary, deleteMediaOnCloudinary } from "../utils/cloudinary.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import axios from 'axios';
import fs from 'fs';

// Debug logging utility
const debugLog = (message, data = null, type = 'info') => {
  const timestamp = new Date().toISOString();
  const env = process.env.NODE_ENV || 'development';
  const logMessage = `[${timestamp}] [${env.toUpperCase()}] [REPORT] ${message}`;
  
  if (data) {
    console[type](logMessage, data);
  } else {
    console[type](logMessage);
  }
};

// Enhanced error handler
const handleError = (error, context = '') => {
  debugLog(`💥 Error in ${context}`, {
    message: error.message,
    stack: error.stack,
    code: error.code,
    status: error.status,
    response: error.response?.data
  }, 'error');
  
  return error;
};

// Helper Functions
const generateReportId = async (category) => {
    try {
        debugLog('🆕 Generating report ID', { category });
        const categoryCode = category.substring(0, 4).toUpperCase();
        const count = await Report.countDocuments({ category });
        const reportId = `${categoryCode}-${String(count + 1).padStart(3, '0')}`;
        debugLog('✅ Report ID generated', { reportId, count });
        return reportId;
    } catch (error) {
        throw handleError(error, 'generateReportId');
    }
};

const findNearestMunicipality = async (coordinates) => {
    try {
        const [longitude, latitude] = coordinates;
        debugLog('🔍 Finding nearest municipality', { longitude, latitude });
        
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
        
        debugLog('📍 Nearest municipality result', { 
            found: !!nearestMunicipality,
            name: nearestMunicipality?.name,
            id: nearestMunicipality?._id
        });
        
        return nearestMunicipality;
    } catch (error) {
        throw handleError(error, 'findNearestMunicipality');
    }
};

const reverseGeocode = async (coordinates) => {
    const [longitude, latitude] = coordinates;
    try {
        debugLog('🗺️ Reverse geocoding coordinates', { longitude, latitude });
        
        if (!process.env.OPENCAGE_API_KEY) {
            debugLog('❌ OpenCage API key missing', {}, 'warn');
            return null;
        }

        const response = await axios.get(`https://api.opencagedata.com/geocode/v1/json`, {
            params: {
                q: `${latitude},${longitude}`,
                key: process.env.OPENCAGE_API_KEY,
                language: 'en',
                countrycode: 'in',
                timeout: 10000 // 10 second timeout
            },
            timeout: 10000
        });

        debugLog('🗺️ Reverse geocoding response', {
            status: response.status,
            resultsCount: response.data.results?.length
        });

        if (response.data.results && response.data.results.length > 0) {
            const result = response.data.results[0];
            const district = result.components.state_district ||
                result.components.county ||
                result.components.district;
            
            debugLog('📍 Reverse geocoding success', { district });
            return district;
        }
        
        debugLog('❌ No results from reverse geocoding');
        return null;
    } catch (error) {
        debugLog('💥 Reverse geocoding failed', {
            message: error.message,
            code: error.code,
            apiKeyExists: !!process.env.OPENCAGE_API_KEY
        }, 'warn');
        return null;
    }
};

const findMunicipalityByDistrict = async (districtName) => {
    try {
        if (!districtName) {
            debugLog('❌ No district name provided for municipality search');
            return null;
        }
        
        debugLog('🔍 Finding municipality by district', { districtName });
        
        const municipality = await Municipality.findOne({
            district: { $regex: new RegExp(districtName, 'i') },
        });
        
        debugLog('📍 Municipality by district result', {
            found: !!municipality,
            name: municipality?.name,
            id: municipality?._id
        });
        
        return municipality;
    } catch (error) {
        throw handleError(error, 'findMunicipalityByDistrict');
    }
};

// Get user's reports with enhanced debugging
export const getUserReports = asyncHandler(async (req, res) => {
    debugLog('👤 GET USER REPORTS STARTED', {
        userId: req.user?._id,
        userRole: req.user?.role,
        query: req.query,
        url: req.originalUrl,
        method: req.method
    });

    try {
        const userId = req.user._id;
        const { page = 1, limit = 10, status } = req.query;

        debugLog('📋 Query parameters', { page, limit, status, userId });

        // Validate user exists and has proper ID
        if (!userId) {
            debugLog('❌ User ID is missing from request');
            throw new ApiError(400, "User ID is required");
        }

        const filter = { reportedBy: userId };
        if (status) {
            filter.status = status;
            debugLog('🔍 Status filter applied', { status });
        }

        debugLog('🔍 Database filter for user reports', { filter });

        // Test database connection first
        try {
            const testConnection = await Report.findOne().limit(1);
            debugLog('✅ Database connection test successful');
        } catch (dbError) {
            debugLog('❌ Database connection failed', { error: dbError.message }, 'error');
            throw new ApiError(500, "Database connection error");
        }

        // Execute the query with error handling
        let reports;
        let totalReports;
        
        try {
            debugLog('🔍 Executing database query for user reports');
            reports = await Report.find(filter)
                .populate('municipality', 'name')
                .populate('department', 'name')
                .populate('assignedTo', 'name')
                .sort({ createdAt: -1 })
                .limit(parseInt(limit) * 1)
                .skip((parseInt(page) - 1) * parseInt(limit))
                .exec();

            totalReports = await Report.countDocuments(filter);
            debugLog('✅ Database query successful', {
                reportsCount: reports.length,
                totalReports,
                page: parseInt(page),
                limit: parseInt(limit)
            });

        } catch (queryError) {
            debugLog('💥 Database query failed', {
                error: queryError.message,
                filter,
                stack: queryError.stack
            }, 'error');
            
            // Check for specific MongoDB errors
            if (queryError.name === 'CastError') {
                throw new ApiError(400, "Invalid user ID format");
            } else if (queryError.name === 'MongoNetworkError') {
                throw new ApiError(503, "Database service unavailable");
            } else {
                throw new ApiError(500, "Error retrieving user reports");
            }
        }

        // Add content summary for each report
        const reportsWithSummary = reports.map(report => {
            try {
                const reportObj = report.toObject();
                reportObj.contentSummary = report.getContentSummary ? 
                    report.getContentSummary() : 
                    (report.description || '[Voice Message]');
                return reportObj;
            } catch (summaryError) {
                debugLog('⚠️ Error creating content summary', {
                    reportId: report.reportId,
                    error: summaryError.message
                }, 'warn');
                const reportObj = report.toObject();
                reportObj.contentSummary = report.description || '[Content not available]';
                return reportObj;
            }
        });

        const responseData = {
            reports: reportsWithSummary,
            pagination: {
                totalPages: Math.ceil(totalReports / parseInt(limit)),
                currentPage: parseInt(page),
                totalReports,
                hasNextPage: parseInt(page) < Math.ceil(totalReports / parseInt(limit)),
                hasPrevPage: parseInt(page) > 1,
                limit: parseInt(limit)
            }
        };

        debugLog('📤 Sending successful response', {
            reportsCount: reportsWithSummary.length,
            totalReports,
            pagination: responseData.pagination
        });

        res.status(200).json(
            new ApiResponse(200, responseData, "User reports retrieved successfully")
        );

    } catch (error) {
        debugLog('💥 Error in getUserReports', {
            userId: req.user?._id,
            error: error.message,
            stack: error.stack,
            query: req.query
        }, 'error');

        // Handle specific error types
        if (error instanceof ApiError) {
            throw error;
        } else if (error.name === 'ValidationError') {
            throw new ApiError(400, "Invalid query parameters");
        } else if (error.name === 'CastError') {
            throw new ApiError(400, "Invalid ID format");
        } else {
            throw new ApiError(500, "Internal server error while fetching user reports");
        }
    }
});

// Create report with single image + optional voice message
export const createReport = asyncHandler(async (req, res) => {
    debugLog('📝 CREATE REPORT STARTED', {
        user: req.user?._id,
        body: req.body,
        files: req.files ? Object.keys(req.files) : 'none'
    });

    const { title, category, urgency, description, location } = req.body;
    const userId = req.user._id;

    // Validate required fields
    if (!title || !category) {
        debugLog('❌ Missing required fields', { title: !!title, category: !!category });
        throw new ApiError(400, "Title and category are required");
    }

    // Check if we have either description OR voice message
    const hasDescription = description && description.trim();
    const hasVoiceMessage = req.files?.voiceMessage && req.files.voiceMessage[0];

    debugLog('📋 Content validation', {
        hasDescription,
        hasVoiceMessage: !!hasVoiceMessage,
        voiceMessageFile: hasVoiceMessage ? req.files.voiceMessage[0].originalname : 'none'
    });

    if (!hasDescription && !hasVoiceMessage) {
        debugLog('❌ Missing content: neither description nor voice message provided');
        throw new ApiError(400, "Either description or voice message is required");
    }

    // Parse and validate location coordinates
    let coordinates;
    if (location?.coordinates) {
        if (typeof location.coordinates === 'string') {
            try {
                coordinates = JSON.parse(location.coordinates);
                debugLog('📍 Parsed coordinates from string', { coordinates });
            } catch (error) {
                debugLog('❌ Invalid coordinates format (string parse failed)', { coordinates: location.coordinates });
                throw new ApiError(400, "Invalid coordinates format");
            }
        } else {
            coordinates = location.coordinates;
            debugLog('📍 Using coordinates directly', { coordinates });
        }
    } else {
        debugLog('❌ Missing location coordinates');
        throw new ApiError(400, "Location coordinates are required");
    }

    if (!Array.isArray(coordinates) || coordinates.length !== 2) {
        debugLog('❌ Invalid coordinates format', { coordinates });
        throw new ApiError(400, "Coordinates must be an array with [longitude, latitude]");
    }

    const [longitude, latitude] = coordinates.map(coord => parseFloat(coord));
    if (isNaN(longitude) || isNaN(latitude)) {
        debugLog('❌ Invalid coordinate values', { longitude, latitude });
        throw new ApiError(400, "Coordinates must be valid numbers");
    }

    location.coordinates = [longitude, latitude];
    debugLog('📍 Final coordinates', { longitude, latitude });

    const reportId = await generateReportId(category);
    debugLog('🆕 Generated report ID', { reportId, category });
    
    let imageData = null;
    let voiceMessageData = null;
    let uploadedFiles = [];

    try {
        // Handle single image upload
        if (req.files?.image && req.files.image[0]) {
            const imageFile = req.files.image[0];
            uploadedFiles.push(imageFile.path);
            
            debugLog('📁 Uploading image', {
                filename: imageFile.originalname,
                size: imageFile.size,
                path: imageFile.path
            });
            
            const imageUpload = await uploadMediaOnCloudinary(imageFile.path, 'media');
            
            if (imageUpload) {
                imageData = {
                    url: imageUpload.url,
                    publicId: imageUpload.publicId,
                    uploadedAt: new Date()
                };
                debugLog('✅ Image uploaded successfully', {
                    url: imageUpload.url ? 'yes' : 'no',
                    publicId: imageUpload.publicId ? 'yes' : 'no'
                });
            } else {
                debugLog('❌ Image upload failed - no data returned');
            }
        } else {
            debugLog('📷 No image provided for upload');
        }

        // Handle voice message upload
        if (hasVoiceMessage) {
            const voiceFile = req.files.voiceMessage[0];
            uploadedFiles.push(voiceFile.path);
            
            debugLog('🎤 Uploading voice message', {
                filename: voiceFile.originalname,
                size: voiceFile.size,
                path: voiceFile.path
            });
            
            const voiceUpload = await uploadMediaOnCloudinary(voiceFile.path, 'voice');
            
            if (voiceUpload) {
                voiceMessageData = {
                    url: voiceUpload.url,
                    publicId: voiceUpload.publicId,
                    duration: voiceUpload.duration || 0,
                    uploadedAt: new Date()
                };
                debugLog('✅ Voice message uploaded successfully', {
                    url: voiceUpload.url ? 'yes' : 'no',
                    publicId: voiceUpload.publicId ? 'yes' : 'no',
                    duration: voiceUpload.duration
                });
            } else {
                debugLog('❌ Voice message upload failed - no data returned');
            }
        } else {
            debugLog('🎤 No voice message provided for upload');
        }

        // Find municipality for the location
        debugLog('🔍 Starting municipality search');
        let selectedMunicipality = await findNearestMunicipality(location.coordinates);
        let selectionMethod = "nearest";

        if (!selectedMunicipality) {
            debugLog('📍 No municipality found within 20km, trying reverse geocoding...');
            const districtName = await reverseGeocode(location.coordinates);
            if (districtName) {
                selectedMunicipality = await findMunicipalityByDistrict(districtName);
                selectionMethod = "district-based";
                debugLog(`📍 Found municipality via district`, { districtName, municipality: selectedMunicipality?.name });
            } else {
                debugLog('❌ No district found via reverse geocoding');
            }
        }

        if (!selectedMunicipality) {
            debugLog('❌ No municipality found for location', { coordinates: location.coordinates });
            throw new ApiError(404, "No municipality found for this location. Please contact support.");
        }

        debugLog('✅ Municipality selected', {
            name: selectedMunicipality.name,
            method: selectionMethod,
            id: selectedMunicipality._id
        });

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
            debugLog('📝 Description added to report');
        }

        // Add voice message if provided
        if (voiceMessageData) {
            reportData.voiceMessage = voiceMessageData;
            debugLog('🎤 Voice message added to report');
        }

        // Add image if provided
        if (imageData) {
            reportData.image = imageData;
            debugLog('📷 Image added to report');
        }

        // Auto-assign to department based on category (if not "Other")
        if (category !== "Other") {
            debugLog('🔍 Looking for department for category', { category });
            const department = await Department.findOne({
                municipality: selectedMunicipality._id,
                categories: { $in: [category] }
            });

            if (department) {
                reportData.department = department._id;
                reportData.assignmentType = "automatic";
                reportData.status = "assigned";
                debugLog('✅ Department auto-assigned', { department: department.name });
            } else {
                debugLog('❌ No department found for category', { category });
                reportData.status = "pending_assignment";
                reportData.assignmentType = "pending";
            }
        } else {
            reportData.status = "pending_assignment";
            reportData.assignmentType = "pending";
            debugLog('⚡ Category is "Other", set to pending assignment');
        }

        debugLog('💾 Creating report in database', { reportData: Object.keys(reportData) });
        const report = await Report.create(reportData);
        debugLog('✅ Report created successfully', { reportId: report.reportId });

        const populatedReport = await Report.findById(report._id)
            .populate('reportedBy', 'name email')
            .populate('municipality', 'name district')
            .populate('department', 'name');

        // Clean up uploaded files
        uploadedFiles.forEach(path => {
            if (fs.existsSync(path)) {
                fs.unlinkSync(path);
                debugLog('🧹 Cleaned up local file', { path });
            }
        });

        debugLog('📤 Sending success response');
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
        debugLog('💥 Error in createReport', {
            message: error.message,
            stack: error.stack
        }, 'error');

        // Clean up uploaded files on error
        uploadedFiles.forEach(path => {
            if (fs.existsSync(path)) {
                try {
                    fs.unlinkSync(path);
                    debugLog('🧹 Cleaned up local file on error', { path });
                } catch (cleanupError) {
                    debugLog('❌ Failed to clean up file', { path, error: cleanupError.message }, 'warn');
                }
            }
        });

        // Clean up uploaded media from Cloudinary on error
        try {
            if (voiceMessageData?.publicId) {
                await deleteMediaOnCloudinary(voiceMessageData.publicId, 'video');
                debugLog('🧹 Cleaned up Cloudinary voice message on error', { publicId: voiceMessageData.publicId });
            }
            
            if (imageData?.publicId) {
                await deleteMediaOnCloudinary(imageData.publicId, 'image');
                debugLog('🧹 Cleaned up Cloudinary image on error', { publicId: imageData.publicId });
            }
        } catch (cleanupError) {
            debugLog('❌ Failed to clean up Cloudinary assets', { error: cleanupError.message }, 'warn');
        }

        throw handleError(error, 'createReport');
    }
});

// Get all reports with enhanced filtering
export const getAllReports = asyncHandler(async (req, res) => {
    debugLog('📋 GET ALL REPORTS STARTED', {
        user: req.user?._id,
        role: req.user?.role,
        query: req.query
    });

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
        debugLog('👤 Citizen filter applied', { userId: req.user._id });
    } else if (req.user.role === 'staff') {
        filter.department = req.user.department;
        debugLog('👨‍💼 Staff filter applied', { department: req.user.department });
    }

    debugLog('🔍 Database query filter', { filter });

    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    try {
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

        debugLog('✅ Reports query successful', {
            count: reports.length,
            totalReports,
            page,
            limit
        });

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

    } catch (error) {
        debugLog('💥 Error in getAllReports', {
            message: error.message,
            stack: error.stack,
            filter
        }, 'error');
        throw handleError(error, 'getAllReports');
    }
});

// Add debug endpoint to help diagnose issues
export const debugEndpoint = asyncHandler(async (req, res) => {
    debugLog('🔧 DEBUG ENDPOINT CALLED', {
        user: req.user,
        headers: req.headers,
        environment: process.env.NODE_ENV,
        nodeVersion: process.version
    });

    // Test database connection
    try {
        const dbTest = await Report.countDocuments();
        debugLog('✅ Database connection test passed', { count: dbTest });
    } catch (dbError) {
        debugLog('❌ Database connection test failed', { error: dbError.message }, 'error');
    }

    // Test environment variables
    const envVars = {
        NODE_ENV: process.env.NODE_ENV,
        OPENCAGE_API_KEY: process.env.OPENCAGE_API_KEY ? 'SET' : 'MISSING',
        CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME ? 'SET' : 'MISSING',
        ACCESS_TOKEN_SECRET: process.env.ACCESS_TOKEN_SECRET ? 'SET' : 'MISSING',
        MONGODB_URI: process.env.MONGODB_URI ? 'SET (first 20 chars): ' + process.env.MONGODB_URI.substring(0, 20) + '...' : 'MISSING'
    };

    debugLog('🔧 Environment variables check', envVars);

    res.status(200).json(
        new ApiResponse(200, {
            timestamp: new Date().toISOString(),
            environment: process.env.NODE_ENV,
            nodeVersion: process.version,
            environmentVariables: envVars,
            user: req.user ? {
                id: req.user._id,
                role: req.user.role,
                department: req.user.department
            } : 'No user',
            database: {
                connected: true, // Assuming we got here, DB is connected
                reportCount: await Report.countDocuments()
            }
        }, "Debug information retrieved successfully")
    );
});

// ... (keep other functions like getReportById, updateReportStatus, etc. with similar debug enhancements)

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

