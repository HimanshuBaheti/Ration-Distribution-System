# Ration distribution backend

Express/Mongoose API for user and organization accounts, event slots, and ration distribution.

## Local face-assisted verification

This optional, self-hosted feature uses OpenCV's frontal-face detector and a local
LBP histogram comparison. It is an assistive signal, not proof of identity,
liveness detection, or fraud prevention. Recognition can be affected by lighting,
camera quality, pose, and other factors. Do not use a face result as the sole
basis for withholding ration. A low-confidence result, missing enrollment, or
service outage returns a manual-review status; an organization operator can
complete the distribution after verifying the person using the organization's
normal in-person procedure.

Face enrollment is opt-in and stores only an encrypted feature template and
consent timestamp in MongoDB. The submitted image is processed in memory by the
local service and is not persisted or logged. Users can remove their template
at any time. Losing `FACE_TEMPLATE_KEY` makes existing templates unreadable;
back it up securely and rotate it only with a planned re-enrollment.

### Setup

1. Use Node.js 18 or newer, run `npm ci`, and configure the existing
   database/JWT values from `.env.example` in an ignored local `.env` file.
2. Create a separate Python environment (Python 3.10 or newer recommended) and
   install the local service requirements:

   ```sh
   python -m venv face_service/.venv
   face_service/.venv/bin/python -m pip install -r face_service/requirements.txt
   ```

3. Set the same random `FACE_SERVICE_TOKEN` for the Node API and Python
   process. Generate a template encryption key with:

   ```sh
   openssl rand -base64 32
   ```

   Put that value in `FACE_TEMPLATE_KEY`. Keep both secrets out of source
   control and logs.
4. Calibrate `FACE_MATCH_MAX_DISTANCE` using consented, locally collected
   enrollment and verification samples representative of the actual cameras
   and conditions. The service deliberately does not supply a universal match
   threshold. Until a valid value greater than `0` and at most `1` is set,
   face checks route to manual verification.
5. Start the local face service and the API in separate terminals:

   ```sh
   FACE_SERVICE_TOKEN='same-random-token' face_service/.venv/bin/python face_service/server.py
   npm start
   ```

   The face service binds only to `127.0.0.1` on port `8001` by default. Set
   `FACE_SERVICE_PORT` if needed. For separate containers, set
   `FACE_SERVICE_HOST` to the service's private interface, use a private
   internal network, and configure `FACE_SERVICE_URL`; do not expose the face
   service publicly.

### API behavior

All user endpoints require the existing `authtoken` user JWT. All manual
distribution endpoints require an organization JWT in `authtoken`.

- `POST /user/face/enroll` with `{ "consent": true, "image": "<base64>" }`
  enrolls or replaces the authenticated user's template.
- `DELETE /user/face/enroll` revokes enrollment and deletes the stored template.
- `POST /user/face/verify` with `{ "image": "<base64>" }` returns `200` with
  `{ "status": "match" }` for a match, or `202` with
  `{ "status": "manual_verification_required", "reason": "..." }` otherwise.
- The existing `POST /user/events/:id/slots/:sid/rations/:rid` endpoint accepts
  an optional `faceImage` field along with `quantity`. A match records the
  distribution as `face_assisted`. An inconclusive check returns `202` without
  decrementing stock; an operator can complete it through the manual endpoint.
  Requests without `faceImage` retain the existing non-biometric behavior.
- `POST /organization/distributions/manual` accepts
  `{ "userId", "eventId", "rationId", "quantity", "reason" }`. It verifies that
  the event and ration belong to the authenticated organization, atomically
  decrements available stock, and records the operator, time, and short reason.
  The reason must not contain sensitive personal or biometric details.

Images must be base64-encoded JPEG, PNG, or another format supported by the
installed OpenCV build, and contain exactly one detectable face. No image or
comparison score is returned in API responses. Do not send real biometric data
to development/test environments.

### Deployment and limitations

Keep the Node API, local face service, database, and their secrets on trusted
infrastructure. Restrict database access, backups, and logs; encrypted templates
are sensitive biometric data even though raw photos are not retained. Define
consent, access, retention, deletion, incident response, and legal review for
the deployment jurisdiction before enabling enrollment. Test accuracy and
unequal error rates in the intended population and conditions before use. This
prototype has no liveness check and must not be represented as preventing
spoofing or fraud.

## Development

```sh
npm test
npm start
```

The tests use Node's built-in test runner. Python service tests can be run after
installing its requirements:

```sh
face_service/.venv/bin/python -m unittest discover -s face_service -p 'test_*.py'
```
