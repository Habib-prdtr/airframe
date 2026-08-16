/* ==========================================================================
   HAND TRACKER ENGINE v2.1 — ROBUST MOBILE CAMERA INITIALIZER
   ========================================================================== */

import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

class KalmanPoint {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.vx = 0;
    this.vy = 0;
    this.initialized = false;
  }

  update(measuredX, measuredY, dt) {
    if (!this.initialized) {
      this.x = measuredX;
      this.y = measuredY;
      this.vx = 0;
      this.vy = 0;
      this.initialized = true;
      return { x: this.x, y: this.y };
    }

    if (dt <= 0) dt = 1 / 60;

    const predictedX = this.x + this.vx * dt;
    const predictedY = this.y + this.vy * dt;

    const innovX = measuredX - predictedX;
    const innovY = measuredY - predictedY;

    const innovMag = Math.hypot(innovX, innovY);
    const gain = Math.min(0.95, Math.max(0.5, innovMag / 15));

    this.x = predictedX + gain * innovX;
    this.y = predictedY + gain * innovY;

    const measuredVx = (measuredX - (this.x - this.vx * dt)) / dt;
    const measuredVy = (measuredY - (this.y - this.vy * dt)) / dt;
    const velGain = 0.6;
    this.vx = this.vx + velGain * (measuredVx - this.vx);
    this.vy = this.vy + velGain * (measuredVy - this.vy);

    return { x: this.x, y: this.y };
  }

  extrapolate(dt) {
    if (!this.initialized) return { x: this.x, y: this.y };
    this.vx *= 0.85;
    this.vy *= 0.85;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    return { x: this.x, y: this.y };
  }

  reset() {
    this.initialized = false;
    this.vx = 0;
    this.vy = 0;
  }
}

export class HandTracker {
  constructor() {
    this.handLandmarker = null;
    this.videoEl = null;
    this.canvasEl = null;
    this.mode = 'single';
    this.isTracking = false;
    this.isMirrored = true;
    this.lastTimestamp = -1;
    this.lastFrameTime = performance.now();
    this.fps = 60;

    this.kalmanFilters = [
      Array.from({ length: 21 }, () => new KalmanPoint()),
      Array.from({ length: 21 }, () => new KalmanPoint())
    ];

    this.smoothedLandmarks = [];

    this.currentBox = {
      x: 0, y: 0, width: 0, height: 0, angle: 0,
      center: { x: 0, y: 0 },
      quad: [], p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 },
      isDetected: false, handCount: 0
    };

    this.lockedBox = null;
    this.missedFrames = 0;
    this.maxGraceFrames = 20;

    this.rafId = null;
    this.onFrameCallback = null;
  }

  async init(videoElement, canvasElement) {
    this.videoEl = videoElement;
    this.canvasEl = canvasElement;

    // 1. Initialize MediaPipe WASM Vision tasks
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );

    // 2. Create HandLandmarker (Try GPU delegate, fallback to CPU if WebGL fails on mobile)
    try {
      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
          delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.4,
        minHandPresenceConfidence: 0.4,
        minTrackingConfidence: 0.4
      });
    } catch (gpuErr) {
      console.warn("GPU delegate unavailable, falling back to CPU:", gpuErr);
      this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
          delegate: "CPU"
        },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.4,
        minHandPresenceConfidence: 0.4,
        minTrackingConfidence: 0.4
      });
    }

    // 3. Multi-Tier Camera Stream Fallback for Mobile & Desktop
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "user",
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
    } catch (e1) {
      console.warn("Ideal camera constraints failed, trying basic video:", e1);
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true });
      } catch (e2) {
        console.error("Camera access failed:", e2);
        throw e2;
      }
    }

    this.videoEl.srcObject = stream;
    await this.videoEl.play();
    this.isTracking = true;

    this.startLoop();
  }

  startLoop() {
    const loop = () => {
      this.rafId = requestAnimationFrame(loop);

      if (!this.videoEl || this.videoEl.readyState < 2) return;

      const now = performance.now();
      const frameDelta = (now - this.lastFrameTime) / 1000;
      this.lastFrameTime = now;
      if (frameDelta > 0) {
        this.fps = Math.round(0.9 * this.fps + 0.1 * (1 / frameDelta));
      }

      const timestamp = this.videoEl.currentTime;
      if (timestamp === this.lastTimestamp) return;
      this.lastTimestamp = timestamp;

      const results = this.handLandmarker.detectForVideo(this.videoEl, now);

      const width = this.canvasEl.width;
      const height = this.canvasEl.height;
      const dt = Math.max(frameDelta, 1 / 120);
      const handCount = results.landmarks ? results.landmarks.length : 0;

      if (handCount > 0) {
        this.missedFrames = 0;
        this.processLandmarksKalman(results.landmarks, width, height, dt);

        if (this.mode !== 'lock') {
          this.computeFramingQuad(width, height);
        }
      } else {
        if (this.mode !== 'lock') {
          this.missedFrames++;
          if (this.missedFrames <= this.maxGraceFrames && this.smoothedLandmarks.length > 0) {
            this.extrapolateLandmarks(width, height, dt);
            this.computeFramingQuad(width, height);
            this.currentBox.isDetected = true;
          } else {
            this.currentBox.isDetected = false;
            if (this.missedFrames > this.maxGraceFrames + 5) {
              this.kalmanFilters.forEach(hand => hand.forEach(kf => kf.reset()));
              this.smoothedLandmarks = [];
            }
          }
        }
      }

      if (this.mode === 'lock' && this.lockedBox) {
        this.currentBox = { ...this.lockedBox, isDetected: true };
      }

      if (this.onFrameCallback) {
        this.onFrameCallback({
          results,
          box: this.currentBox,
          smoothedLandmarks: this.smoothedLandmarks,
          fps: this.fps,
          handCount: handCount > 0 ? handCount : (this.currentBox.isDetected ? 1 : 0)
        });
      }
    };

    loop();
  }

  processLandmarksKalman(rawLandmarks, width, height, dt) {
    this.smoothedLandmarks = rawLandmarks.map((hand, handIdx) => {
      const filters = this.kalmanFilters[handIdx] || this.kalmanFilters[0];

      return hand.map((lm, lmIdx) => {
        let px = lm.x * width;
        let py = lm.y * height;

        if (this.isMirrored) {
          px = width - px;
        }

        const filtered = filters[lmIdx].update(px, py, dt);
        return { x: filtered.x, y: filtered.y, z: lm.z || 0 };
      });
    });
  }

  extrapolateLandmarks(width, height, dt) {
    this.smoothedLandmarks = this.smoothedLandmarks.map((hand, handIdx) => {
      const filters = this.kalmanFilters[handIdx] || this.kalmanFilters[0];

      return hand.map((lm, lmIdx) => {
        const extrap = filters[lmIdx].extrapolate(dt);
        extrap.x = Math.max(0, Math.min(width, extrap.x));
        extrap.y = Math.max(0, Math.min(height, extrap.y));
        return { x: extrap.x, y: extrap.y, z: lm.z || 0 };
      });
    });
  }

  setMode(newMode) {
    if (newMode === 'lock' && this.currentBox.isDetected) {
      this.lockedBox = JSON.parse(JSON.stringify(this.currentBox));
    }
    this.mode = newMode;
  }

  setMirrored(isMirrored) {
    this.isMirrored = isMirrored;
  }

  computeFramingQuad(width, height) {
    const hands = this.smoothedLandmarks;
    if (!hands || hands.length === 0) return;

    if (this.mode === 'dual' && hands.length >= 2) {
      let leftHand = hands[0];
      let rightHand = hands[1];
      if (hands[0][8].x > hands[1][8].x) {
        leftHand = hands[1];
        rightHand = hands[0];
      }

      const v0 = { x: leftHand[4].x, y: leftHand[4].y };
      const v1 = { x: leftHand[8].x, y: leftHand[8].y };
      const v2 = { x: rightHand[8].x, y: rightHand[8].y };
      const v3 = { x: rightHand[4].x, y: rightHand[4].y };

      this.setBoxFromQuad([v0, v1, v2, v3], 2);
      return;
    }

    // SINGLE HAND MODE
    const hand = hands[0];
    const thumbTip = hand[4];
    const indexTip = hand[8];
    const indexMCP = hand[5] || hand[6];
    const thumbMCP = hand[2] || hand[3];

    if (thumbTip && indexTip) {
      const dx = indexTip.x - thumbTip.x;
      const dy = indexTip.y - thumbTip.y;
      const spanDist = Math.hypot(dx, dy);

      const normX = -dy / (spanDist || 1);
      const normY = dx / (spanDist || 1);

      let depth = spanDist * 0.75;
      if (indexMCP && thumbMCP) {
        const mcpDist = Math.hypot(indexMCP.x - indexTip.x, indexMCP.y - indexTip.y);
        if (mcpDist > 10) depth = Math.max(30, mcpDist * 1.1);
      }

      const v0 = { x: thumbTip.x, y: thumbTip.y };
      const v1 = { x: indexTip.x, y: indexTip.y };
      const v2 = { x: indexTip.x + normX * depth, y: indexTip.y + normY * depth };
      const v3 = { x: thumbTip.x + normX * depth, y: thumbTip.y + normY * depth };

      this.setBoxFromQuad([v0, v1, v2, v3], 1);
    }
  }

  setBoxFromQuad(quad, handCount) {
    const xs = quad.map(v => v.x);
    const ys = quad.map(v => v.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
    const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;

    const dx = quad[1].x - quad[0].x;
    const dy = quad[1].y - quad[0].y;

    this.currentBox = {
      x: Math.round(minX),
      y: Math.round(minY),
      width: Math.round(maxX - minX),
      height: Math.round(maxY - minY),
      angle: Math.atan2(dy, dx),
      center: { x: cx, y: cy },
      quad,
      p1: quad[0],
      p2: quad[1],
      isDetected: true,
      handCount
    };
  }

  destroy() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    if (this.handLandmarker) this.handLandmarker.close();
    if (this.videoEl && this.videoEl.srcObject) {
      this.videoEl.srcObject.getTracks().forEach(t => t.stop());
    }
  }
}
