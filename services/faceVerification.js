const {FaceServiceError} = require("./faceRecognition");
const {FaceTemplateConfigurationError, decryptTemplate} = require("./faceTemplateCrypto");

function getMaximumDistance(value = process.env.FACE_MATCH_MAX_DISTANCE) {
  const distance = Number(value);
  if (value === undefined || value === "" || !Number.isFinite(distance) || distance <= 0 || distance > 1) {
    throw new FaceTemplateConfigurationError(
      "FACE_MATCH_MAX_DISTANCE must be a calibrated number greater than 0 and at most 1",
    );
  }
  return distance;
}

async function verifyFace({
  userId,
  image,
  User,
  faceRecognition,
  decrypt = decryptTemplate,
  maxDistance,
}) {
  const user = await User.findById(userId).select("+faceTemplateEncrypted");
  if (!user || !user.faceTemplateEncrypted) {
    return {status: "manual_verification_required", reason: "not_enrolled"};
  }

  try {
    const template = decrypt(user.faceTemplateEncrypted);
    const threshold = getMaximumDistance(maxDistance);
    const distance = await faceRecognition.compare(image, template);
    return distance <= threshold
      ? {status: "match"}
      : {status: "manual_verification_required", reason: "low_confidence"};
  } catch (err) {
    if (err instanceof FaceServiceError && err.message === "invalid_image") {
      return {status: "invalid_image"};
    }
    if (err instanceof FaceServiceError || err instanceof FaceTemplateConfigurationError) {
      return {status: "manual_verification_required", reason: "recognition_unavailable"};
    }
    throw err;
  }
}

module.exports = {getMaximumDistance, verifyFace};
