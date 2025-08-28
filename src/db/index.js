import mongoose from "mongoose"

import dotenv from 'dotenv'
dotenv.config({
    path:"./.env"
})
const DB_NAME = process.env.DB_NAME

const connectDB = async ()=>{
    try {
        const connectionInstance = await mongoose.connect(`${process.env.MONGODB_URI}/${DB_NAME}`)
        console.log(`\n mongoDB connected ! DB host : ${connectionInstance.connection.host} `);
    } catch (error) {
        console.log("mongodb connection error !");
        process.exit(1)  
    }
}

export default connectDB