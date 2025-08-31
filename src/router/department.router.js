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
  getDepartmentsByCategory,
  getDepartmentAnalytics
} from "../controllers/department.controller.js";

const router = Router();

// Create department (Admin only)
router.route("/create").post(verifyJWT, authorizeRoles('admin'), createDepartment);

// Get all departments
router.route("/").get(verifyJWT, getAllDepartments);

// Get departments by municipality
router.route("/municipality/:municipalityId").get(verifyJWT, getDepartmentsByMunicipality);

// Get departments by category
router.route("/category/:category").get(verifyJWT, getDepartmentsByCategory);

// Get department analytics (Staff/Admin)
router.route("/:departmentId/analytics").get(verifyJWT, authorizeRoles('staff', 'admin'), getDepartmentAnalytics);

// Get department by ID
router.route("/:departmentId").get(verifyJWT, getDepartmentById);

// Update department (Admin only)
router.route("/:departmentId").patch(verifyJWT, authorizeRoles('admin'), updateDepartment);

// Delete department (Admin only)
router.route("/:departmentId").delete(verifyJWT, authorizeRoles('admin'), deleteDepartment);

export default router;
