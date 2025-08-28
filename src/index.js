import { app } from './app.js'
import connectDB from './db/index.js'

import dotenv from 'dotenv'
dotenv.config({
    path:"./.env"
})

const port = process.env.PORT

connectDB().
then(()=>{
     app.listen(port,()=>{
      console.log(`server is listening on ${port}`);
    })
})
.catch((err)=>{
    console.log("MongoDB connection error" ,err); 
})