import { Admin } from "../models/admin.model.js";
import { User } from "../models/user.model.js";
import { Report } from "../models/report.model.js";
import { Department } from "../models/department.model.js";
import { Municipality } from "../models/municipality.model.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { uploadOnCloudinary, deleteFromCloudinary } from "../utils/cloudinary.js";
import jwt from "jsonwebtoken";

// Generate Access and Refresh Tokens
const generateAccessAndRefreshTokens = async (adminId) => {
    try {
        const admin = await Admin.findById(adminId);
        if (!admin) {
            throw new ApiError(404, "Admin not found");
        }

        const accessToken = admin.generateAccessToken();
        const refreshToken = admin.generateRefreshToken();

        admin.refreshToken = refreshToken;
        await admin.save({ validateBeforeSave: false });

        return { accessToken, refreshToken };
    } catch (error) {
        throw new ApiError(500, "Something went wrong while generating tokens");
    }
};

// Register Admin (Super Admin only)
const registerAdmin = asyncHandler(async (req, res) => {
    const { name, username, email, password, phone, role, permissions } = req.body;

    // Validate required fields
    if ([name, username, email, password, phone].some((field) => field?.trim() === "")) {
        throw new ApiError(400, "All fields are required");
    }

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({
        $or: [{ username: username.toLowerCase() }, { email: email.toLowerCase() }]
    });

    if (existingAdmin) {
        throw new ApiError(409, "Admin with this email or username already exists");
    }

    // Handle avatar upload
    let avatar = "";
    let avatarPublicId = "";

    if (req.file) {
        try {
            const uploadResult = await uploadOnCloudinary(req.file.path);
            if (uploadResult) {
                avatar = uploadResult.secure_url;
                avatarPublicId = uploadResult.public_id;
            }
        } catch (error) {
            throw new ApiError(500, "Failed to upload avatar");
        }
    }

    // Set permissions based on role
    let adminPermissions = {
        canManageUsers: true,
        canManageReports: true,
        canManageDepartments: true,
        canManageMunicipalities: true,
        canViewAnalytics: true,
        canManageStaff: true,
        canDeleteReports: role === "superadmin"
    };

    if (permissions) {
        adminPermissions = { ...adminPermissions, ...permissions };
    }

    // Create admin
    const admin = await Admin.create({
        name: name.trim(),
        username: username.toLowerCase().trim(),
        email: email.toLowerCase().trim(),
        password,
        phone,
        role: role || "admin",
        avatar,
        avatarPublicId,
        permissions: adminPermissions,
        createdBy: req.admin?._id
    });

    // Generate tokens
    const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(admin._id);

    const createdAdmin = await Admin.findById(admin._id)
        .select("-password -refreshToken")
        .populate('assignedMunicipalities', 'name district')
        .populate('assignedDepartments', 'name');

    const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
    };

    return res
        .status(201)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(new ApiResponse(201, {
            admin: createdAdmin,
            accessToken
        }, "Admin registered successfully"));
});

// Login Admin
const loginAdmin = asyncHandler(async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        throw new ApiError(400, "Email and password are required");
    }

    const admin = await Admin.findOne({
        $or: [
            { email: email.toLowerCase() },
            { username: email.toLowerCase() }
        ]
    }).populate('assignedMunicipalities', 'name district')
      .populate('assignedDepartments', 'name');

    if (!admin) {
        throw new ApiError(404, "Admin not found");
    }

    if (!admin.isActive) {
        throw new ApiError(403, "Admin account is deactivated");
    }

    const isPasswordValid = await admin.isPasswordCorrect(password);
    if (!isPasswordValid) {
        throw new ApiError(401, "Invalid credentials");
    }

    const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(admin._id);

    // Update last login
    await admin.updateLastLogin();

    const loggedInAdmin = await Admin.findById(admin._id)
        .select("-password -refreshToken")
        .populate('assignedMunicipalities', 'name district')
        .populate('assignedDepartments', 'name');

    const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
    };

    return res
        .status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", refreshToken, options)
        .json(new ApiResponse(200, {
            admin: loggedInAdmin,
            accessToken
        }, "Admin logged in successfully"));
});

// Logout Admin
const logoutAdmin = asyncHandler(async (req, res) => {
    await Admin.findByIdAndUpdate(
        req.admin._id,
        {
            $unset: {
                refreshToken: 1
            }
        },
        {
            new: true
        }
    );

    const options = {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
    };

    return res
        .status(200)
        .clearCookie("accessToken", options)
        .clearCookie("refreshToken", options)
        .json(new ApiResponse(200, {}, "Admin logged out successfully"));
});

// Get Current Admin
const getCurrentAdmin = asyncHandler(async (req, res) => {
    const admin = await Admin.findById(req.admin._id)
        .select("-password -refreshToken")
        .populate('assignedMunicipalities', 'name district')
        .populate('assignedDepartments', 'name')
        .populate('createdBy', 'name username');

    return res
        .status(200)
        .json(new ApiResponse(200, admin, "Current admin fetched successfully"));
});

// Update Admin Profile
const updateAdminProfile = asyncHandler(async (req, res) => {
    const { name, phone } = req.body;
    const adminId = req.admin._id;

    const admin = await Admin.findById(adminId);
    if (!admin) {
        throw new ApiError(404, "Admin not found");
    }

    // Update fields
    if (name) admin.name = name.trim();
    if (phone) admin.phone = phone;

    // Handle avatar update
    if (req.file) {
        // Delete old avatar if exists
        if (admin.avatarPublicId) {
            await deleteFromCloudinary(admin.avatarPublicId);
        }

        const uploadResult = await uploadOnCloudinary(req.file.path);
        if (uploadResult) {
            admin.avatar = uploadResult.secure_url;
            admin.avatarPublicId = uploadResult.public_id;
        }
    }

    await admin.save();

    const updatedAdmin = await Admin.findById(adminId)
        .select("-password -refreshToken")
        .populate('assignedMunicipalities', 'name district')
        .populate('assignedDepartments', 'name');

    return res
        .status(200)
        .json(new ApiResponse(200, updatedAdmin, "Admin profile updated successfully"));
});

// Get All Admins (Super Admin only)
const getAllAdmins = asyncHandler(async (req, res) => {
    const {
        page = 1,
        limit = 10,
        role,
        isActive,
        search
    } = req.query;

    // Build filter
    const filter = {};
    if (role) filter.role = role;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    if (search) {
        filter.$or = [
            { name: { $regex: search, $options: 'i' } },
            { username: { $regex: search, $options: 'i' } },
            { email: { $regex: search, $options: 'i' } }
        ];
    }

    const admins = await Admin.find(filter)
        .select("-password -refreshToken")
        .populate('assignedMunicipalities', 'name district')
        .populate('assignedDepartments', 'name')
        .populate('createdBy', 'name username')
        .sort({ createdAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit);

    const totalAdmins = await Admin.countDocuments(filter);

    return res
        .status(200)
        .json(new ApiResponse(200, {
            admins,
            totalPages: Math.ceil(totalAdmins / limit),
            currentPage: parseInt(page),
            totalAdmins,
            hasNextPage: page < Math.ceil(totalAdmins / limit),
            hasPrevPage: page > 1
        }, "Admins retrieved successfully"));
});

// Update Admin Status (Super Admin only)
const updateAdminStatus = asyncHandler(async (req, res) => {
    const { adminId } = req.params;
    const { isActive } = req.body;

    const admin = await Admin.findById(adminId);
    if (!admin) {
        throw new ApiError(404, "Admin not found");
    }

    // Prevent deactivating super admin
    if (admin.role === "superadmin" && isActive === false) {
        throw new ApiError(403, "Cannot deactivate super admin");
    }

    admin.isActive = isActive;
    await admin.save();

    return res
        .status(200)
        .json(new ApiResponse(200, {
            adminId: admin._id,
            isActive: admin.isActive
        }, `Admin ${isActive ? 'activated' : 'deactivated'} successfully`));
});

// Assign Municipalities to Admin
const assignMunicipalities = asyncHandler(async (req, res) => {
    const { adminId } = req.params;
    const { municipalityIds } = req.body;

    const admin = await Admin.findById(adminId);
    if (!admin) {
        throw new ApiError(404, "Admin not found");
    }

    // Verify municipalities exist
    const municipalities = await Municipality.find({ _id: { $in: municipalityIds } });
    if (municipalities.length !== municipalityIds.length) {
        throw new ApiError(400, "One or more municipalities not found");
    }

    admin.assignedMunicipalities = municipalityIds;
    await admin.save();

    const updatedAdmin = await Admin.findById(adminId)
        .select("-password -refreshToken")
        .populate('assignedMunicipalities', 'name district');

    return res
        .status(200)
        .json(new ApiResponse(200, updatedAdmin, "Municipalities assigned successfully"));
});

// Get Admin Dashboard Stats
const getAdminDashboardStats = asyncHandler(async (req, res) => {
    const adminId = req.admin._id;
    const admin = await Admin.findById(adminId).populate('assignedMunicipalities');

    // Build filter based on admin's assigned municipalities
    let municipalityFilter = {};
    if (admin.assignedMunicipalities.length > 0 && admin.role !== 'superadmin') {
        municipalityFilter = {
            municipality: { $in: admin.assignedMunicipalities.map(m => m._id) }
        };
    }

    const [
        totalReports,
        pendingReports,
        resolvedReports,
        totalUsers,
        totalDepartments,
        totalMunicipalities,
        recentReports
    ] = await Promise.all([
        Report.countDocuments(municipalityFilter),
        Report.countDocuments({ ...municipalityFilter, status: 'pending' }),
        Report.countDocuments({ ...municipalityFilter, status: 'resolved' }),
        User.countDocuments(),
        Department.countDocuments(),
        Municipality.countDocuments(),
        Report.find(municipalityFilter)
            .populate('reportedBy', 'name email')
            .populate('municipality', 'name district')
            .sort({ createdAt: -1 })
            .limit(10)
    ]);

    const stats = {
        overview: {
            totalReports,
            pendingReports,
            resolvedReports,
            totalUsers,
            totalDepartments,
            totalMunicipalities,
            resolutionRate: totalReports > 0 ? Math.round((resolvedReports / totalReports) * 100) : 0
        },
        recentReports
    };

    return res
        .status(200)
        .json(new ApiResponse(200, stats, "Dashboard stats retrieved successfully"));
});

// Delete Admin (Super Admin only)
const deleteAdmin = asyncHandler(async (req, res) => {
    const { adminId } = req.params;

    const admin = await Admin.findById(adminId);
    if (!admin) {
        throw new ApiError(404, "Admin not found");
    }

    // Prevent deleting super admin
    if (admin.role === "superadmin") {
        throw new ApiError(403, "Cannot delete super admin");
    }

    // Delete avatar from cloudinary
    if (admin.avatarPublicId) {
        await deleteFromCloudinary(admin.avatarPublicId);
    }

    await Admin.findByIdAndDelete(adminId);

    return res
        .status(200)
        .json(new ApiResponse(200, {}, "Admin deleted successfully"));
});

// Refresh Access Token
const refreshAccessToken = asyncHandler(async (req, res) => {
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken;

    if (!incomingRefreshToken) {
        throw new ApiError(401, "Unauthorized request");
    }

    try {
        const decodedToken = jwt.verify(
            incomingRefreshToken,
            process.env.REFRESH_TOKEN_SECRET
        );

        const admin = await Admin.findById(decodedToken?._id);

        if (!admin) {
            throw new ApiError(401, "Invalid refresh token");
        }

        if (incomingRefreshToken !== admin?.refreshToken) {
            throw new ApiError(401, "Refresh token is expired or used");
        }

        const options = {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production"
        };

        const { accessToken, refreshToken: newRefreshToken } = await generateAccessAndRefreshTokens(admin._id);

        return res
            .status(200)
            .cookie("accessToken", accessToken, options)
            .cookie("refreshToken", newRefreshToken, options)
            .json(new ApiResponse(200, {
                accessToken,
                refreshToken: newRefreshToken
            }, "Access token refreshed"));

    } catch (error) {
        throw new ApiError(401, error?.message || "Invalid refresh token");
    }
});

export {
    registerAdmin,
    loginAdmin,
    logoutAdmin,
    getCurrentAdmin,
    updateAdminProfile,
    getAllAdmins,
    updateAdminStatus,
    assignMunicipalities,
    getAdminDashboardStats,
    deleteAdmin,
    refreshAccessToken
};
