import multer from "multer"
import path from 'path';

const storage = multer.diskStorage({
    destination:function(req,file,cb){
        cb(null,'./public/temp')
    },
    filename: function(req,file,cb){
        const ext = path.extname(file.originalname);      
        const baseName = path.basename(file.originalname, ext); 
        const newFileName = `${baseName}-${Date.now()}${ext}`; 
        cb(null, newFileName);
    }
    
})

export const upload = multer({
    storage
})