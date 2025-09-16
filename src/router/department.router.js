import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { authorizeRoles } from "../middlewares/auth.middleware.js";
import {
    createDepartment,
    getAllDepartments,
    getDepartmentById,
    updateDepartment,
    deleteDepartment,
    getDepartmentsByMunicipality,
    getDepartmentsByCategory, // This exists in your controller
    getDepartmentAnalytics
} from "../controllers/department.controller.js";

const router = Router();

// All routes require authentication
router.use(verifyJWT);

// Public department routes (authenticated users)
router.route("/").get(getAllDepartments);
router.route("/municipality/:municipalityId").get(getDepartmentsByMunicipality);
router.route("/category/:category").get(getDepartmentsByCategory);
router.route("/:departmentId").get(getDepartmentById);

// Admin only routes
router.route("/create").post(authorizeRoles('admin', 'superadmin'), createDepartment);
router.route("/:departmentId").patch(authorizeRoles('admin', 'superadmin'), updateDepartment);
router.route("/:departmentId").delete(authorizeRoles('admin', 'superadmin'), deleteDepartment);

// Analytics routes (Staff/Admin)
router.route("/:departmentId/analytics").get(
    authorizeRoles('staff', 'admin', 'superadmin'), 
    getDepartmentAnalytics
);

export default router;
