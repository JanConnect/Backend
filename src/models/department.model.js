import mongoose from "mongoose";

const departmentSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        default: ""
    },
    municipality: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Municipality",
        required: true
    },
    // Categories this department handles (excluding "Other")
    categories: [{
        type: String,
        enum: ["Infrastructure", "Sanitation", "Street Lighting", "Water Supply", "Traffic", "Parks"],
        required: true
    }],
    // Staff members instead of contactPerson
    staffMembers: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        role: {
            type: String,
            enum: ["head", "senior_staff", "junior_staff", "field_worker"],
            default: "junior_staff"
        },
        isActive: {
            type: Boolean,
            default: true
        },
        joinedAt: {
            type: Date,
            default: Date.now
        }
    }],
    // Reports assigned to this department
    reports: [{
        reportId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Report",
            required: true
        },
        assignmentType: {
            type: String,
            enum: ["automatic", "manual"],
            required: true
        },
        assignedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User" // Municipality admin who manually assigned (null for automatic)
        },
        assignedAt: {
            type: Date,
            default: Date.now
        },
        assignedTo: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User" // Specific staff member assigned (optional)
        },
        completedAt: {
            type: Date // When report was completed
        },
        resolutionTime: {
            type: Number // Time taken in hours
        }
    }],
    
    // COMPREHENSIVE STATS SECTION
    stats: {
        // Basic Report Counts
        totalReports: {
            type: Number,
            default: 0
        },
        pendingReports: {
            type: Number,
            default: 0
        },
        inProgressReports: {
            type: Number,
            default: 0
        },
        completedReports: {
            type: Number,
            default: 0
        },
        rejectedReports: {
            type: Number,
            default: 0
        },
        
        // Assignment Statistics
        autoAssignedReports: {
            type: Number,
            default: 0
        },
        manualAssignedReports: {
            type: Number,
            default: 0
        },
        
        // Priority Distribution
        priorityDistribution: {
            low: { type: Number, default: 0 },      // Priority 1-2
            medium: { type: Number, default: 0 },   // Priority 3
            high: { type: Number, default: 0 },     // Priority 4
            critical: { type: Number, default: 0 }  // Priority 5
        },
        
        // Category Performance (for multi-category departments)
        categoryStats: [{
            category: {
                type: String,
                enum: ["Infrastructure", "Sanitation", "Street Lighting", "Water Supply", "Traffic", "Parks"]
            },
            totalReports: { type: Number, default: 0 },
            completedReports: { type: Number, default: 0 },
            avgResolutionTime: { type: Number, default: 0 }, // in hours
            completionRate: { type: Number, default: 0 } // percentage
        }],
        
        // Performance Metrics
        performance: {
            avgResolutionTime: {
                type: Number,
                default: 0 // Average time in hours
            },
            completionRate: {
                type: Number,
                default: 0 // Percentage of completed reports
            },
            avgRating: {
                type: Number,
                default: 0 // Average citizen rating
            },
            totalUpvotes: {
                type: Number,
                default: 0
            },
            responseTimeAvg: {
                type: Number,
                default: 0 // Time to first response in hours
            }
        },
        
        // Staff Performance
        staffPerformance: [{
            userId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User"
            },
            assignedReports: { type: Number, default: 0 },
            completedReports: { type: Number, default: 0 },
            avgResolutionTime: { type: Number, default: 0 },
            completionRate: { type: Number, default: 0 },
            lastAssignedAt: { type: Date }
        }],
        
        // Time-based Analytics
        monthly: [{
            month: { type: Number }, // 1-12
            year: { type: Number },
            totalReports: { type: Number, default: 0 },
            completedReports: { type: Number, default: 0 },
            avgResolutionTime: { type: Number, default: 0 }
        }],
        
        // Department Efficiency Metrics
        efficiency: {
            workloadBalance: {
                type: Number,
                default: 0 // Standard deviation of workload across staff
            },
            peakHours: [{
                hour: { type: Number }, // 0-23
                reportCount: { type: Number, default: 0 }
            }],
            dayOfWeekDistribution: [{
                day: { type: String }, // Monday, Tuesday, etc.
                reportCount: { type: Number, default: 0 }
            }]
        },
        
        // Last Updated
        lastUpdated: {
            type: Date,
            default: Date.now
        },
        lastStatsCalculation: {
            type: Date,
            default: Date.now
        }
    }
}, { timestamps: true });

// Indexes for performance
departmentSchema.index({ municipality: 1, categories: 1 });
departmentSchema.index({ "staffMembers.userId": 1 });
departmentSchema.index({ "reports.reportId": 1 });

// Method for automatic assignment based on category
departmentSchema.statics.autoAssignByCategory = async function(reportId, category, municipalityId) {
    if (category === "Other") {
        return null; // Requires manual assignment
    }
    
    const department = await this.findOne({
        municipality: municipalityId,
        categories: category
    });
    
    if (!department) {
        return null;
    }
    
    // Add report to department
    department.reports.push({
        reportId: reportId,
        assignmentType: "automatic"
    });
    
    // Update stats
    department.stats.totalReports += 1;
    department.stats.pendingReports += 1;
    department.stats.autoAssignedReports += 1;
    department.stats.lastUpdated = new Date();
    
    await department.save();
    return department;
};

// Method for manual assignment
departmentSchema.statics.manualAssign = async function(reportId, departmentId, adminId, staffId = null) {
    const department = await this.findById(departmentId);
    
    if (!department) {
        throw new Error('Department not found');
    }
    
    department.reports.push({
        reportId: reportId,
        assignmentType: "manual",
        assignedBy: adminId,
        assignedTo: staffId
    });
    
    // Update stats
    department.stats.totalReports += 1;
    department.stats.pendingReports += 1;
    department.stats.manualAssignedReports += 1;
    department.stats.lastUpdated = new Date();
    
    await department.save();
    return department;
};

// Method to update report status and stats
departmentSchema.methods.updateReportStatus = async function(reportId, newStatus, rating = null, upvotes = 0) {
    const reportIndex = this.reports.findIndex(report =>
        report.reportId.toString() === reportId.toString()
    );
    
    if (reportIndex === -1) {
        throw new Error('Report not found in this department');
    }
    
    const report = this.reports[reportIndex];
    const assignedAt = report.assignedAt;
    
    // Calculate resolution time if completed
    if (newStatus === 'completed') {
        const resolutionTime = (new Date() - assignedAt) / (1000 * 60 * 60); // in hours
        report.completedAt = new Date();
        report.resolutionTime = resolutionTime;
        
        // Update completion stats
        this.stats.pendingReports -= 1;
        this.stats.completedReports += 1;
        
        // Update performance metrics
        const totalCompleted = this.stats.completedReports;
        const currentAvg = this.stats.performance.avgResolutionTime;
        this.stats.performance.avgResolutionTime = 
            ((currentAvg * (totalCompleted - 1)) + resolutionTime) / totalCompleted;
        
        if (rating) {
            const currentRating = this.stats.performance.avgRating;
            this.stats.performance.avgRating = 
                ((currentRating * (totalCompleted - 1)) + rating) / totalCompleted;
        }
        
        this.stats.performance.totalUpvotes += upvotes;
        
        // Update completion rate
        this.stats.performance.completionRate = 
            (this.stats.completedReports / this.stats.totalReports) * 100;
    }
    
    if (newStatus === 'in_progress') {
        this.stats.pendingReports -= 1;
        this.stats.inProgressReports += 1;
    }
    
    this.stats.lastUpdated = new Date();
    
    await this.save();
    return this;
};

// Method to calculate comprehensive stats
departmentSchema.methods.calculateDetailedStats = async function() {
    const Report = mongoose.model('Report');
    
    // Get all reports for this department
    const allReports = await Report.find({ department: this._id });
    
    // Reset stats
    const stats = {
        totalReports: allReports.length,
        pendingReports: 0,
        inProgressReports: 0,
        completedReports: 0,
        rejectedReports: 0,
        autoAssignedReports: 0,
        manualAssignedReports: 0,
        priorityDistribution: { low: 0, medium: 0, high: 0, critical: 0 },
        categoryStats: [],
        performance: {
            avgResolutionTime: 0,
            completionRate: 0,
            avgRating: 0,
            totalUpvotes: 0,
            responseTimeAvg: 0
        }
    };
    
    // Calculate stats from reports
    let totalResolutionTime = 0;
    let completedCount = 0;
    let totalRating = 0;
    let ratedCount = 0;
    let totalUpvotes = 0;
    
    allReports.forEach(report => {
        // Status distribution
        stats[report.status + 'Reports']++;
        
        // Assignment type
        const reportInDept = this.reports.find(r => r.reportId.toString() === report._id.toString());
        if (reportInDept) {
            stats[reportInDept.assignmentType + 'AssignedReports']++;
        }
        
        // Priority distribution
        if (report.priority <= 2) stats.priorityDistribution.low++;
        else if (report.priority === 3) stats.priorityDistribution.medium++;
        else if (report.priority === 4) stats.priorityDistribution.high++;
        else stats.priorityDistribution.critical++;
        
        // Performance metrics
        if (report.status === 'completed') {
            completedCount++;
            if (reportInDept && reportInDept.resolutionTime) {
                totalResolutionTime += reportInDept.resolutionTime;
            }
        }
        
        if (report.rating) {
            totalRating += report.rating;
            ratedCount++;
        }
        
        totalUpvotes += report.upvoteCount || 0;
    });
    
    // Calculate averages
    stats.performance.completionRate = (completedCount / allReports.length) * 100 || 0;
    stats.performance.avgResolutionTime = totalResolutionTime / completedCount || 0;
    stats.performance.avgRating = totalRating / ratedCount || 0;
    stats.performance.totalUpvotes = totalUpvotes;
    
    // Update the department stats
    this.stats = { ...this.stats, ...stats, lastStatsCalculation: new Date() };
    
    await this.save();
    return this.stats;
};

// Method to get department dashboard data
departmentSchema.methods.getDashboardStats = function() {
    return {
        overview: {
            totalReports: this.stats.totalReports,
            pendingReports: this.stats.pendingReports,
            inProgressReports: this.stats.inProgressReports,
            completedReports: this.stats.completedReports,
            completionRate: this.stats.performance.completionRate
        },
        performance: this.stats.performance,
        staffCount: this.staffMembers.filter(staff => staff.isActive).length,
        categories: this.categories,
        priorityDistribution: this.stats.priorityDistribution,
        lastUpdated: this.stats.lastUpdated
    };
};

export const Department = mongoose.model("Department", departmentSchema);
