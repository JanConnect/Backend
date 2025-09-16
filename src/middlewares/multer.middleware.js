import multer from "multer";
import path from 'path';
import { ApiError } from "../utils/ApiError.js";

const storage = multer.diskStorage({
    destination: function(req, file, cb) {
        cb(null, './public/temp');
    },
    filename: function(req, file, cb) {
        const ext = path.extname(file.originalname);      
        const baseName = path.basename(file.originalname, ext); 
        const newFileName = `${baseName}-${Date.now()}${ext}`; 
        cb(null, newFileName);
    }
});

// File filter to validate file types
const fileFilter = (req, file, cb) => {
    console.log(`📁 Processing file: ${file.fieldname} - ${file.originalname}`);
    
    // Voice message validation
    if (file.fieldname === 'voiceMessage') {
        if (file.mimetype.startsWith('audio/')) {
            cb(null, true);
        } else {
            cb(new ApiError(400, "Voice message must be an audio file"), false);
        }
    }
    // Image validation (for reports, resolution images, avatars)
    else if (file.fieldname === 'image' || 
             file.fieldname === 'resolutionImage' || 
             file.fieldname === 'avatar') {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new ApiError(400, "Only image files are allowed"), false);
        }
    }
    // Reject unexpected fields
    else {
        cb(new ApiError(400, "Unexpected field: " + file.fieldname), false);
    }
};

export const upload = multer({
    storage,
    fileFilter,
    limits: {
        fileSize: 10 * 1024 * 1024, // 10MB max file size
        files: 2 // Maximum 2 files (1 image + 1 voice message)
    }
});

// Error handling middleware for multer
export const handleMulterError = (error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({
                success: false,
                message: "File too large. Maximum size is 10MB"
            });
        }
        if (error.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({
                success: false,
                message: "Too many files. Maximum is 2 files"
            });
        }
        if (error.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
                success: false,
                message: "Unexpected field: " + error.field
            });
        }
    }
    
    if (error instanceof ApiError) {
        return res.status(error.statusCode).json({
            success: false,
            message: error.message
        });
    }
    
    next(error);
};
