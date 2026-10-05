
const jwt =require('jsonwebtoken');
require('dotenv/config');
const Organization=require("../models/organization")
const User=require("../models/user")


//=========================User JWT verify=================================
const userverify=async(req,res,next)=>{
    try{

        const {authtoken}= req.headers;
        if(!authtoken){
            return res.status(401).json({error: "Authentication required"});
        }
        const verify= await jwt.verify(authtoken,process.env.TOKEN_SECRET);
        req.user =await User.findById(verify.id);
        if (!req.user) {
            return res.status(401).json({error: "Authentication required"});
        }
        next();
    
    
       }catch(err){
        return res.status(401).json({error: "Invalid authentication token"});
    
       }
    
};
//=======================Organization JWT verify=============================
const orgverify=async(req,res,next)=>{

    try{

        const {authtoken}= req.headers;
        if(!authtoken){
            return res.status(401).json({error: "Authentication required"});
        }
        const verify= await jwt.verify(authtoken,process.env.TOKEN_SECRET);
        req.user =await Organization.findById(verify.id);
        if (!req.user) {
            return res.status(401).json({error: "Authentication required"});
        }
        next();
    
    
       }catch(err){
        return res.status(401).json({error: "Invalid authentication token"});
    
       }

}

module.exports={userverify,orgverify};
