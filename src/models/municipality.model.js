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
  contactPerson: {
    name: String,
    designation: String,
    phone: String,
    email: String,
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
  },
},{timestamps:true});

municipalitySchema.index({ location: "2dsphere" });

export const Municipality = mongoose.model("Municipality",municipalitySchema)
