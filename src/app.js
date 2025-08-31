import express from "express"
import cors from "cors"
import cookieParser from "cookie-parser"

const app = express()

//Middlewares
app.use(
    cors({
        origin : "http://localhost:5173",  //frontend url
        credentials: true
    })
)

app.use(express.json({limit:"16kb"}))
app.use(express.urlencoded({extended: true , limit:"16kb"}))
app.use(express.static("public"))
app.use(cookieParser())

//Routes
import userRouter from "./router/user.router.js";
import reportRuter from "./router/report.router.js";
import departmentRouter from './router/department.router.js';
import municipalityRouter from './router/municipality.router.js';

app.use("/api/v1/user", userRouter);
app.use("/api/v1/report", reportRuter);
app.use("/api/v1/municipality", municipalityRouter);
app.use("/api/v1/department", departmentRouter);

app.use((err, req, res, next) => {
  const status = err.statuscode || 500;
  res.status(status).json({
    success: false,
    message: err.message || "Internal Server Error",
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});

export {app}