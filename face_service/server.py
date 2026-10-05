import base64
import hmac
import json
import logging
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np

GRID_SIZE = 8
HISTOGRAM_BINS = 256
MAX_IMAGE_BYTES = 8 * 1024 * 1024
CASCADE = cv2.CascadeClassifier(
    os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml")
)


class FaceInputError(ValueError):
    pass


def face_histogram(image_bytes):
    if not CASCADE or CASCADE.empty():
        raise RuntimeError("OpenCV face detector could not be loaded")
    if not image_bytes or len(image_bytes) > MAX_IMAGE_BYTES:
        raise FaceInputError("invalid_image")

    image = cv2.imdecode(np.frombuffer(image_bytes, dtype=np.uint8), cv2.IMREAD_GRAYSCALE)
    if image is None or image.size == 0:
        raise FaceInputError("invalid_image")
    if image.shape[0] > 4000 or image.shape[1] > 4000:
        raise FaceInputError("invalid_image")

    faces = CASCADE.detectMultiScale(
        image,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(80, 80),
    )
    if len(faces) != 1:
        raise FaceInputError("invalid_image")

    x, y, width, height = (int(value) for value in faces[0])
    crop = cv2.resize(image[y : y + height, x : x + width], (128, 128))
    center = crop[1:-1, 1:-1]
    lbp = np.zeros(center.shape, dtype=np.uint8)
    neighbors = (
        crop[:-2, :-2],
        crop[:-2, 1:-1],
        crop[:-2, 2:],
        crop[1:-1, 2:],
        crop[2:, 2:],
        crop[2:, 1:-1],
        crop[2:, :-2],
        crop[1:-1, :-2],
    )
    for bit, neighbor in enumerate(neighbors):
        lbp |= ((neighbor >= center).astype(np.uint8) << bit)

    features = []
    for row in np.array_split(lbp, GRID_SIZE, axis=0):
        for cell in np.array_split(row, GRID_SIZE, axis=1):
            histogram = np.bincount(cell.ravel(), minlength=HISTOGRAM_BINS).astype(np.float32)
            histogram /= max(float(histogram.sum()), 1.0)
            features.extend(histogram.tolist())
    return features


def compare_histograms(reference, candidate):
    expected_length = GRID_SIZE * GRID_SIZE * HISTOGRAM_BINS
    if not isinstance(reference, list) or not isinstance(candidate, list):
        raise FaceInputError("invalid_template")
    if len(reference) != expected_length or len(candidate) != expected_length:
        raise FaceInputError("invalid_template")

    first = np.asarray(reference, dtype=np.float32).reshape(GRID_SIZE * GRID_SIZE, HISTOGRAM_BINS)
    second = np.asarray(candidate, dtype=np.float32).reshape(GRID_SIZE * GRID_SIZE, HISTOGRAM_BINS)
    if not np.isfinite(first).all() or not np.isfinite(second).all():
        raise FaceInputError("invalid_template")
    if np.any(first < 0) or np.any(second < 0):
        raise FaceInputError("invalid_template")

    distances = 0.5 * np.sum(((first - second) ** 2) / (first + second + 1e-10), axis=1)
    return float(np.mean(distances))


class FaceHandler(BaseHTTPRequestHandler):
    def log_message(self, format_string, *args):
        return

    def _send(self, status, payload):
        encoded = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        if self.path == "/health":
            self._send(200, {"status": "ok"})
            return
        self._send(404, {"error": "not_found"})

    def do_POST(self):
        token = os.environ.get("FACE_SERVICE_TOKEN", "")
        supplied_token = self.headers.get("X-Service-Token", "")
        if not token or not hmac.compare_digest(token, supplied_token):
            self._send(401, {"error": "unauthorized"})
            return
        if self.path not in ("/enroll", "/compare"):
            self._send(404, {"error": "not_found"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > 12 * 1024 * 1024:
                raise FaceInputError("invalid_image")
            request = json.loads(self.rfile.read(content_length))
            image_data = request.get("image")
            if not isinstance(image_data, str):
                raise FaceInputError("invalid_image")
            image_bytes = base64.b64decode(image_data, validate=True)
            candidate = face_histogram(image_bytes)

            if self.path == "/enroll":
                self._send(200, {"template": candidate})
            else:
                distance = compare_histograms(request.get("template"), candidate)
                self._send(200, {"distance": distance})
        except FaceInputError as err:
            error_code = str(err)
            self._send(422, {
                "error": error_code if error_code in ("invalid_image", "invalid_template") else "invalid_image"
            })
        except (ValueError, TypeError, json.JSONDecodeError):
            self._send(422, {"error": "invalid_image"})
        except Exception as err:
            logging.error("Face service request failed (%s)", type(err).__name__)
            self._send(500, {"error": "service_error"})


def main():
    if not os.environ.get("FACE_SERVICE_TOKEN"):
        raise RuntimeError("FACE_SERVICE_TOKEN must be set")
    host = os.environ.get("FACE_SERVICE_HOST", "127.0.0.1")
    port = int(os.environ.get("FACE_SERVICE_PORT", "8001"))
    server = ThreadingHTTPServer((host, port), FaceHandler)
    try:
        server.serve_forever()
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
