import { Router } from "express";
import {
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
} from "../controllers/admin.controller.js";
import { upload } from "../middlewares/multer.middleware.js";
import { verifyAdminJWT, verifySuperAdmin } from "../middlewares/auth.middleware.js";

const router = Router();

// Public routes
router.route("/login").post(loginAdmin);
router.route("/refresh-token").post(refreshAccessToken);

// Protected routes (require admin authentication)
router.route("/register").post(verifyAdminJWT,verifySuperAdmin,upload.single("avatar"), registerAdmin);
router.route("/logout").post(verifyAdminJWT, logoutAdmin);
router.route("/current-admin").get(verifyAdminJWT, getCurrentAdmin);
router.route("/update-profile").patch(verifyAdminJWT, upload.single("avatar"), updateAdminProfile);
router.route("/dashboard-stats").get(verifyAdminJWT, getAdminDashboardStats);

// Super admin only routes
router.route("/all-admins").get(verifyAdminJWT, verifySuperAdmin, getAllAdmins);
router.route("/status/:adminId").patch(verifyAdminJWT, verifySuperAdmin, updateAdminStatus);
router.route("/assign-municipalities/:adminId").patch(verifyAdminJWT, verifySuperAdmin, assignMunicipalities);
router.route("/delete/:adminId").delete(verifyAdminJWT, verifySuperAdmin, deleteAdmin);

export default router;
