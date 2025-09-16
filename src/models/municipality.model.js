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
  departments: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
    }
  ],
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
  //location of municipality
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
  reports: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: "Report",
    }],
},{timestamps:true});

municipalitySchema.index({ location: "2dsphere" });

export const Municipality = mongoose.model("Municipality",municipalitySchema)
