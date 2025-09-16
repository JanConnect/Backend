import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { authorizeRoles } from "../middlewares/auth.middleware.js";
import { upload } from "../middlewares/multer.middleware.js";
import {
    adminLogin,
    getDashboardStats,
    getAllReportsAdmin,
    bulkUpdateReports,
    exportReports,
    getSystemUsers,
    getActivityLogs,
    createAdminUser,
    getSystemHealth
} from "../controllers/admin.controller.js";

const router = Router();

// Public admin route - Login
router.route("/login").post(adminLogin);

// All admin routes require authentication and admin role
router.use(verifyJWT);
router.use(authorizeRoles('admin', 'superadmin'));

// ===============================
// DASHBOARD & ANALYTICS ROUTES
// ===============================

// Admin dashboard statistics
router.route("/dashboard/stats").get(getDashboardStats);

// System health monitoring
router.route("/system/health").get(getSystemHealth);

// ===============================
// REPORT MANAGEMENT ROUTES  
// ===============================

// Get all reports with admin-level filtering
router.route("/reports").get(getAllReportsAdmin);

// Bulk update multiple reports
router.route("/reports/bulk-update").patch(bulkUpdateReports);

// Export reports data
router.route("/reports/export").get(exportReports);

// Advanced report analytics
router.route("/reports/analytics").get(getAllReportsAdmin);

// ===============================
// USER MANAGEMENT ROUTES
// ===============================

// Get all system users
router.route("/users").get(getSystemUsers);

// Create new admin user (Super Admin only)
router.route("/users/create-admin").post(
    authorizeRoles('superadmin'),
    upload.single('avatar'),
    createAdminUser
);

// Update user role (Super Admin only)
router.route("/users/:userId/role").patch(
    authorizeRoles('superadmin'),
    async (req, res) => {
        // Implementation would be in controller
        res.status(501).json({ message: "Route implementation pending" });
    }
);

// Deactivate/activate user
router.route("/users/:userId/toggle-status").patch(
    async (req, res) => {
        // Implementation would be in controller
        res.status(501).json({ message: "Route implementation pending" });
    }
);

// ===============================
// MUNICIPALITY MANAGEMENT
// ===============================

// Get all municipalities (admin view)
router.route("/municipalities").get(async (req, res) => {
    // Can reuse municipality controller with admin scope
    res.status(501).json({ message: "Route implementation pending" });
});

// Create municipality (Super Admin only)
router.route("/municipalities/create").post(
    authorizeRoles('superadmin'),
    async (req, res) => {
        res.status(501).json({ message: "Route implementation pending" });
    }
);

// ===============================
// DEPARTMENT MANAGEMENT  
// ===============================

// Get all departments (admin view)
router.route("/departments").get(async (req, res) => {
    res.status(501).json({ message: "Route implementation pending" });
});

// Create department
router.route("/departments/create").post(async (req, res) => {
    res.status(501).json({ message: "Route implementation pending" });
});

// Add staff to department
router.route("/departments/:departmentId/staff").post(async (req, res) => {
    res.status(501).json({ message: "Route implementation pending" });
});

// ===============================
// SYSTEM MONITORING ROUTES
// ===============================

// Get admin activity logs
router.route("/activity-logs").get(getActivityLogs);

// System performance metrics
router.route("/system/performance").get(async (req, res) => {
    res.status(501).json({ message: "Route implementation pending" });
});

// System configuration
router.route("/system/config").get(
    authorizeRoles('superadmin'),
    async (req, res) => {
        res.status(501).json({ message: "Route implementation pending" });
    }
);

// ===============================
// DATA MANAGEMENT ROUTES
// ===============================

// Backup system data (Super Admin only)
router.route("/data/backup").post(
    authorizeRoles('superadmin'),
    async (req, res) => {
        res.status(501).json({ message: "Route implementation pending" });
    }
);

// Import data
router.route("/data/import").post(
    authorizeRoles('superadmin'),
    upload.single('dataFile'),
    async (req, res) => {
        res.status(501).json({ message: "Route implementation pending" });
    }
);

// Clear old data
router.route("/data/cleanup").delete(
    authorizeRoles('superadmin'),
    async (req, res) => {
        res.status(501).json({ message: "Route implementation pending" });
    }
);

// ===============================
// NOTIFICATION ROUTES
// ===============================

// Send system-wide notifications
router.route("/notifications/broadcast").post(
    authorizeRoles('superadmin'),
    async (req, res) => {
        res.status(501).json({ message: "Route implementation pending" });
    }
);

// Get notification history
router.route("/notifications/history").get(async (req, res) => {
    res.status(501).json({ message: "Route implementation pending" });
});

export default router;
