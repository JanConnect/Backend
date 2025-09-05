import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { authorizeRoles } from "../middlewares/auth.middleware.js";
import {
    adminLogin,
  getDashboardStats,
  getAllReportsAdmin,
  bulkUpdateReports,
  exportReports,
  getSystemUsers,
  getActivityLogs
} from "../controllers/admin.controller.js";

const router = Router();

router.route("/login").post(adminLogin);
// All admin routes require authentication and admin role
router.use(verifyJWT);
router.use(authorizeRoles('admin'));

// Dashboard statistics
router.route("/dashboard/stats").get(getDashboardStats);

// Admin-level report management
router.route("/reports").get(getAllReportsAdmin);
router.route("/reports/bulk-update").patch(bulkUpdateReports);
router.route("/reports/export").get(exportReports);

// User management
router.route("/users").get(getSystemUsers);

// Activity logs
router.route("/activity-logs").get(getActivityLogs);

export default router;
