import { v2 as cloudinary } from 'cloudinary';
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

cloudinary.config({ 
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
    api_key: process.env.CLOUDINARY_API_KEY, 
    api_secret: process.env.CLOUDINARY_API_SECRET
});

export default cloudinary;

// Basic upload function (for avatars, simple files)
const uploadOnCloudinary = async (localFilePath) => {
    try {
        if (!localFilePath) return null;
        
        const response = await cloudinary.uploader.upload(localFilePath, {
            resource_type: "auto",
            quality: "auto:good",
            fetch_format: "auto"
        });
        
        console.log("File uploaded on cloudinary. File src: " + response.url);
        
        // Clean up local file
        if (fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
        }
        
        return response;
    } catch (error) {
        console.log("Error on cloudinary ", error);
        
        // Clean up local file even on error
        if (fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
        }
        
        return null;
    }
};

// Basic delete function
const deleteFromCloudinary = async (publicId, type = "image") => {
    try {
        if (!publicId) return null;
        
        const result = await cloudinary.uploader.destroy(publicId, {
            resource_type: type
        });
        
        console.log("Deleted from cloudinary. Public ID: ", publicId);
        return result;
    } catch (error) {
        console.log("Error deleting from cloudinary", error);
        return null;
    }
};

// Enhanced media upload function for reports
const uploadMediaOnCloudinary = async (localFilePath, mediaType = "auto") => {
    try {
        if (!localFilePath) return null;

        // Determine folder based on media type
        let folder = "civic-reports/media";
        if (localFilePath.includes('voice') || mediaType === 'voice') {
            folder = "civic-reports/voice-messages";
        } else if (localFilePath.includes('resolution') || mediaType === 'resolution') {
            folder = "civic-reports/resolution-evidence";
        }

        const response = await cloudinary.uploader.upload(localFilePath, {
            resource_type: "auto",   // auto detects (image/video/audio)
            folder: folder,
            quality: "auto:good",
            fetch_format: "auto"
        });

        console.log("Media uploaded to Cloudinary:", response.secure_url);

        // Remove local file after upload
        if (fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
        }

        return {
            url: response.secure_url,
            publicId: response.public_id,  // Use consistent naming
            resourceType: response.resource_type,
            duration: response.duration || null, // For audio/video files
            format: response.format
        };
    } catch (error) {
        console.error("Error uploading media to Cloudinary:", error);

        // Clean up local file on error
        if (fs.existsSync(localFilePath)) {
            fs.unlinkSync(localFilePath);
        }

        return null;
    }
};

// Enhanced media delete function
const deleteMediaOnCloudinary = async (publicId, resourceType = "image") => {
    try {
        if (!publicId) return false;
        
        // Audio is treated as "video" by Cloudinary
        if (resourceType === "audio") resourceType = "video";

        const result = await cloudinary.uploader.destroy(publicId, {
            resource_type: resourceType
        });

        console.log("Media deleted from Cloudinary:", publicId);
        return result.result === 'ok';
    } catch (error) {
        console.error("Error deleting media from Cloudinary:", error);
        return false;
    }
};

// Bulk delete function for cleanup operations
const bulkDeleteFromCloudinary = async (publicIds, resourceType = "image") => {
    try {
        if (!publicIds || publicIds.length === 0) return null;
        
        console.log(`🗑️ Bulk deleting ${publicIds.length} files from Cloudinary`);
        
        const response = await cloudinary.api.delete_resources(publicIds, {
            resource_type: resourceType
        });
        
        console.log(`✅ Bulk delete completed:`, response);
        return response;
        
    } catch (error) {
        console.error("❌ Cloudinary bulk delete error:", error);
        return null;
    }
};

// Get file info function
const getMediaInfo = async (publicId, resourceType = "image") => {
    try {
        const result = await cloudinary.api.resource(publicId, {
            resource_type: resourceType
        });
        
        return {
            url: result.secure_url,
            format: result.format,
            width: result.width,
            height: result.height,
            bytes: result.bytes,
            duration: result.duration || null,
            createdAt: result.created_at
        };
    } catch (error) {
        console.error("Error getting media info:", error);
        return null;
    }
};

export { 
    uploadOnCloudinary, 
    deleteFromCloudinary, 
    uploadMediaOnCloudinary, 
    deleteMediaOnCloudinary,
    bulkDeleteFromCloudinary,
    getMediaInfo
};
