import { Router } from "express";
import { verifyJWT } from "../middlewares/auth.middleware.js";
import { authorizeRoles } from "../middlewares/auth.middleware.js";
import {
  createMunicipality,
  getAllMunicipalities,
  getMunicipalityById,
  updateMunicipality,
  deleteMunicipality,
  getMunicipalitiesNearLocation,
  addDepartmentToMunicipality,
  removeDepartmentFromMunicipality
} from "../controllers/municipality.controller.js";

const router = Router();

// Create municipality (Admin only)
router.route("/create").post(verifyJWT, authorizeRoles('admin'), createMunicipality);

// Get all municipalities
router.route("/").get(verifyJWT, getAllMunicipalities);

// Get municipalities near location
router.route("/near").get(verifyJWT, getMunicipalitiesNearLocation);

// Get municipality by ID
router.route("/:municipalityId").get(verifyJWT, getMunicipalityById);

// Update municipality (Admin only)
router.route("/:municipalityId").patch(verifyJWT, authorizeRoles('admin'), updateMunicipality);

// Delete municipality (Admin only)
router.route("/:municipalityId").delete(verifyJWT, authorizeRoles('admin'), deleteMunicipality);

// Add department to municipality (Admin only)
router.route("/:municipalityId/departments/:departmentId").post(verifyJWT, authorizeRoles('admin'), addDepartmentToMunicipality);

// Remove department from municipality (Admin only)
router.route("/:municipalityId/departments/:departmentId").delete(verifyJWT, authorizeRoles('admin'), removeDepartmentFromMunicipality);

export default router;
