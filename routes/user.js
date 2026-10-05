const express = require("express");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const Organization=require('../models/organization');
const jwt = require('jsonwebtoken');
const md5=require('md5')
const Event = require("../models/events")
const Slots = require("../models/slots");
const Bookedslot = require("../models/bookedslot");
const DistributedRation=require("../models/distributedRation");
const Ration=require("../models/ration")
const User=require("../models/user");
const createFaceRouter = require("./face");
const {verifyFace} = require("../services/faceVerification");
require("dotenv/config");

const app = express(); 
app.use(bodyParser.json({limit: '10mb', extended: true}))
app.use(bodyParser.urlencoded({limit: '10mb', extended: true}));
const router = express.Router();
//getting all events
router.get("/events", async(req,res)=>{
    const events = await Event.find({});
    return res.json(events);
});

//all slots from perticular event
router.get("/events/:id/slots", async (req, res) => {
    try {
        const eventId = req.params.id
        const slots = await Slots.find({
            // event: eventId
        }).populate('rations.ration')

        return res.status(200).json(slots)
    }
    catch(err) {
        return res.status(400).json({error: err.message})
    }    
})

//booking slot 
router.patch("/events/:id/slots/:sid", async (req, res) => {
    try {
        const eventId = req.params.id
        const slot_id = req.params.sid
        const slot = await Slots.findOne({
            _id: slot_id
        })
       
        const currentTime = new Date();
        if (currentTime < slot.end_time && currentTime >= slot.start_time) {
            if (slot.limit > 0) {
                await Slots.updateOne({
                    _id: slot_id,
                },{ $inc: {
                    limit: -1,
                }})
                const newbookedslot=new Bookedslot({
                    user:req.user._id,
                    slot:slot_id
                })
               const bookedSlot= await newbookedslot.save();
                res.send(bookedSlot).status(200)
            }
            else
            {
                res.status(400).json({err:"Slot is full"});
            }
            
        }
        else
        {
            res.status(400).json({err:"Slot is finished!"});
        }
        // const slots = await Slots.updateOne({})
    }catch(err){
        res.send(err).status(400);
    }
})

function createDistributionHandler({
    RationModel = Ration,
    DistributedRationModel = DistributedRation,
    faceCheck = (userId, image) => verifyFace({
        userId,
        image,
        User,
        faceRecognition: require("../services/faceRecognition").createFaceRecognition(),
    }),
} = {}) {
    return async (req, res) => {
        const quantity = req.body.quantity;
        if (!Number.isSafeInteger(quantity) || quantity <= 0) {
            return res.status(400).json({error: "quantity must be a positive integer"});
        }

        let verificationMethod = "legacy";
        if (Object.prototype.hasOwnProperty.call(req.body, "faceImage")) {
            if (typeof req.body.faceImage !== "string" || req.body.faceImage.length > 10 * 1024 * 1024) {
                return res.status(400).json({error: "A valid base64 image is required"});
            }
            let result;
            try {
                result = await faceCheck(req.user._id, req.body.faceImage);
            } catch (err) {
                console.error("Face check failed:", err.message);
                return res.status(500).json({error: "Face check failed"});
            }
            if (result.status === "invalid_image") {
                return res.status(400).json({error: "The image could not be processed"});
            }
            if (result.status !== "match") {
                return res.status(202).json({
                    status: "manual_verification_required",
                    reason: result.reason,
                });
            }
            verificationMethod = "face_assisted";
        }

        const rationId = req.params.rid;
        const eventId = req.params.id;
        let ration;
        try {
            ration = await RationModel.findOneAndUpdate(
                {_id: rationId, stock: {$gte: quantity}},
                {$inc: {stock: -quantity}},
                {new: true},
            );
            if (!ration) {
                return res.status(409).json({error: "Ration is unavailable or stock is insufficient"});
            }

            const distribution = new DistributedRationModel({
                user: req.user._id,
                ration: rationId,
                event: eventId,
                quantity,
                verificationMethod,
            });
            const savedDistribution = await distribution.save();
            return res.status(200).json(savedDistribution);
        } catch (err) {
            if (ration) {
                try {
                    await RationModel.updateOne({_id: rationId}, {$inc: {stock: quantity}});
                } catch (rollbackError) {
                    console.error("Ration stock rollback failed:", rollbackError.message);
                    return res.status(500).json({error: "Distribution failed and stock reconciliation is required"});
                }
            }
            console.error("Ration distribution failed:", err.message);
            return res.status(500).json({error: "Ration distribution failed"});
        }
    };
}

router.post(
    "/events/:id/slots/:sid/rations/:rid",
    createDistributionHandler(),
);

router.use("/face", createFaceRouter());

router.post("/")

module.exports = router;
module.exports.createDistributionHandler = createDistributionHandler;
