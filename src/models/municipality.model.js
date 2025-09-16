import mongoose from "mongoose";

const municipalitySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
    },
    state: {
        type: String,
        default: "Jharkhand",
    },
    district: {
        type: String,
        required: true,
    },
    departments: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "Department",
    }],
    // Replace contactPerson with admin reference
    admin: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true,
        validate: {
            validator: async function(adminId) {
                const User = mongoose.model('User');
                const user = await User.findById(adminId);
                return user && (user.role === 'admin' || user.role === 'superadmin');
            },
            message: 'Admin must have admin or superadmin role'
        }
    },
    // Reports array for this municipality
    reports: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "Report",
    }],
    location: {
        type: {
            type: String,
            enum: ['Point'],
            default: 'Point'
        },
        coordinates: {
            type: [Number],
            required: true
        },
    },
    
    // COMPREHENSIVE MUNICIPALITY STATS
    stats: {
        // Basic Report Statistics
        reports: {
            total: { type: Number, default: 0 },
            pending: { type: Number, default: 0 },
            inProgress: { type: Number, default: 0 },
            completed: { type: Number, default: 0 },
            rejected: { type: Number, default: 0 },
            pendingAssignment: { type: Number, default: 0 }, // "Other" category reports
        },
        
        // Assignment Statistics
        assignment: {
            autoAssigned: { type: Number, default: 0 },
            manualAssigned: { type: Number, default: 0 },
            unassigned: { type: Number, default: 0 },
            assignmentRate: { type: Number, default: 0 } // Percentage of assigned reports
        },
        
        // Category-wise Distribution
        categories: {
            infrastructure: { type: Number, default: 0 },
            sanitation: { type: Number, default: 0 },
            streetLighting: { type: Number, default: 0 },
            waterSupply: { type: Number, default: 0 },
            traffic: { type: Number, default: 0 },
            parks: { type: Number, default: 0 },
            other: { type: Number, default: 0 }
        },
        
        // Priority Distribution
        priority: {
            low: { type: Number, default: 0 },      // Priority 1-2
            medium: { type: Number, default: 0 },   // Priority 3
            high: { type: Number, default: 0 },     // Priority 4
            critical: { type: Number, default: 0 }  // Priority 5
        },
        
        // Performance Metrics
        performance: {
            avgResolutionTime: { type: Number, default: 0 }, // in hours
            completionRate: { type: Number, default: 0 }, // percentage
            citizenSatisfaction: { type: Number, default: 0 }, // average rating
            responseTimeAvg: { type: Number, default: 0 }, // time to first response
            totalUpvotes: { type: Number, default: 0 },
            avgPriority: { type: Number, default: 0 }
        },
        
        // Department Performance
        departmentPerformance: [{
            departmentId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "Department"
            },
            name: String,
            totalReports: { type: Number, default: 0 },
            completedReports: { type: Number, default: 0 },
            pendingReports: { type: Number, default: 0 },
            completionRate: { type: Number, default: 0 },
            avgResolutionTime: { type: Number, default: 0 },
            efficiency: { type: Number, default: 0 } // Overall efficiency score
        }],
        
        // Time-based Analytics
        temporal: {
            daily: [{
                date: String, // YYYY-MM-DD
                reportsCount: { type: Number, default: 0 },
                completedCount: { type: Number, default: 0 }
            }],
            monthly: [{
                month: Number, // 1-12
                year: Number,
                reportsCount: { type: Number, default: 0 },
                completedCount: { type: Number, default: 0 },
                avgResolutionTime: { type: Number, default: 0 }
            }],
            yearly: [{
                year: Number,
                reportsCount: { type: Number, default: 0 },
                completedCount: { type: Number, default: 0 },
                growthRate: { type: Number, default: 0 }
            }]
        },
        
        // Citizen Engagement
        engagement: {
            activeUsers: { type: Number, default: 0 }, // Users who reported in last 30 days
            repeatReporters: { type: Number, default: 0 }, // Users with multiple reports
            communityParticipation: { type: Number, default: 0 }, // Upvotes/comments ratio
            topReporters: [{
                userId: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "User"
                },
                reportCount: { type: Number, default: 0 },
                avgRating: { type: Number, default: 0 }
            }]
        },
        
        // Geographic Analysis
        geographic: {
            reportHotspots: [{
                area: String, // Can be locality/area name
                coordinates: [Number], // [longitude, latitude]
                reportCount: { type: Number, default: 0 },
                avgPriority: { type: Number, default: 0 },
                mostCommonCategory: String
            }],
            coverageAreas: [{
                departmentId: {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: "Department"
                },
                areaName: String,
                reportDensity: { type: Number, default: 0 }
            }]
        },
        
        // Resource Utilization
        resources: {
            totalStaff: { type: Number, default: 0 },
            activeStaff: { type: Number, default: 0 },
            staffEfficiency: { type: Number, default: 0 }, // Reports resolved per staff
            departmentCount: { type: Number, default: 0 },
            avgStaffPerDept: { type: Number, default: 0 },
            workloadDistribution: { type: Number, default: 0 } // Standard deviation
        },
        
        // Quality Metrics
        quality: {
            reopenedReports: { type: Number, default: 0 },
            escalatedReports: { type: Number, default: 0 },
            feedbackScore: { type: Number, default: 0 },
            complaintResolutionScore: { type: Number, default: 0 },
            publicSatisfactionIndex: { type: Number, default: 0 }
        },
        
        // Operational Efficiency
        efficiency: {
            peakHours: [{
                hour: { type: Number }, // 0-23
                reportCount: { type: Number, default: 0 }
            }],
            dayOfWeekPattern: [{
                day: { type: String }, // Monday, Tuesday, etc.
                reportCount: { type: Number, default: 0 },
                avgResolutionTime: { type: Number, default: 0 }
            }],
            seasonalTrends: [{
                season: { type: String }, // Spring, Summer, etc.
                reportCount: { type: Number, default: 0 },
                dominantCategory: String
            }]
        },
        
        // Comparative Analysis
        benchmarks: {
            districtRanking: { type: Number, default: 0 },
            stateRanking: { type: Number, default: 0 },
            performanceScore: { type: Number, default: 0 }, // Overall score out of 100
            improvementAreas: [String], // Areas needing attention
            strengths: [String] // Areas performing well
        },
        
        // Real-time Status
        realtime: {
            lastUpdated: { type: Date, default: Date.now },
            lastStatsCalculation: { type: Date, default: Date.now },
            currentLoad: { type: Number, default: 0 }, // Current pending reports
            alertLevel: {
                type: String,
                enum: ['low', 'medium', 'high', 'critical'],
                default: 'low'
            },
            systemHealth: { type: Number, default: 100 } // Health score out of 100
        }
    }
}, { timestamps: true });

// Indexes for performance
municipalitySchema.index({ location: "2dsphere" });
municipalitySchema.index({ district: 1, state: 1 });
municipalitySchema.index({ admin: 1 });
municipalitySchema.index({ "stats.performance.completionRate": -1 });

// Method to calculate comprehensive statistics
municipalitySchema.methods.calculateComprehensiveStats = async function() {
    const Report = mongoose.model('Report');
    const Department = mongoose.model('Department');
    const User = mongoose.model('User');
    
    // Get all reports for this municipality
    const allReports = await Report.find({ municipality: this._id });
    const departments = await Department.find({ municipality: this._id });
    
    // Basic report statistics
    const reportStats = {
        total: allReports.length,
        pending: allReports.filter(r => r.status === 'pending').length,
        inProgress: allReports.filter(r => r.status === 'in-progress').length,
        completed: allReports.filter(r => r.status === 'completed').length,
        rejected: allReports.filter(r => r.status === 'rejected').length,
        pendingAssignment: allReports.filter(r => r.status === 'pending_assignment').length
    };
    
    // Category distribution
    const categoryStats = {
        infrastructure: allReports.filter(r => r.category === 'Infrastructure').length,
        sanitation: allReports.filter(r => r.category === 'Sanitation').length,
        streetLighting: allReports.filter(r => r.category === 'Street Lighting').length,
        waterSupply: allReports.filter(r => r.category === 'Water Supply').length,
        traffic: allReports.filter(r => r.category === 'Traffic').length,
        parks: allReports.filter(r => r.category === 'Parks').length,
        other: allReports.filter(r => r.category === 'Other').length
    };
    
    // Priority distribution
    const priorityStats = {
        low: allReports.filter(r => r.priority <= 2).length,
        medium: allReports.filter(r => r.priority === 3).length,
        high: allReports.filter(r => r.priority === 4).length,
        critical: allReports.filter(r => r.priority === 5).length
    };
    
    // Performance metrics
    const completedReports = allReports.filter(r => r.status === 'completed');
    const totalResolutionTime = completedReports.reduce((acc, r) => acc + (r.resolutionTime || 0), 0);
    const totalRatings = completedReports.reduce((acc, r) => acc + (r.rating || 0), 0);
    const totalUpvotes = allReports.reduce((acc, r) => acc + (r.upvoteCount || 0), 0);
    
    const performanceStats = {
        avgResolutionTime: completedReports.length ? totalResolutionTime / completedReports.length : 0,
        completionRate: allReports.length ? (completedReports.length / allReports.length) * 100 : 0,
        citizenSatisfaction: completedReports.length ? totalRatings / completedReports.length : 0,
        totalUpvotes: totalUpvotes,
        avgPriority: allReports.length ? allReports.reduce((acc, r) => acc + r.priority, 0) / allReports.length : 0
    };
    
    // Department performance
    const deptPerformance = await Promise.all(departments.map(async (dept) => {
        const deptReports = allReports.filter(r => r.department && r.department.toString() === dept._id.toString());
        const deptCompleted = deptReports.filter(r => r.status === 'completed');
        
        return {
            departmentId: dept._id,
            name: dept.name,
            totalReports: deptReports.length,
            completedReports: deptCompleted.length,
            pendingReports: deptReports.filter(r => r.status === 'pending').length,
            completionRate: deptReports.length ? (deptCompleted.length / deptReports.length) * 100 : 0,
            avgResolutionTime: deptCompleted.length ? 
                deptCompleted.reduce((acc, r) => acc + (r.resolutionTime || 0), 0) / deptCompleted.length : 0,
            efficiency: deptReports.length ? (deptCompleted.length / deptReports.length) * 100 : 0
        };
    }));
    
    // Update municipality stats
    this.stats.reports = reportStats;
    this.stats.categories = categoryStats;
    this.stats.priority = priorityStats;
    this.stats.performance = performanceStats;
    this.stats.departmentPerformance = deptPerformance;
    this.stats.resources.departmentCount = departments.length;
    this.stats.realtime.lastStatsCalculation = new Date();
    
    // Calculate alert level based on pending reports
    const pendingRatio = reportStats.total ? reportStats.pending / reportStats.total : 0;
    if (pendingRatio > 0.7) this.stats.realtime.alertLevel = 'critical';
    else if (pendingRatio > 0.5) this.stats.realtime.alertLevel = 'high';
    else if (pendingRatio > 0.3) this.stats.realtime.alertLevel = 'medium';
    else this.stats.realtime.alertLevel = 'low';
    
    await this.save();
    return this.stats;
};

// Method to get municipality dashboard data
municipalitySchema.methods.getDashboardData = function() {
    return {
        basic: {
            name: this.name,
            district: this.district,
            state: this.state,
            totalDepartments: this.stats.resources.departmentCount,
            totalStaff: this.stats.resources.totalStaff
        },
        reports: this.stats.reports,
        performance: this.stats.performance,
        categories: this.stats.categories,
        priority: this.stats.priority,
        alerts: {
            level: this.stats.realtime.alertLevel,
            pendingAssignment: this.stats.reports.pendingAssignment,
            criticalReports: this.stats.priority.critical
        },
        trends: this.stats.temporal.monthly.slice(-6), // Last 6 months
        topDepartments: this.stats.departmentPerformance
            .sort((a, b) => b.completionRate - a.completionRate)
            .slice(0, 5)
    };
};

// Method to update real-time stats
municipalitySchema.methods.updateRealTimeStats = async function() {
    const Report = mongoose.model('Report');
    
    const currentPending = await Report.countDocuments({
        municipality: this._id,
        status: { $in: ['pending', 'pending_assignment'] }
    });
    
    this.stats.realtime.currentLoad = currentPending;
    this.stats.realtime.lastUpdated = new Date();
    
    await this.save();
};

export const Municipality = mongoose.model("Municipality", municipalitySchema);
