import { Router } from "express";
import { upload } from "../middlewares/multer.middleware.js";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { authorizeRoles } from "../middlewares/auth.middleware.js";
import {
    createReport,
    getAllReports,
    getReportById,
    updateReportStatusJson,  // Fixed typo: changed from Jason to Json
    upvoteReport,
    removeUpvote,
    addFeedback,
    getUserReports,
    getReportsAnalytics,
    deleteReport,
    addComment,
    getReportComments
} from "../controllers/report.controller.js";

const router = Router();

// All routes require authentication
router.use(verifyJWT);

// Create report with single image + optional voice message
router.route("/create").post(
    upload.fields([
        { name: 'image', maxCount: 1 },         // Single image
        { name: 'voiceMessage', maxCount: 1 }   // Single voice message
    ]),
    createReport
);

// Get all reports with filtering
router.route("/").get(getAllReports);

// Get user's own reports
router.route("/user/me").get(getUserReports);

// Get analytics (staff/admin only)
router.route("/analytics").get(
    authorizeRoles('staff', 'admin', 'superadmin'), 
    getReportsAnalytics
);

// Get single report by reportId
router.route("/:reportId").get(getReportById);

// Add this new route for JSON status updates
router.route("/:reportId/status/json").patch(
    authorizeRoles('staff', 'admin', 'superadmin'),
    updateReportStatusJson  // Fixed typo here
);

// Community engagement routes
router.route("/:reportId/upvote").post(upvoteReport);
router.route("/:reportId/upvote").delete(removeUpvote);

// Comments system
router.route("/:reportId/comment").post(addComment);
router.route("/:reportId/comments").get(getReportComments);

// Feedback system (report creator only)
router.route("/:reportId/feedback").post(addFeedback);

// Delete report (admin only)
router.route("/:reportId").delete(
    authorizeRoles('admin', 'superadmin'), 
    deleteReport
);

export default router;