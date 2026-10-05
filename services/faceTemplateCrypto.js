const crypto = require("crypto");

class FaceTemplateConfigurationError extends Error {}

function getEncryptionKey() {
  const encodedKey = process.env.FACE_TEMPLATE_KEY;
  if (!encodedKey) {
    throw new FaceTemplateConfigurationError("FACE_TEMPLATE_KEY is not configured");
  }

  const key = Buffer.from(encodedKey, "base64");
  if (key.length !== 32 || key.toString("base64") !== encodedKey) {
    throw new FaceTemplateConfigurationError("FACE_TEMPLATE_KEY must be a base64-encoded 32-byte key");
  }
  return key;
}

function encryptTemplate(template) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(template), "utf8"),
    cipher.final(),
  ]);
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    encrypted.toString("base64"),
  ].join(":");
}

function decryptTemplate(envelope) {
  try {
    const [version, encodedIv, encodedTag, encodedData, extra] = envelope.split(":");
    if (version !== "v1" || !encodedIv || !encodedTag || !encodedData || extra) {
      throw new Error("Invalid encrypted template format");
    }
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      getEncryptionKey(),
      Buffer.from(encodedIv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(encodedTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encodedData, "base64")),
      decipher.final(),
    ]).toString("utf8");
    const template = JSON.parse(plaintext);
    if (!Array.isArray(template)) {
      throw new Error("Invalid template payload");
    }
    return template;
  } catch (err) {
    if (err instanceof FaceTemplateConfigurationError) {
      throw err;
    }
    throw new FaceTemplateConfigurationError("Stored face template cannot be decrypted");
  }
}

module.exports = {
  FaceTemplateConfigurationError,
  decryptTemplate,
  encryptTemplate,
};
