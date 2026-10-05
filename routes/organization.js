const express = require("express");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const Organization=require('../models/organization');
const jwt = require('jsonwebtoken');
const md5=require('md5')
const Event = require("../models/events");
const Ration = require("../models/ration");
const Slots = require("../models/slots");
const User = require("../models/user");
const DistributedRation = require("../models/distributedRation");

require("dotenv/config");

const app = express(); 
app.use(bodyParser.json({limit: '10mb', extended: true}))
app.use(bodyParser.urlencoded({limit: '10mb', extended: true}));
const router = express.Router();

function createManualDistributionHandler({
    UserModel = User,
    EventModel = Event,
    RationModel = Ration,
    DistributedRationModel = DistributedRation,
} = {}) {
    return async (req, res) => {
        if (!req.user || !req.user._id) {
            return res.status(401).json({error: "Organization authentication required"});
        }
        const {userId, eventId, rationId, quantity, reason} = req.body;
        if (
            !mongoose.Types.ObjectId.isValid(userId) ||
            !mongoose.Types.ObjectId.isValid(eventId) ||
            !mongoose.Types.ObjectId.isValid(rationId) ||
            !Number.isSafeInteger(quantity) ||
            quantity <= 0 ||
            typeof reason !== "string" ||
            reason.trim().length < 3 ||
            reason.trim().length > 300
        ) {
            return res.status(400).json({error: "Valid user, event, ration, quantity, and reason are required"});
        }

        try {
            const [user, event] = await Promise.all([
                UserModel.findById(userId),
                EventModel.findOne({_id: eventId, organizationId: req.user._id}),
            ]);
            if (!user || !event) {
                return res.status(404).json({error: "User or organization event not found"});
            }

            const ration = await RationModel.findOneAndUpdate(
                {_id: rationId, organization: req.user._id, stock: {$gte: quantity}},
                {$inc: {stock: -quantity}},
                {new: true},
            );
            if (!ration) {
                const ownedRation = await RationModel.findOne({
                    _id: rationId,
                    organization: req.user._id,
                });
                return res.status(ownedRation ? 409 : 404).json({
                    error: ownedRation ? "Ration stock is insufficient" : "Ration not found",
                });
            }

            const distribution = new DistributedRationModel({
                user: userId,
                ration: rationId,
                event: eventId,
                quantity,
                verificationMethod: "manual",
                manualVerifiedBy: req.user._id,
                manualVerifiedAt: new Date(),
                manualVerificationReason: reason.trim(),
            });
            try {
                const savedDistribution = await distribution.save();
                return res.status(201).json(savedDistribution);
            } catch (err) {
                try {
                    await RationModel.updateOne({_id: rationId}, {$inc: {stock: quantity}});
                } catch (rollbackError) {
                    console.error("Manual ration stock rollback failed:", rollbackError.message);
                    return res.status(500).json({error: "Distribution failed and stock reconciliation is required"});
                }
                throw err;
            }
        } catch (err) {
            console.error("Manual ration distribution failed:", err.message);
            return res.status(500).json({error: "Manual ration distribution failed"});
        }
    };
}

router.post("/distributions/manual", createManualDistributionHandler());
//getting all events
router.get("/events", async(req,res)=>{
    const events = await Event.find({
        organizationId : req.user._id
    })
    return res.json(events);

})

//Creating events
router.post("/events",async(req,res)=>{
    const {start_time, end_time,name} = req.body;
    const event = new Event({
        start_time,
        end_time,
        organizationId: req.user._id,
        name
    })
    try
    {
        const newEvent = await event.save();
        return res.json(newEvent);
    }
    catch(err)
    {
        return res.status(400).json({error: err.message})
    }
});

//Update events
router.put("/events/:id", async(req,res)=>{
    const {start_time, end_time, name} = req.body;
    const id = req.params.id;
    try
    {
        const updatedEvent = await Event.findByIdAndUpdate(id,{
            start_time,
            end_time,
            name
        })
        
        return res.json(updatedEvent);
    }
    catch(err)
    {
        return res.status(400).json({error: err.message})
    }
})

//delete event
router.delete("/events/:id", async(req,res)=>{
 
    const id = req.params.id;
    try
    {
       const deleteEvent = await Event.deleteOne({_id:id})
        
        return res.json(deleteEvent);
    }
    catch(err)
    {
        return res.status(400).json({error: err.message})
    }
})

// get all rations
router.get("/ration", async (req, res) => {
    try {
        const rations = await Ration.find({
            organization: req.user._id
        })
        return res.status(200).json(rations)
    }
    catch(err) {
        return res.status(400).json({error: err.message})
    }
})

//create ration
router.post("/ration", async (req, res) => {
    const {name, type, price, stock, manufacturing_date, expiration_date} = req.body

    try {
        const ration = new Ration({
            name,
            type,
            price,
            stock,
            manufacturing_date,
            expiration_date,
            organization: req.user._id
        })

        const newRation = await ration.save()
        return res.status(200).json(newRation)

    }
    catch(err) {
        return res.status(400).json({error: err.message})
    }
})

//update ration
router.put("/ration/:id", async (req, res) => {
    const {name, type, price, stock, manufacturing_date, expiration_date, organization} = req.body
    const id = req.params.id;

    try {
        const updatedRation = await Ration.findByIdAndUpdate(id, {
            name,
            type,
            price,
            stock,
            manufacturing_date,
            expiration_date,
            organization
        })
        return res.status(200).json(updatedRation)
    }
    catch(err) {
        return res.status(400).json({error: err.message})
    }
})

//delete ration
router.delete("/ration/:id", async (req, res) => {
    const id = req.params.id;

    try {
        const deletedRation = await Ration.deleteOne({
            _id: id
        })
        return res.status(200).json(deletedRation)
    }
    catch(err) {
        return res.status(400).json({error: err.message})
    }
})

//get all slots of perticular event
router.get("/events/:id/slots", async (req, res) => {
    try {
        const eventId = req.params.id
        console.log(eventId)
        const slots = await Slots.find({
                 event: eventId
        })
        .populate('rations.ration')

        return res.status(200).json(slots)
    }
    catch(err) {
        return res.status(400).json({error: err.message})
    }
})

//create slots in events
router.post("/events/:id/slots", async (req, res) => {
    try {
        const {start_time, end_time, rations, limit} = req.body;
        const event=req.params.id
        console.log(new mongoose.Types.ObjectId(event))
        const slot = new Slots({
            event: new mongoose.Types.ObjectId(event),
            start_time,
            end_time,
            rations,
            limit
        });
        const newslot = await slot.save();
        return res.status(200).json(newslot)
    } catch (err) {
        console.log(err)
        return res.status(400).json({error: err.message})
    }
})

//update slots of an event
router.put("/events/:id/slots/:sid", async (req, res) => {
    try {
        const {start_time, end_time, rations, limit} = req.body;
        const slot_id = req.params.sid
        const slot = await Slots.findByIdAndUpdate(slot_id,{
            start_time,
            end_time,
            rations,
            limit
        });
        return res.status(200).json(slot)
    } catch (err) {
        return res.status(400).json({error: err.message})
    }
})

//delete slots sof any event
router.delete("/events/:id/slots/:sid", async (req, res) => {
    try {
        const slot_id = req.params.sid
        const slot = await Slots.deleteOne({
            _id: slot_id,
        });
        return res.status(200).json(slot)
    } catch (err) {
        return res.status(400).json({error: err.message})
    }
})

// //get all rations
// router.get("/rations", async (req, res) => {
//     try {
//         const rations = await Ration.find({})
//         return res.status(200).json(rations)
//     } catch (err) {
//         return res.status(400).json({error: err.message})
//     }
// })

module.exports = router;
module.exports.createManualDistributionHandler = createManualDistributionHandler;