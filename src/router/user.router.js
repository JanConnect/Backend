import { Router } from "express";
import {upload} from "../middlewares/multer.middleware.js"
import {verifyJWT} from "../middlewares/auth.middleware.js"
import { getCurrentUser, loginUser, logoutUser, registerUser, updateAccessToken } from "../controllers/user.controller.js";

const router = Router()

router.route("/register").post(upload.single("avatar"),registerUser)
router.route("/login").post(loginUser)
router.route("/current-user").get(verifyJWT,getCurrentUser)
router.route("/update-access-token").post(verifyJWT,updateAccessToken)
router.route("/logout").post(verifyJWT,logoutUser)

export default router