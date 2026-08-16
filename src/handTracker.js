/* ==========================================================================
   HAND TRACKER ENGINE v2.0 — TOTAL REWRITE
   
   Powered by:
   1. MediaPipe Tasks Vision HandLandmarker (GPU WASM SIMD Delegate)
   2. Kalman Predictive Velocity Filter (predict WHERE finger WILL BE)
   3. requestAnimationFrame zero-copy rendering pipeline
   4. Trajectory Extrapolation on tracking loss
   ========================================================================== */

import { HandLandmarker, FilesetResolver } from "@mediapipe/tasks-vision";

// ---- Kalman-style 1D Predictive Filter ----
class KalmanPoint {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.vx = 0;      // velocity X
    this.vy = 0;      // velocity Y
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

    // Predict step: where do we EXPECT the point to be based on velocity
    const predictedX = this.x + this.vx * dt;
    const predictedY = this.y + this.vy * dt;

    // Innovation (difference between measured and predicted)
    const innovX = measuredX - predictedX;
    const innovY = measuredY - predictedY;

    // Adaptive Kalman Gain based on innovation magnitude
    // Large innovation (fast motion) -> trust measurement more (gain -> 0.95)
    // Small innovation (stable) -> trust prediction more (gain -> 0.5)
    const innovMag = Math.hypot(innovX, innovY);
    const gain = Math.min(0.95, Math.max(0.5, innovMag / 15));

    // Update position with blended estimate
    this.x = predictedX + gain * innovX;
    this.y = predictedY + gain * innovY;

    // Update velocity estimate (exponential moving average)
    const measuredVx = (measuredX - (this.x - this.vx * dt)) / dt;
    const measuredVy = (measuredY - (this.y - this.vy * dt)) / dt;
    const velGain = 0.6;
    this.vx = this.vx + velGain * (measuredVx - this.vx);
    this.vy = this.vy + velGain * (measuredVy - this.vy);

    return { x: this.x, y: this.y };
  }

  // Extrapolate position when measurement is missing (tracking lost)
  extrapolate(dt) {
    if (!this.initialized) return { x: this.x, y: this.y };
    // Decay velocity gradually during extrapolation
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

// ---- Main HandTracker Engine ----
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

    // Kalman Filters for key landmarks per hand (up to 2 hands × 21 landmarks)
    // We track ALL 21 landmarks with Kalman for maximum smoothness
    this.kalmanFilters = [
      Array.from({ length: 21 }, () => new KalmanPoint()),
      Array.from({ length: 21 }, () => new KalmanPoint())
    ];

    // Filtered landmarks output
    this.smoothedLandmarks = [];

    // ROI Box
    this.currentBox = {
      x: 0, y: 0, width: 0, height: 0, angle: 0,
      center: { x: 0, y: 0 },
      quad: [], p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 },
      isDetected: false, handCount: 0
    };

    this.lockedBox = null;

    // Grace period for tracking loss
    this.missedFrames = 0;
    this.maxGraceFrames = 20; // ~600ms at 30fps — very generous extrapolation window

    // RAF loop control
    this.rafId = null;
    this.onFrameCallback = null;
  }

  async init(videoElement, canvasElement) {
    this.videoEl = videoElement;
    this.canvasEl = canvasElement;

    // 1. Initialize MediaPipe Tasks Vision WASM runtime
    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );

    // 2. Create HandLandmarker with GPU delegate for maximum speed
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

    // 3. Start Webcam stream with getUserMedia (direct control, no Camera utils)
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 60, min: 30 }
      }
    });
    this.videoEl.srcObject = stream;
    await this.videoEl.play();
    this.isTracking = true;

    // 4. Start the requestAnimationFrame render loop
    this.startLoop();
  }

  startLoop() {
    const loop = () => {
      this.rafId = requestAnimationFrame(loop);

      if (!this.videoEl || this.videoEl.readyState < 2) return;

      const now = performance.now();

      // FPS Calculation
      const frameDelta = (now - this.lastFrameTime) / 1000;
      this.lastFrameTime = now;
      if (frameDelta > 0) {
        this.fps = Math.round(0.9 * this.fps + 0.1 * (1 / frameDelta));
      }

      // Deduplicate frames (skip if video hasn't advanced)
      const timestamp = this.videoEl.currentTime;
      if (timestamp === this.lastTimestamp) return;
      this.lastTimestamp = timestamp;

      // Run HandLandmarker inference (synchronous in VIDEO mode)
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
        // TRAJECTORY EXTRAPOLATION during tracking loss
        if (this.mode !== 'lock') {
          this.missedFrames++;
          if (this.missedFrames <= this.maxGraceFrames && this.smoothedLandmarks.length > 0) {
            // Extrapolate all landmarks along their velocity vectors
            this.extrapolateLandmarks(width, height, dt);
            this.computeFramingQuad(width, height);
            this.currentBox.isDetected = true;
          } else {
            this.currentBox.isDetected = false;
            // Reset Kalman filters after extended tracking loss
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
        // Clamp within canvas bounds
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
