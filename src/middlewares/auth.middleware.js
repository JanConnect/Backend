import jwt from "jsonwebtoken"
import {User} from "../models/user.model.js"
import {ApiError} from "../utils/ApiError.js"
import {asyncHandler} from "../utils/asyncHandler.js"
import { Admin } from "../models/admin.model.js"

export const verifyJWT = asyncHandler(async (req, _ , next)=>{
    const token = req.cookies.accessToken || req.body.accessToken || req.header("Authorization"?.replace("Bearer ",""))
    if(!token){
        throw new ApiError(401, "Unothorized user!")
    }
    try {
       const decodedToken =  jwt.verify(token,process.env.ACCESS_TOKEN_SECRET)

       const user = await User.findById(decodedToken?._id).select("-password -refreshToken")
        if(!user){
            throw new ApiError(401, "unotharized user")
        }

        req.user = user 

        next()

    } catch (error) {
        throw new ApiError(401 , error?.message||"Invalid Access Token")
    }

})

export const authorizeRoles = (...roles) => {
  return asyncHandler(async (req, res, next) => {
    if (!req.user) {
      throw new ApiError(401, "User not authenticated");
    }

    if (!roles.includes(req.user.role)) {
      throw new ApiError(403, `Access denied. Required roles: ${roles.join(', ')}`);
    }

    next();
  });
}

export const verifyAdminJWT = asyncHandler(async (req, _, next) => {
    try {
        const token = req.cookies?.accessToken || req.header("Authorization")?.replace("Bearer ", "");
        
        if (!token) {
            throw new ApiError(401, "Unauthorized request");
        }

        const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
        
        const admin = await Admin.findById(decodedToken?._id).select("-password -refreshToken");
        
        if (!admin) {
            throw new ApiError(401, "Invalid Access Token");
        }

        if (!admin.isActive) {
            throw new ApiError(403, "Admin account is deactivated");
        }

        req.admin = admin;
        next();
    } catch (error) {
        throw new ApiError(401, error?.message || "Invalid access token");
    }
});

export const verifySuperAdmin = asyncHandler(async (req, _, next) => {
    if (req.admin?.role !== "superadmin") {
        throw new ApiError(403, "Super admin access required");
    }
    next();
});