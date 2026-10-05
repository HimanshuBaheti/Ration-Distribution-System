const express = require("express");
const User = require("../models/user");
const {createFaceRecognition, FaceServiceError} = require("../services/faceRecognition");
const {encryptTemplate, decryptTemplate, FaceTemplateConfigurationError} = require("../services/faceTemplateCrypto");
const {verifyFace} = require("../services/faceVerification");

function createFaceRouter({
  UserModel = User,
  faceRecognition = createFaceRecognition(),
  encrypt = encryptTemplate,
  decrypt = decryptTemplate,
  maxDistance,
} = {}) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (!req.user || !req.user._id) {
      return res.status(401).json({error: "Authentication required"});
    }
    next();
  });

  router.post("/enroll", async (req, res) => {
    if (req.body.consent !== true) {
      return res.status(400).json({error: "Explicit face-template enrollment consent is required"});
    }
    if (typeof req.body.image !== "string" || req.body.image.length > 10 * 1024 * 1024) {
      return res.status(400).json({error: "A valid base64 image is required"});
    }
    try {
      const template = await faceRecognition.enroll(req.body.image);
      const encryptedTemplate = encrypt(template);
      const user = await UserModel.findByIdAndUpdate(
        req.user._id,
        {
          faceTemplateEncrypted: encryptedTemplate,
          faceConsentAt: new Date(),
        },
        {new: true},
      );
      if (!user) {
        return res.status(404).json({error: "User not found"});
      }
      return res.status(201).json({status: "enrolled"});
    } catch (err) {
      if (err instanceof FaceServiceError && err.statusCode === 422) {
        return res.status(400).json({error: "The image must contain exactly one detectable face"});
      }
      if (err instanceof FaceServiceError || err instanceof FaceTemplateConfigurationError) {
        return res.status(503).json({error: "Face enrollment is unavailable; use manual verification"});
      }
      console.error("Face enrollment failed:", err.message);
      return res.status(500).json({error: "Face enrollment failed"});
    }
  });

  router.delete("/enroll", async (req, res) => {
    try {
      const user = await UserModel.findByIdAndUpdate(
        req.user._id,
        {$unset: {faceTemplateEncrypted: 1, faceConsentAt: 1}},
        {new: true},
      );
      if (!user) {
        return res.status(404).json({error: "User not found"});
      }
      return res.status(200).json({status: "enrollment_removed"});
    } catch (err) {
      console.error("Face-template deletion failed:", err.message);
      return res.status(500).json({error: "Face-template deletion failed"});
    }
  });

  router.post("/verify", async (req, res) => {
    if (typeof req.body.image !== "string" || req.body.image.length > 10 * 1024 * 1024) {
      return res.status(400).json({error: "A valid base64 image is required"});
    }
    try {
      const result = await verifyFace({
        userId: req.user._id,
        image: req.body.image,
        User: UserModel,
        faceRecognition,
        decrypt,
        maxDistance,
      });
      if (result.status === "invalid_image") {
        return res.status(400).json({error: "The image could not be processed"});
      }
      if (result.status === "manual_verification_required") {
        return res.status(202).json(result);
      }
      return res.status(200).json(result);
    } catch (err) {
      console.error("Face verification failed:", err.message);
      return res.status(500).json({error: "Face verification failed"});
    }
  });

  return router;
}

module.exports = createFaceRouter;
module.exports.createFaceRouter = createFaceRouter;
