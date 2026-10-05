const mongoose = require("mongoose");
var ObjectId = require('mongodb').ObjectID;

const distributedRationSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Users",
  },
  ration: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Rations",
  },
  quantity: {
    type: Number,
    required: true,
  },
  event: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Events",
  },
  verificationMethod: {
    type: String,
    enum: ["legacy", "face_assisted", "manual"],
    default: "legacy",
    required: true,
  },
  manualVerifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Oraganization",
  },
  manualVerifiedAt: {
    type: Date,
  },
  manualVerificationReason: {
    type: String,
    maxlength: 300,
  },
});

module.exports = mongoose.model("DistributedRation", distributedRationSchema);
