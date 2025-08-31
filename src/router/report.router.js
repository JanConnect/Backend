import { Router } from "express";
import { upload } from "../middlewares/multer.middleware.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { authorizeRoles } from "../middlewares/auth.middleware.js";
import {
  createReport,
  getAllReports,
  getReportById,
  updateReportStatus,
  upvoteReport,
  removeUpvote,
  addFeedback,
  getUserReports,
  getReportsAnalytics,
  deleteReport
} from "../controllers/report.controller.js";

const router = Router();

// Create report with media upload
router.route("/create").post(
upload.single('media'),
  verifyJWT,
  createReport
);

// Get all reports
router.route("/").get(verifyJWT, getAllReports);

// Get user reports
router.route("/user/me").get(verifyJWT, getUserReports);

// Get analytics (staff/admin)
router.route("/analytics").get(verifyJWT, authorizeRoles('staff', 'admin'), getReportsAnalytics);

// Get single report
router.route("/:reportId").get(verifyJWT, getReportById);

// Update report status (staff/admin)
router.route("/:reportId/status").patch(verifyJWT, authorizeRoles('staff', 'admin'), updateReportStatus);

// Upvote system
router.route("/:reportId/upvote").post(verifyJWT, upvoteReport);
router.route("/:reportId/upvote").delete(verifyJWT, removeUpvote);

// Add feedback
router.route("/:reportId/feedback").post(verifyJWT, addFeedback);

// Delete report (admin only)
router.route("/:reportId").delete(verifyJWT, authorizeRoles('admin'), deleteReport);

export default router;
