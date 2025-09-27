// auth.middleware.js
import jwt from "jsonwebtoken"
import {User} from "../models/user.model.js"
import {ApiError} from "../utils/ApiError.js"
import {asyncHandler} from "../utils/asyncHandler.js"

const debugLog = (message, data = null, type = 'info') => {
  const timestamp = new Date().toISOString();
  const env = process.env.NODE_ENV || 'development';
  const logMessage = `[${timestamp}] [${env.toUpperCase()}] [AUTH] ${message}`;
  
  if (data) {
    console[type](logMessage, data);
  } else {
    console[type](logMessage);
  }
};

export const verifyJWT = asyncHandler(async (req, _, next) => {
    debugLog('🔐 JWT Verification started', {
        url: req.url,
        method: req.method,
        hasCookies: !!req.cookies,
        hasAuthHeader: !!req.header("Authorization"),
        originalUrl: req.originalUrl
    });

    // Fix the header parsing bug
    const token = req.cookies?.accessToken || 
                  req.body?.accessToken || 
                  req.header("Authorization")?.replace("Bearer ", "");
    
    debugLog('🔐 Token extraction', {
        fromCookies: !!req.cookies?.accessToken,
        fromBody: !!req.body?.accessToken,
        fromHeader: !!req.header("Authorization"),
        tokenLength: token?.length,
        tokenPreview: token ? `${token.substring(0, 20)}...` : 'none'
    });

    if (!token) {
        debugLog('❌ No token provided for route', { url: req.originalUrl });
        throw new ApiError(401, "Unauthorized user!");
    }

    try {
        debugLog('🔐 Verifying token signature');
        
        if (!process.env.ACCESS_TOKEN_SECRET) {
            debugLog('❌ ACCESS_TOKEN_SECRET is missing from environment variables', {}, 'error');
            throw new ApiError(500, "Server configuration error");
        }

        const decodedToken = jwt.verify(token, process.env.ACCESS_TOKEN_SECRET);
        
        debugLog('🔐 Token decoded successfully', {
            userId: decodedToken?._id,
            iat: decodedToken?.iat,
            exp: decodedToken?.exp
        });
        
        debugLog('🔐 Finding user in database');
        const user = await User.findById(decodedToken?._id).select("-password -refreshToken");
        
        if (!user) {
            debugLog('❌ User not found in database', { userId: decodedToken?._id });
            throw new ApiError(401, "Unauthorized user");
        }

        debugLog('✅ User authenticated successfully', {
            userId: user._id,
            role: user.role,
            email: user.email,
            route: req.originalUrl
        });

        req.user = user;
        next();

    } catch (error) {
        debugLog('💥 JWT Verification failed', {
            message: error.message,
            name: error.name,
            route: req.originalUrl,
            stack: error.stack
        }, 'error');
        
        if (error.name === 'TokenExpiredError') {
            throw new ApiError(401, "Token expired");
        } else if (error.name === 'JsonWebTokenError') {
            throw new ApiError(401, "Invalid token");
        } else if (error.name === 'NotBeforeError') {
            throw new ApiError(401, "Token not active");
        } else {
            throw new ApiError(401, error?.message || "Invalid Access Token");
        }
    }
});

export const authorizeRoles = (...roles) => {
    return asyncHandler(async (req, res, next) => {
        debugLog('🔐 Role authorization check', {
            requiredRoles: roles,
            userRole: req.user?.role,
            userId: req.user?._id,
            route: req.originalUrl
        });

        if (!req.user) {
            debugLog('❌ User not authenticated for role check', { route: req.originalUrl });
            throw new ApiError(401, "User not authenticated");
        }

        // Make sure user.role exists and matches
        if (!req.user.role || !roles.includes(req.user.role)) {
            debugLog('❌ Role authorization failed', {
                userRole: req.user.role,
                requiredRoles: roles,
                route: req.originalUrl
            });
            throw new ApiError(403, `Access denied. Required roles: ${roles.join(', ')}. Your role: ${req.user.role || 'none'}`);
        }

        debugLog('✅ Role authorization successful', { route: req.originalUrl });
        next();
    });
};