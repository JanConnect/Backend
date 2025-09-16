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
    getMunicipalityAnalytics,
    manualAssignReport
} from "../controllers/municipality.controller.js";

const router = Router();

// All routes require authentication
router.use(verifyJWT);

// Public municipality routes (authenticated users)
router.route("/").get(getAllMunicipalities);
router.route("/near").get(getMunicipalitiesNearLocation);
router.route("/:municipalityId").get(getMunicipalityById);
router.route("/:municipalityId/analytics").get(getMunicipalityAnalytics);

// Super Admin only routes
router.route("/create").post(authorizeRoles('superadmin'), createMunicipality);
router.route("/:municipalityId").patch(authorizeRoles('superadmin'), updateMunicipality);
router.route("/:municipalityId").delete(authorizeRoles('superadmin'), deleteMunicipality);

// Municipality Admin routes
router.route("/:municipalityId/departments").post(
    authorizeRoles('admin', 'superadmin'), 
    addDepartmentToMunicipality
);
router.route("/:municipalityId/assign-report").post(
    authorizeRoles('admin', 'superadmin'), 
    manualAssignReport
);

export default router;
