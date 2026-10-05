const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const createFaceRouter = require("../routes/face");
const {createDistributionHandler} = require("../routes/user");
const {createManualDistributionHandler} = require("../routes/organization");
const {FaceServiceError} = require("../services/faceRecognition");
const {createFaceRecognition} = require("../services/faceRecognition");
const {encryptTemplate, decryptTemplate} = require("../services/faceTemplateCrypto");
const {userverify, orgverify} = require("../routes/jwtverify");

const TEST_KEY = Buffer.alloc(32, 7).toString("base64");

function createHarness({
  user = {_id: "user-1", faceTemplateEncrypted: "encrypted-template"},
  faceRecognition = {
    enroll: async () => Array(8 * 8 * 256).fill(0.1),
    compare: async () => 0.1,
  },
  maxDistance = 0.2,
  onUpdate = () => {},
  onDelete = () => {},
} = {}) {
  const UserModel = {
    findById(id) {
      return {
        select: async () => id === user._id ? user : null,
      };
    },
    async findByIdAndUpdate(id, update) {
      if (update.$unset) {
        onDelete(update);
      } else {
        onUpdate(update);
      }
      return user;
    },
  };
  const app = express();
  app.use(express.json({limit: "12mb"}));
  app.use((req, res, next) => {
    if (req.headers.authtoken === "valid-user-token") {
      req.user = {_id: "user-1"};
    }
    next();
  });
  app.use("/user/face", createFaceRouter({
    UserModel,
    faceRecognition,
    encrypt: (template) => JSON.stringify(template),
    decrypt: () => [0.1, 0.2],
    maxDistance,
  }));
  const server = http.createServer(app);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        close: () => new Promise((done) => server.close(done)),
        url: `http://127.0.0.1:${server.address().port}`,
      });
    });
  });
}

test("face verification requires authentication", async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const response = await fetch(`${harness.url}/user/face/verify`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({image: "aW1hZ2U="}),
  });
  assert.equal(response.status, 401);
});

test("user and organization JWT middleware reject missing credentials", async () => {
  for (const middleware of [userverify, orgverify]) {
    const response = createResponse();
    let continued = false;
    await middleware({headers: {}}, response, () => { continued = true; });
    assert.equal(response.statusCode, 401);
    assert.equal(continued, false);
  }
});

test("face verification returns match for a score within the configured threshold", async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  const response = await fetch(`${harness.url}/user/face/verify`, {
    method: "POST",
    headers: {"Content-Type": "application/json", authtoken: "valid-user-token"},
    body: JSON.stringify({image: "aW1hZ2U="}),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {status: "match"});
});

test("low-confidence and unavailable checks explicitly require manual review", async (t) => {
  for (const [faceRecognition, reason] of [
    [{compare: async () => 0.8}, "low_confidence"],
    [{compare: async () => { throw new FaceServiceError("Face service is unavailable"); }}, "recognition_unavailable"],
  ]) {
    const harness = await createHarness({faceRecognition});
    const response = await fetch(`${harness.url}/user/face/verify`, {
      method: "POST",
      headers: {"Content-Type": "application/json", authtoken: "valid-user-token"},
      body: JSON.stringify({image: "aW1hZ2U="}),
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      status: "manual_verification_required",
      reason,
    });
    await harness.close();
  }
});

test("users without enrollment are routed to manual verification", async (t) => {
  const harness = await createHarness({
    user: {_id: "user-1", faceTemplateEncrypted: undefined},
  });
  t.after(harness.close);
  const response = await fetch(`${harness.url}/user/face/verify`, {
    method: "POST",
    headers: {"Content-Type": "application/json", authtoken: "valid-user-token"},
    body: JSON.stringify({image: "aW1hZ2U="}),
  });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    status: "manual_verification_required",
    reason: "not_enrolled",
  });
});

test("face verification rejects missing and oversized images", async (t) => {
  const harness = await createHarness();
  t.after(harness.close);
  for (const image of [undefined, "x".repeat(10 * 1024 * 1024 + 1)]) {
    const response = await fetch(`${harness.url}/user/face/verify`, {
      method: "POST",
      headers: {"Content-Type": "application/json", authtoken: "valid-user-token"},
      body: JSON.stringify({image}),
    });
    assert.equal(response.status, 400);
  }
});

test("enrollment requires explicit consent and stores only the encrypted template", async (t) => {
  let update;
  let deletion;
  const harness = await createHarness({
    onUpdate: (value) => { update = value; },
    onDelete: (value) => { deletion = value; },
  });
  t.after(harness.close);
  const response = await fetch(`${harness.url}/user/face/enroll`, {
    method: "POST",
    headers: {"Content-Type": "application/json", authtoken: "valid-user-token"},
    body: JSON.stringify({consent: true, image: "aW1hZ2U="}),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {status: "enrolled"});
  assert.equal(typeof update.faceTemplateEncrypted, "string");
  assert.ok(update.faceConsentAt instanceof Date);
  assert.equal(update.faceTemplateEncrypted.includes("aW1hZ2U="), false);

  const noConsent = await fetch(`${harness.url}/user/face/enroll`, {
    method: "POST",
    headers: {"Content-Type": "application/json", authtoken: "valid-user-token"},
    body: JSON.stringify({image: "aW1hZ2U="}),
  });
  assert.equal(noConsent.status, 400);

  const remove = await fetch(`${harness.url}/user/face/enroll`, {
    method: "DELETE",
    headers: {authtoken: "valid-user-token"},
  });
  assert.equal(remove.status, 200);
  assert.deepEqual(deletion, {$unset: {faceTemplateEncrypted: 1, faceConsentAt: 1}});
});

test("ration distribution does not debit stock when face check needs manual review", async () => {
  let debited = false;
  const handler = createDistributionHandler({
    RationModel: {
      async findOneAndUpdate() {
        debited = true;
      },
    },
    faceCheck: async () => ({
      status: "manual_verification_required",
      reason: "low_confidence",
    }),
  });
  const response = createResponse();
  await handler({
    body: {quantity: 1, faceImage: "aW1hZ2U="},
    params: {rid: "ration-1", id: "event-1"},
    user: {_id: "user-1"},
  }, response);
  assert.equal(response.statusCode, 202);
  assert.equal(debited, false);
});

test("ration distribution records successful face-assisted checks", async () => {
  let saved;
  const handler = createDistributionHandler({
    RationModel: {
      async findOneAndUpdate() {
        return {};
      },
    },
    DistributedRationModel: class {
      constructor(fields) {
        saved = fields;
      }
      async save() {
        return saved;
      }
    },
    faceCheck: async () => ({status: "match"}),
  });
  const response = createResponse();
  await handler({
    body: {quantity: 2, faceImage: "aW1hZ2U="},
    params: {rid: "ration-1", id: "event-1"},
    user: {_id: "user-1"},
  }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(saved.verificationMethod, "face_assisted");
});

test("ration distribution validates quantity", async () => {
  const handler = createDistributionHandler();
  const response = createResponse();
  await handler({
    body: {quantity: -1},
    params: {rid: "ration-1", id: "event-1"},
    user: {_id: "user-1"},
  }, response);
  assert.equal(response.statusCode, 400);
});

test("manual distribution requires organization authentication and records its operator", async () => {
  const handler = createManualDistributionHandler({
    UserModel: {findById: async () => ({})},
    EventModel: {findOne: async () => ({})},
    RationModel: {
      findOneAndUpdate: async () => ({}),
    },
    DistributedRationModel: class {
      constructor(fields) {
        this.fields = fields;
      }
      async save() {
        return this.fields;
      }
    },
  });
  const body = {
    userId: "64f000000000000000000001",
    eventId: "64f000000000000000000002",
    rationId: "64f000000000000000000003",
    quantity: 1,
    reason: "Verified in person",
  };
  const unauthorized = createResponse();
  await handler({body}, unauthorized);
  assert.equal(unauthorized.statusCode, 401);

  const response = createResponse();
  await handler({body, user: {_id: "64f000000000000000000004"}}, response);
  assert.equal(response.statusCode, 201);
  assert.equal(response.body.verificationMethod, "manual");
  assert.equal(response.body.manualVerifiedBy, "64f000000000000000000004");
});

test("local face-service client reports unavailable and invalid responses", async () => {
  const unavailable = createFaceRecognition({
    token: "test",
    fetchImpl: async () => { throw new Error("offline"); },
  });
  await assert.rejects(unavailable.enroll("aW1hZ2U="), FaceServiceError);

  const invalid = createFaceRecognition({
    token: "test",
    fetchImpl: async () => ({
      ok: false,
      status: 422,
      json: async () => ({error: "invalid_image"}),
    }),
  });
  await assert.rejects(
    invalid.enroll("aW1hZ2U="),
    (err) => err instanceof FaceServiceError && err.message === "invalid_image",
  );

  const malformedTemplate = createFaceRecognition({
    token: "test",
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({template: [0.1]}),
    }),
  });
  await assert.rejects(malformedTemplate.enroll("aW1hZ2U="), FaceServiceError);
});

test("face template encryption authenticates stored data", () => {
  process.env.FACE_TEMPLATE_KEY = TEST_KEY;
  const encrypted = encryptTemplate([0.1, 0.2]);
  assert.deepEqual(decryptTemplate(encrypted), [0.1, 0.2]);
  assert.throws(() => decryptTemplate(`${encrypted.slice(0, -2)}AA`));
});

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}
