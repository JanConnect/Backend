import mongoose from "mongoose";

const updateSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
  },
  message: {
    type: String,
    required: true,
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  }
});

const reportSchema = new mongoose.Schema({
  reportId: {
    type: String,
    unique: true,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true,
    enum: ["Infrastructure", "Sanitation", "Street Lighting", "Water Supply", "Traffic", "Parks", "Other"]
  },
  urgency: {
    type: String,
    enum: ["low", "medium", "high", "critical"],
    default: "medium",
    required: true
  },
  
  // Upvote system
  upvotes: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    upvotedAt: {
      type: Date,
      default: Date.now
    }
  }],
  upvoteCount: {
    type: Number,
    default: 0
  },
  
  // **FIXED: Combined priority score (1-5) - Remove default function**
  priority: {
    type: Number,
    min: 1,
    max: 5,
    default: 2 // Simple default value instead of function
  },
  
  // Breakdown of priority components for transparency
  priorityBreakdown: {
    urgencyScore: {
      type: Number,
      min: 1,
      max: 5,
      default: 2
    },
    communityScore: {
      type: Number,
      min: 0,
      max: 3,
      default: 0
    },
    finalScore: {
      type: Number,
      min: 1,
      max: 5,
      default: 2
    }
  },
  
  status: {
    type: String,
    enum: ["pending", "acknowledged", "in-progress", "resolved", "rejected", "pending_assignment","assigned"],
    default: "pending"
  },
  
  // **FIXED: Use 'date' field consistently**
  date: {
    type: Date,
    default: Date.now
  },
  
  resolvedDate: {
    type: Date
  },
  
  resolutionTime: {
    type: Number // in hours
  },
  
  description: {
    type: String,
    required: function() {
      return !this.voiceMessage?.url; // Required only if no voice message
    }
  },
  
  // **NEW: Voice message support**
  voiceMessage: {
    url: String,
    publicId: String,
    duration: Number,
    transcription: String, // For search functionality
    uploadedAt: Date
  },
  
  // **UPDATED: Single image support**
  image: {
    url: String,
    publicId: String,
    uploadedAt: Date
  },
  
  // **NEW: Resolution evidence**
  resolutionEvidence: {
    resolutionImage: {
      url: String,
      publicId: String,
      uploadedAt: Date,
      description: String,
      uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User"
      }
    },
    resolutionNotes: String,
    workCompletedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    completionDate: Date,
    materialsCost: Number,
    laborHours: Number
  },
  
  // **NEW: Verification data**
  verificationData: {
    userLocation: {
      lat: Number,
      lng: Number
    },
    distanceFromUser: Number,
    isLocationVerified: Boolean,
    verificationRadius: Number,
    smartScore: Number,
    smartVerified: Boolean,
    verificationMethod: String,
    locationScore: Number,
    timingScore: Number,
    qualityScore: Number
  },
  
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
    address: {
      type: String,
      default: 'Unknown Location'
    }
  },
  
  // **DEPRECATED: Old media field (keep for backward compatibility)**
  media: {
    url: String,
    publicId: String,
    type: {
      type: String,
      enum: ['image', 'video']
    },
  },
  
  reportedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  
  municipality: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Municipality"
  },
  
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Department"
  },
  
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User"
  },
  
  assignmentType: {
    type: String,
    enum: ["automatic", "manual", "pending"],
    default: "pending"
  },
  
  updates: [updateSchema],
  
  // **NEW: Comments system**
  comments: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    comment: {
      type: String,
      required: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  rating: {
    type: Number,
    min: 1,
    max: 5
  },
  
  feedback: {
    type: String
  },
  
}, { timestamps: true });

// Indexes
reportSchema.index({ location: "2dsphere" });

// **FIXED: Priority calculation method with null checks**
reportSchema.methods.calculatePriority = function() {
  // Base urgency scores
  const urgencyScores = {
    "low": 1.5,
    "medium": 2.5,
    "high": 4.0,
    "critical": 5.0
  };
  
  // Community engagement boost
  const upvoteBoosts = {
    tier1: { min: 1, max: 4, boost: 0.2 },
    tier2: { min: 5, max: 9, boost: 0.5 },
    tier3: { min: 10, max: 19, boost: 1.0 },
    tier4: { min: 20, max: 49, boost: 1.5 },
    tier5: { min: 50, max: Infinity, boost: 2.0 }
  };
  
  // Calculate base urgency score
  const urgencyScore = urgencyScores[this.urgency] || 2.5;
  
  // Calculate community boost
  let communityBoost = 0;
  const upvotes = this.upvoteCount || 0;
  
  for (const tier of Object.values(upvoteBoosts)) {
    if (upvotes >= tier.min && upvotes <= tier.max) {
      communityBoost = tier.boost;
      break;
    }
  }
  
  // **FIXED: Time decay factor with null check**
  let timeBoost = 0;
  const reportDate = this.date || this.createdAt || new Date();
  
  if (reportDate) {
    const reportAge = (Date.now() - reportDate.getTime()) / (1000 * 60 * 60 * 24);
    timeBoost = reportAge < 1 ? 0.2 : (reportAge < 7 ? 0.1 : 0);
  }
  
  // Final priority calculation
  let finalPriority = urgencyScore + communityBoost + timeBoost;
  
  // Cap at 5.0
  if (finalPriority > 5) finalPriority = 5;
  if (finalPriority < 1) finalPriority = 1;
  
  // Store breakdown for transparency
  this.priorityBreakdown = {
    urgencyScore: urgencyScore,
    communityScore: communityBoost,
    finalScore: Math.round(finalPriority * 10) / 10
  };
  
  return Math.round(finalPriority);
};

// **FIXED: Pre-save hook to calculate priority safely**
reportSchema.pre('save', function(next) {
  // Calculate priority only if document has required fields
  if (this.urgency && (this.date || this.createdAt)) {
    try {
      this.priority = this.calculatePriority();
    } catch (error) {
      console.error('Priority calculation error:', error);
      this.priority = 2; // Fallback to default
    }
  }
  next();
});

// Method to add upvote with priority recalculation
reportSchema.methods.addUpvote = function(userId) {
  const existingUpvote = this.upvotes.find(upvote => 
    upvote.userId.toString() === userId.toString()
  );
  
  if (existingUpvote) {
    throw new Error('User has already upvoted this report');
  }
  
  this.upvotes.push({ userId });
  this.upvoteCount = this.upvotes.length;
  this.priority = this.calculatePriority();
  return this.save();
};

// Method to remove upvote with priority recalculation
reportSchema.methods.removeUpvote = function(userId) {
  this.upvotes = this.upvotes.filter(upvote => 
    upvote.userId.toString() !== userId.toString()
  );
  this.upvoteCount = this.upvotes.length;
  this.priority = this.calculatePriority();
  return this.save();
};

// **NEW: Method to get content summary**
reportSchema.methods.getContentSummary = function() {
  if (this.description) {
    return this.description.length > 100 ? 
      this.description.substring(0, 100) + '...' : 
      this.description;
  } else if (this.voiceMessage?.transcription) {
    return this.voiceMessage.transcription.length > 100 ? 
      this.voiceMessage.transcription.substring(0, 100) + '...' : 
      this.voiceMessage.transcription;
  } else if (this.voiceMessage?.url) {
    return '[Voice Message]';
  } else {
    return 'No description available';
  }
};

// Performance indexes
reportSchema.index({ municipality: 1, status: 1, priority: -1, date: -1 });
reportSchema.index({ department: 1, status: 1, priority: -1 });
reportSchema.index({ priority: -1, urgency: 1, upvoteCount: -1 });
reportSchema.index({ reportedBy: 1 });
reportSchema.index({ 'upvotes.userId': 1 });
reportSchema.index({ status: 1, createdAt: -1 });
reportSchema.index({ assignmentType: 1 });

export const Report = mongoose.model("Report", reportSchema);

