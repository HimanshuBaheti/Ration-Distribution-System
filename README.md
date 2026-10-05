# Ration Distribution System

An Express and MongoDB backend for ration distribution. The API supports user
and organization accounts, distribution events, time slots, ration inventory,
and optional local face-assisted identity checks with an organization-operated
manual verification path.

> **Important:** Face matching is an optional assistive signal, not proof of
> identity. A match must not be the sole basis for providing or withholding
> ration. Missing enrollment, low confidence, or a face-service outage is routed
> to manual review. This prototype does not implement liveness detection and
> must not be described as preventing spoofing or fraud.

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Run locally](#run-locally)
- [Configuration](#configuration)
- [API overview](#api-overview)
- [Face-assisted verification](#face-assisted-verification)
- [Testing](#testing)
- [Security and privacy](#security-and-privacy)
- [Limitations](#limitations)

## Features

- Separate user and organization registration and login endpoints.
- JWT-protected user and organization API routes.
- Organization management of events, ration stock, and event slots.
- User access to events and slots, slot booking, and ration distribution.
- Optional, self-hosted face enrollment and comparison service.
- Encrypted face templates; raw enrollment and verification images are processed
  in memory and are not stored by the application.
- Organization-authenticated manual distribution for cases that need a human
  check, with the operator and a short reason recorded.

## Architecture

```text
Client
  └── Express API (Node.js)
        ├── MongoDB (Mongoose)
        └── Local face service (Python + OpenCV; optional)
```

The Express API listens on port `5000`. The optional Python service listens on
`127.0.0.1:8001` by default and is called by the API using a shared service
token. Keep the service on loopback or a private network; it is not designed to
be exposed directly to the public internet.

## Requirements

- Node.js 18 or later and npm.
- MongoDB, local or hosted, with a connection URI.
- Python 3.10 or later to run the optional face service.
- OpenSSL or another secure method to generate a 32-byte template encryption
  key.

## Run locally

### 1. Install Node dependencies

```sh
npm ci
```

### 2. Configure the API

Copy `.env.example` to `.env` and set at least:

```dotenv
DB_Connect=mongodb://127.0.0.1:27017/ration
TOKEN_SECRET=replace-with-a-long-random-secret
JWT_EXPIRE=1d
```

Keep `.env` private. It is ignored by Git. Do not commit production credentials.

### 3. Start MongoDB and the API

Start MongoDB using your local installation or hosting provider, then run:

```sh
npm start
```

The API is available at `http://localhost:5000`. During development, use
`npm run dev` to restart the server when files change. The configured browser
origin is currently `http://localhost:3000`; adjust the CORS policy in
`app.js` if your frontend is hosted elsewhere.

The service connects to MongoDB before opening its HTTP port. Check the
terminal output if the database connection fails.

### 4. (Optional) Start the face service

Create a separate virtual environment and install its dependencies:

```sh
python3 -m venv face_service/.venv
face_service/.venv/bin/python -m pip install -r face_service/requirements.txt
```

Add the following settings to the API's `.env`:

```dotenv
FACE_SERVICE_URL=http://127.0.0.1:8001
FACE_SERVICE_TOKEN=use-the-same-random-token-for-both-processes
FACE_TEMPLATE_KEY=base64-encoded-32-byte-key
FACE_MATCH_MAX_DISTANCE=
```

Generate independent random values for the service token and encryption key.
For example:

```sh
openssl rand -hex 32
openssl rand -base64 32
```

Use the first value for `FACE_SERVICE_TOKEN` and the second for
`FACE_TEMPLATE_KEY`. Supply the service token to the Python process too:

```sh
FACE_SERVICE_TOKEN='your-service-token' \
  face_service/.venv/bin/python face_service/server.py
```

In a second terminal, start the API with `npm start`. The service binds only to
loopback by default. To run it in a separate container, configure
`FACE_SERVICE_HOST` to a private interface and `FACE_SERVICE_URL` to the
container's private address. Do not expose the service port publicly.

**Matching is disabled until calibrated.** Set `FACE_MATCH_MAX_DISTANCE` only
after evaluating consented sample images from the actual cameras and expected
conditions. It must be a number greater than `0` and no greater than `1`.
There is no universal safe threshold. If it is missing or invalid, verification
falls back to manual review.

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `DB_Connect` | Yes | MongoDB connection URI. |
| `TOKEN_SECRET` | Yes | Secret used to sign and verify user and organization JWTs. |
| `JWT_EXPIRE` | Yes | JWT expiration accepted by `jsonwebtoken` (for example, `1d`). |
| `FACE_SERVICE_URL` | For face checks | Local face-service base URL; defaults to `http://127.0.0.1:8001`. |
| `FACE_SERVICE_TOKEN` | For face checks | Shared API-to-service authentication token. |
| `FACE_TEMPLATE_KEY` | For enrollment | Base64-encoded 32-byte AES-256-GCM key for stored templates. |
| `FACE_MATCH_MAX_DISTANCE` | For automatic match result | Calibrated comparison threshold greater than `0`, at most `1`. |
| `FACE_SERVICE_HOST` | Optional | Python service bind address; defaults to `127.0.0.1`. |
| `FACE_SERVICE_PORT` | Optional | Python service port; defaults to `8001`. |

Do not use placeholder secrets in a deployed environment. Store secrets in the
deployment platform's secret manager where available. Losing
`FACE_TEMPLATE_KEY` makes existing templates unreadable; back it up securely
and plan any key rotation together with user re-enrollment.

## API overview

Send JSON request bodies with `Content-Type: application/json`. Authenticated
routes use the `authtoken` request header:

```http
authtoken: <JWT>
```

User tokens come from `/userAuth/login`; organization tokens come from
`/orgAuth/login`.

### Authentication

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/userAuth/register` | Register a user. Fields used by the API: `fname`, `lname`, `adhar`, `ration`, `phone`, `password`. |
| `POST` | `/userAuth/login` | Log in using `phone` and `password`; returns a JWT. |
| `POST` | `/orgAuth/register` | Register an organization using `org_username`, `org_password`, `name`, `place`, and `email`. |
| `POST` | `/orgAuth/login` | Log in using `email` and `password`; returns a JWT. |

### User routes

All `/user` routes require a user JWT.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/user/events` | List distribution events. |
| `GET` | `/user/events/:eventId/slots` | List available slots. |
| `PATCH` | `/user/events/:eventId/slots/:slotId` | Book a slot. |
| `POST` | `/user/events/:eventId/slots/:slotId/rations/:rationId` | Distribute ration; requires a positive integer `quantity`. May also include `faceImage` to request an assistive face check. |
| `POST` | `/user/face/enroll` | Enroll or replace the signed-in user's face template, with explicit consent. |
| `DELETE` | `/user/face/enroll` | Remove the signed-in user's face template and consent timestamp. |
| `POST` | `/user/face/verify` | Compare an image to the signed-in user's enrolled template. |

### Organization routes

All `/organization` routes require an organization JWT.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET`, `POST` | `/organization/events` | List or create events. |
| `PUT`, `DELETE` | `/organization/events/:eventId` | Update or delete an event. |
| `GET`, `POST` | `/organization/ration` | List or create the organization's ration inventory. |
| `PUT`, `DELETE` | `/organization/ration/:rationId` | Update or delete ration inventory. |
| `GET`, `POST` | `/organization/events/:eventId/slots` | List or create event slots. |
| `PUT`, `DELETE` | `/organization/events/:eventId/slots/:slotId` | Update or delete an event slot. |
| `POST` | `/organization/distributions/manual` | Record a staff-verified ration distribution. |

### Face enrollment and verification

Images are sent as a base64-encoded image string (not a data URI). Requests
must fit within the API's 10 MB JSON body limit, and the face routes also limit
the encoded image field to 10 MB. Images must be supported by OpenCV and contain
exactly one detectable face.

Enroll only after obtaining the user's informed consent:

```sh
curl --request POST http://localhost:5000/user/face/enroll \
  --header 'Content-Type: application/json' \
  --header 'authtoken: USER_JWT' \
  --data '{"consent":true,"image":"BASE64_ENCODED_IMAGE"}'
```

The API responds with `{ "status": "enrolled" }`; it does not return the
template. To verify a face, send:

```json
{ "image": "BASE64_ENCODED_IMAGE" }
```

The response is one of:

| HTTP status | Example response | Meaning |
| --- | --- | --- |
| `200` | `{ "status": "match" }` | The comparison distance is within the configured threshold. |
| `202` | `{ "status": "manual_verification_required", "reason": "low_confidence" }` | No automatic decision; use the normal in-person procedure. Reasons include `not_enrolled`, `low_confidence`, and `recognition_unavailable`. |
| `400` | `{ "error": "The image could not be processed" }` | Invalid image or a face count other than one. |
| `503` | `{ "error": "Face enrollment is unavailable; use manual verification" }` | Enrollment cannot reach or use the face service. |

When `faceImage` is included in a ration distribution request, a match records
`verificationMethod: "face_assisted"`. A manual-review response does not debit
stock or create a distribution record.

For an in-person manual decision, an organization operator can submit:

```json
{
  "userId": "MONGODB_USER_ID",
  "eventId": "MONGODB_EVENT_ID",
  "rationId": "MONGODB_RATION_ID",
  "quantity": 1,
  "reason": "Verified in person"
}
```

to `POST /organization/distributions/manual` with the organization's
`authtoken`. The event and ration must belong to that organization. The
distribution records the operator, timestamp, and reason; do not put biometric
or unnecessary personal details in the reason.

## Testing

Run the Node API tests:

```sh
npm test
```

After installing the Python requirements, run the face-service tests:

```sh
face_service/.venv/bin/python -m unittest discover \
  -s face_service -p 'test_*.py'
```

The tests use synthetic template values and mocked face-service responses. They
do not establish real-world recognition accuracy or fairness. Do not use real
biometric data in development or test environments.

## Security and privacy

- Face enrollment is optional and requires an explicit consent flag.
- Face templates are encrypted in MongoDB using AES-256-GCM. Raw images are
  sent to the local service for in-memory processing and are not intentionally
  persisted by this application.
- `DELETE /user/face/enroll` removes the stored template and consent timestamp.
- A face match is advisory only. Missing enrollment, uncertain results, and
  service outages must be resolved through the organization's normal manual
  verification process.
- Keep the Python service on loopback or a private network, protect the shared
  service token and encryption key, restrict database access, and secure
  backups and operational logs.
- This codebase's existing account authentication uses MD5 for passwords.
  MD5 is not suitable for password storage; replace it with a password-hashing
  algorithm designed for passwords (such as Argon2id or bcrypt) before
  production deployment.
- Establish consent, access, retention, deletion, incident response, and legal
  review procedures for the deployment jurisdiction before collecting
  biometric data.

## Limitations

The local prototype detects a frontal face with OpenCV's Haar cascade and
compares local binary pattern (LBP) histograms. This is a lightweight
computer-vision baseline, not a modern learned face-embedding model. Performance
can vary substantially with lighting, pose, image quality, and population.
There is no liveness detection, presentation-attack detection, or validated
fairness/accuracy evaluation. Calibrate and evaluate with properly consented
data under the intended conditions before considering any operational use.
