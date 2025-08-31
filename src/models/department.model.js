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
  categories: [{
    type: String,
    enum: ["Infrastructure", "Sanitation", "Street Lighting", "Water Supply", "Traffic", "Parks", "Other"]
  }],
  contactPerson: {
    name: { type: String },
    designation: { type: String },
    phone: { type: String },
    email: { type: String }
  }
}, { timestamps: true });

export const Department = mongoose.model("Department",departmentSchema)

