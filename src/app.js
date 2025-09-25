import express from "express"
import cors from "cors"
import cookieParser from "cookie-parser"

const app = express()

//Middlewares
app.use(
  cors({
    origin: [
      "https://jan-connect-kappa.vercel.app"
    ],
    credentials: true
  })
);
app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "Backend is running!" });
});


app.use(express.json({limit:"16kb"}))
app.use(express.urlencoded({extended: true , limit:"16kb"}))
app.use(express.static("public"))
app.use(cookieParser())

//Routes
import userRouter from "./router/user.router.js";
import reportRuter from "./router/report.router.js";
import departmentRouter from './router/department.router.js';
import municipalityRouter from './router/municipality.router.js';
import adminRouter from "./router/admin.router.js"

app.use("/api/v1/user", userRouter);
app.use("/api/v1/reports", reportRuter);
app.use("/api/v1/municipalities", municipalityRouter);
app.use("/api/v1/departments", departmentRouter);
app.use("/api/v1/admin", adminRouter);

app.use((err, req, res, next) => {
  const status = err.statuscode || 500;
  res.status(status).json({
    success: false,
    message: err.message || "Internal Server Error",
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});

export {app}