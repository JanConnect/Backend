import { User } from "../models/user.model.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { ApiError } from "../utils/ApiError.js"
import jwt from "jsonwebtoken";
import { uploadOnCloudinary, deleteFromCloudinary } from "../utils/cloudinary.js";

export const generateAccessAndRefreshToken = async (userId) => {
    try {
        const user = await User.findById(userId)
        if (!user) {
            throw new ApiError(404, "No user found while generating access and refresh token!");
        }
        
        const accessToken = user.generateAccessToken()
        const refreshToken = user.generateRefreshToken()
    
        user.refreshToken = refreshToken
        await user.save({ validateBeforeSave: false })
        
        return { accessToken, refreshToken }
    } catch (error) {
        console.error("Token generation error:", error)
        throw new ApiError(500, "Something went wrong while generating access and refresh tokens")
    }
}

export const registerUser = asyncHandler(async(req,res)=>{
    const {name,username,email,phone,password} = req.body

    if ([name, username, email, password, phone].some((field) => field?.trim() === "")) {
        throw new ApiError(400, "All fields are required!")
    }

    const existedUser = await User.findOne({
        $or: [{ username: username.toLowerCase() }, { email: email.toLowerCase() }]
    })
    if (existedUser) {
        throw new ApiError(409, "User with this email or username already exists")
    }
   
    const avatarLocalPath = req.file?.path
    console.log(avatarLocalPath)
     console.log(avatarLocalPath)
    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is missing")
    }

    let avatar;
    try {
        avatar = await uploadOnCloudinary(avatarLocalPath)
        console.log("Uploaded avatar:", avatar);
    } catch (error) {
        console.log("Error uploading avatar:", error);
        throw new ApiError(500, "Failed to upload avatar!")
    }

    if (!avatar) {
        throw new ApiError(500, "Avatar upload failed")
    }

    let user;

    try {
        user = await User.create({
            name:name.trim(),
            avatar:avatar.url,
            avatarPublicId: avatar.public_id,
            email: email.toLowerCase().trim(),
            password,
            username: username.toLowerCase().trim(),
            phone
        })

        const { accessToken, refreshToken } = await generateAccessAndRefreshToken(user._id)

        const createdUser = await User.findById(user._id).select("-password -refreshToken")
        if (!createdUser) {
            throw new ApiError(500, "Something went wrong while registering a user!")
        }

        const options = {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
        }

        return res
            .status(201)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", refreshToken, options)
            .json(new ApiResponse(200, {
                user: createdUser,
            }, "User registered successfully!"))

    } catch (error) {
        console.log("User creation failed:", error);

        if (avatar) {
            try {
                await deleteFromCloudinary(avatar.public_id, "image")
            } catch (deleteError) {
                console.error("Failed to delete avatar from cloudinary:", deleteError)
            }
        }

        if (error.name === 'ValidationError') {
            const errorMessages = Object.values(error.errors).map(err => err.message);
            throw new ApiError(400, `Validation Error: ${errorMessages.join(', ')}`);
        }
        
        throw new ApiError(500, "Something went wrong while registering the user!")
    }
})

export const loginUser = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    throw new ApiError(400, "Email and password are required!")
  }

  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    throw new ApiError(404, "User not found!")
  }

  const isPasswordValid = await user.isPasswordCorrect(password);
  if (!isPasswordValid) {
     throw new ApiError(401, "Password incorrect!")
  }

  const { accessToken, refreshToken } = await generateAccessAndRefreshToken(user._id);
  const loggedInUser = await User.findById(user._id).select("-password -refreshToken");

  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  };

  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(new ApiResponse(200, {
      user: loggedInUser,
      accessToken,
    }, "User logged in successfully"));
});

export const getCurrentUser = asyncHandler(async (req, res) => {
    return res.status(200).json(new ApiResponse(200, req.user, "Current user fetched successfully!"))
})

export const updateAccessToken = asyncHandler(async (req, res) => {
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken

    if (!incomingRefreshToken) {
        throw new ApiError(401, "Refresh token is required!")
    }

    try {
        const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET)
    
        const user = await User.findById(decodedToken?._id)
        if (!user) {
            throw new ApiError(401, "Invalid refresh token")
        }
        
        if (incomingRefreshToken !== user?.refreshToken) {
            throw new ApiError(401, "Invalid refresh token!")
        }

        const options = {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
        }

        const { accessToken, refreshToken: newRefreshToken } = await generateAccessAndRefreshToken(user._id)

        return res
            .status(200)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", newRefreshToken, options)
            .json(new ApiResponse(200, {
                accessToken,
                refreshToken: newRefreshToken
            }, "Access token refreshed successfully"))

    } catch (error) {
        console.error("Token refresh error:", error)
        
        if (error.name === 'TokenExpiredError') {
            throw new ApiError(401, "Refresh token expired")
        } else if (error.name === 'JsonWebTokenError') {
            throw new ApiError(401, "Invalid refresh token")
        }
        
        throw new ApiError(401, "Something went wrong while refreshing token!")
    }
})

export const logoutUser = asyncHandler(async (req, res) => {
    try {
        const user = await User.findById(req.user._id)
        user.refreshToken = undefined;
        await user.save({ validateBeforeSave: false });

        const options = {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: 'strict'
        }

        return res
            .status(200)
            .clearCookie("accessToken", options)
            .clearCookie("refreshToken", options)
            .json(new ApiResponse(200, {}, "User logged out successfully!"))

    } catch (error) {
        console.error("Logout error:", error)
        throw new ApiError(500, "Something went wrong while logging out")
    }
})