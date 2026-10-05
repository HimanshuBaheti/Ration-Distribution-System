class FaceServiceError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = "FaceServiceError";
    this.statusCode = statusCode;
  }
}

const TEMPLATE_LENGTH = 8 * 8 * 256;

function isValidTemplate(template) {
  return Array.isArray(template) &&
    template.length === TEMPLATE_LENGTH &&
    template.every((value) => Number.isFinite(value) && value >= 0 && value <= 1);
}

function createFaceRecognition({
  baseUrl = process.env.FACE_SERVICE_URL || "http://127.0.0.1:8001",
  token = process.env.FACE_SERVICE_TOKEN,
  fetchImpl = globalThis.fetch,
  timeoutMs = 5000,
} = {}) {
  async function request(path, payload) {
    if (!token) {
      throw new FaceServiceError("FACE_SERVICE_TOKEN is not configured");
    }
    if (typeof fetchImpl !== "function") {
      throw new FaceServiceError("This Node.js version does not provide fetch");
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(new URL(path, baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Service-Token": token,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      let result;
      try {
        result = await response.json();
      } catch {
        throw new FaceServiceError("Face service returned an invalid response", response.status);
      }
      if (!response.ok) {
        throw new FaceServiceError(
          result.error === "invalid_image" ? "invalid_image" : "Face service request failed",
          response.status,
        );
      }
      return result;
    } catch (err) {
      if (err instanceof FaceServiceError) {
        throw err;
      }
      throw new FaceServiceError("Face service is unavailable");
    } finally {
      clearTimeout(timeout);
    }
  }

  return {
    async enroll(image) {
      const result = await request("/enroll", {image});
      if (!isValidTemplate(result.template)) {
        throw new FaceServiceError("Face service returned an invalid template");
      }
      return result.template;
    },
    async compare(image, template) {
      const result = await request("/compare", {image, template});
      if (!Number.isFinite(result.distance) || result.distance < 0 || result.distance > 1) {
        throw new FaceServiceError("Face service returned an invalid comparison score");
      }
      return result.distance;
    },
  };
}

module.exports = {FaceServiceError, createFaceRecognition, isValidTemplate};
