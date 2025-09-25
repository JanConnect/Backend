import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";

const app = express();

// List of allowed origins
const allowedOrigins = [
  "https://janconnect.github.io/JanConnect",
  "https://jan-connect-git-main-aditi-bansals-projects.vercel.app"
];

// Enable CORS
app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin like Postman
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      return callback(new Error("Not allowed by CORS"), false);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  optionsSuccessStatus: 200
}));

// Handle preflight requests for all routes
app.options("*", cors());

// Middlewares
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use(express.static("public"));
app.use(cookieParser());

// Routes
import userRouter from "./router/user.router.js";
import reportRuter from "./router/report.router.js";
import departmentRouter from './router/department.router.js';
import municipalityRouter from './router/municipality.router.js';
import adminRouter from "./router/admin.router.js";

app.use("/api/v1/user", userRouter);
app.use("/api/v1/reports", reportRuter);
app.use("/api/v1/municipalities", municipalityRouter);
app.use("/api/v1/departments", departmentRouter);
app.use("/api/v1/admin", adminRouter);

// Error handler
app.use((err, req, res, next) => {
  const status = err.statuscode || 500;
  res.status(status).json({
    success: false,
    message: err.message || "Internal Server Error",
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
});

export { app };
