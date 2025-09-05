import mongoose from "mongoose";

const adminSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true
  },
  permissions: [{
    type: String,
    enum: [
      "manage_users",
      "manage_departments", 
      "manage_municipalities",
      "manage_reports",
      "view_analytics",
      "system_settings",
      "bulk_operations",
      "export_data"
    ]
  }],
  systemRole: {
    type: String,
    enum: ["super_admin", "municipal_admin", "department_admin"],
    default: "municipal_admin"
  },
  assignedMunicipalities: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Municipality"
  }],
  assignedDepartments: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Department"  
  }],
  lastLogin: {
    type: Date
  },
  isActive: {
    type: Boolean,
    default: true
  },
  activityLog: [{
    action: {
      type: String,
      required: true
    },
    description: {
      type: String,
      required: true
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    targetResource: {
      type: String // report, user, department, etc.
    },
    targetId: {
      type: String
    }
  }]
}, { timestamps: true });

// Indexes for performance
adminSchema.index({ userId: 1 });
adminSchema.index({ systemRole: 1, isActive: 1 });
adminSchema.index({ assignedMunicipalities: 1 });
adminSchema.index({ "activityLog.timestamp": -1 });

// Method to log admin activities
adminSchema.methods.logActivity = function(action, description, targetResource = null, targetId = null) {
  this.activityLog.push({
    action,
    description,
    targetResource,
    targetId,
    timestamp: new Date()
  });
  
  // Keep only last 100 activities
  if (this.activityLog.length > 100) {
    this.activityLog = this.activityLog.slice(-100);
  }
  
  return this.save();
};

// Method to check permissions
adminSchema.methods.hasPermission = function(permission) {
  return this.permissions.includes(permission) || this.systemRole === 'super_admin';
};

export const Admin = mongoose.model("Admin", adminSchema);
