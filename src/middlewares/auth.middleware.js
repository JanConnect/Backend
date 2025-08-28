import jwt from "jsonwebtoken"
import {User} from "../models/user.model.js"
import {ApiError} from "../utils/ApiError.js"
import {asyncHandler} from "../utils/asyncHandler.js"

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