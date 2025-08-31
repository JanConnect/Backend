import { v2 as cloudinary } from 'cloudinary';
import fs from "fs"
import dotenv from "dotenv"

dotenv.config()

cloudinary.config({ 
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME, 
    api_key: process.env.CLOUDINARY_API_KEY, 
    api_secret: process.env.CLOUDINARY_API_SECRET
});

export default cloudinary

const uploadOnCloudinary = async (localFilePath) =>{
    try{
        if(!localFilePath) return null
        const response = await cloudinary.uploader.upload(
            localFilePath,{
                resource_type : "auto"
            }
        )
        console.log("File uploaded on cloudinary . file src : " + response.url)
        fs.unlinkSync(localFilePath)
        return response
    }catch(error){
        console.log("Error on cloudinary ",error)
        fs.unlinkSync(localFilePath)
        return null
    }
}

const deleteFromCloudinary = async(publicId,type)=>{
    try{
       await cloudinary.uploader.destroy(publicId,{
        resource_type:type
       })
       console.log("deleted from cloudinary. Public ID: ",publicId);
       
    }catch(error){
          console.log("Error deleting from cloudinary",error)
          return null
    }
}

const uploadMediaOnCloudinary = async (localFilePath) => {
  try {
    if (!localFilePath) return null;

    const response = await cloudinary.uploader.upload(localFilePath, {
      resource_type: "auto",   // auto detects (image/video/audio)
      folder: "complaints/media"
    });

    console.log("Media uploaded to Cloudinary:", response.secure_url);

    // remove local file after upload
    fs.unlinkSync(localFilePath);

    return {
      url: response.secure_url,
      public_id: response.public_id,
      resource_type: response.resource_type
    };
  } catch (error) {
    console.error("Error uploading media to Cloudinary:", error);

    if (fs.existsSync(localFilePath)) {
      fs.unlinkSync(localFilePath);
    }

    return null;
  }
};


const deleteMediaOnCloudinary = async (publicId, resourceType = "image") => {
  try {
    // audio is treated as "video" by Cloudinary
    if (resourceType === "audio") resourceType = "video";

    await cloudinary.uploader.destroy(publicId, {
      resource_type: resourceType
    });

    console.log("Media deleted from Cloudinary:", publicId);
    return true;
  } catch (error) {
    console.error("Error deleting media from Cloudinary:", error);
    return false;
  }
};

export {uploadOnCloudinary,deleteFromCloudinary,uploadMediaOnCloudinary,deleteMediaOnCloudinary};