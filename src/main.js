/* ==========================================================================
   MAIN APPLICATION ENTRY POINT - AR HAND FRAMING STUDIO
   ========================================================================== */

import { HandTracker } from './handTracker.js';
import { EffectsEngine } from './effectsEngine.js';
import { HudRenderer } from './hudRenderer.js';
import { SoundManager } from './soundManager.js';

class App {
  constructor() {
    // DOM Elements
    this.videoEl = document.getElementById('webcam-feed');
    this.canvasEl = document.getElementById('output-canvas');
    this.ctx = this.canvasEl.getContext('2d', { willReadFrequently: true });
    this.loadingOverlay = document.getElementById('camera-loading');

    // Telemetry Elements
    this.fpsCounterEl = document.getElementById('fps-counter');
    this.gestureStatusEl = document.getElementById('gesture-status');
    this.framingMetricsEl = document.getElementById('framing-metrics');

    // Controls & Modals
    this.cameraSelectEl = document.getElementById('camera-select');
    this.recIndicatorEl = document.getElementById('rec-indicator');
    this.recTimerEl = document.getElementById('rec-timer');
    this.recBtnTextEl = document.getElementById('rec-btn-text');

    // Instances
    this.tracker = new HandTracker();
    this.effects = new EffectsEngine();
    this.hud = new HudRenderer();
    this.sound = new SoundManager();

    // Mirror State
    this.isMirrored = true;

    // Video Recording State
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.isRecording = false;
    this.recStartTime = 0;
    this.recTimerInterval = null;
  }

  async init() {
    this.setupCanvasSize();
    window.addEventListener('resize', () => this.setupCanvasSize());

    this.bindEvents();

    try {
      await this.enumerateCameras();
      await this.tracker.init(this.videoEl, this.canvasEl);

      // Hide loading spinner on first frame
      this.tracker.onFrameCallback = (data) => this.onFrameUpdate(data);

      this.loadingOverlay.classList.add('hidden');
    } catch (err) {
      console.error('Gagal menginisialisasi kamera atau MediaPipe:', err);
      const msg = err.name === 'NotAllowedError' 
        ? 'Akses kamera ditolak. Mohon izinkan akses kamera di browser Anda.' 
        : `Gagal memuat AI / Kamera (${err.message || err}). Pastikan browser mendukung WebGL & kamera terhubung.`;
      this.loadingOverlay.querySelector('p').textContent = msg;
    }
  }

  setupCanvasSize() {
    this.canvasEl.width = 1280;
    this.canvasEl.height = 720;
  }

  async enumerateCameras() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');

    this.cameraSelectEl.innerHTML = '';
    videoDevices.forEach((device, i) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Kamera ${i + 1}`;
      this.cameraSelectEl.appendChild(option);
    });
  }

  onFrameUpdate({ results, box, smoothedLandmarks, fps, handCount }) {
    // 1. Update Telemetry UI Header
    this.fpsCounterEl.textContent = fps;

    if (box && box.isDetected) {
      this.gestureStatusEl.textContent = handCount === 2 ? '2 TANGAN FRAME' : '1 TANGAN PINCH';
      this.gestureStatusEl.className = 'value text-cyan';
      this.framingMetricsEl.textContent = `${box.width} x ${box.height} px`;
    } else {
      this.gestureStatusEl.textContent = 'MENCARI TANGAN...';
      this.gestureStatusEl.className = 'value text-yellow';
      this.framingMetricsEl.textContent = '0 x 0 px';
    }

    // 2. Render Base Video + Isolated Effect inside Finger Box
    this.effects.render(this.ctx, this.videoEl, box, this.isMirrored);

    // 3. Render Sci-Fi HUD Overlay
    this.hud.render(this.ctx, box, smoothedLandmarks, fps);
  }

  bindEvents() {
    // Mode Buttons (Single, Dual, Lock)
    document.querySelectorAll('.btn-mode').forEach(btn => {
      btn.addEventListener('click', (e) => {
        document.querySelectorAll('.btn-mode').forEach(b => b.classList.remove('active'));
        const target = e.currentTarget;
        target.classList.add('active');
        const mode = target.dataset.mode;
        this.tracker.setMode(mode);
        this.sound.playClick();
      });
    });

    // Effect Preset Cards
    document.querySelectorAll('.effect-card').forEach(card => {
      card.addEventListener('click', (e) => {
        document.querySelectorAll('.effect-card').forEach(c => c.classList.remove('active'));
        const target = e.currentTarget;
        target.classList.add('active');
        const effect = target.dataset.effect;
        this.effects.setEffect(effect);
        this.sound.playLock();
      });
    });

    // Sliders & Controls
    const intensitySlider = document.getElementById('param-intensity');
    const scaleSlider = document.getElementById('param-scale');
    const hudStyleSelect = document.getElementById('param-hud-style');

    intensitySlider.addEventListener('input', (e) => {
      document.getElementById('val-intensity').textContent = `${e.target.value}%`;
      this.effects.setParams({ intensity: Number(e.target.value) });
    });

    scaleSlider.addEventListener('input', (e) => {
      document.getElementById('val-scale').textContent = `${e.target.value}px`;
      this.effects.setParams({ scale: Number(e.target.value) });
    });

    hudStyleSelect.addEventListener('change', (e) => {
      const theme = e.target.value;
      const themeNames = { cyan: 'Neon Cyan', magenta: 'Cyber Magenta', lime: 'Matrix Lime', amber: 'Amber Sci-Fi' };
      document.getElementById('val-hud').textContent = themeNames[theme] || theme;
      this.hud.setTheme(theme);
      this.sound.playClick();
    });

    // Mirror Flip
    document.getElementById('btn-flip-camera').addEventListener('click', () => {
      this.isMirrored = !this.isMirrored;
      this.tracker.setMirrored(this.isMirrored);
      this.sound.playClick();
    });

    // Camera Switcher
    this.cameraSelectEl.addEventListener('change', async (e) => {
      const deviceId = e.target.value;
      this.sound.playClick();
      if (deviceId) {
        try {
          await this.tracker.startCamera(deviceId);
        } catch (err) {
          console.error('Gagal mengganti kamera:', err);
        }
      }
    });

    // Audio Toggle
    const audioBtn = document.getElementById('btn-toggle-audio');
    const iconAudioOn = document.getElementById('icon-audio-on');
    const iconAudioOff = document.getElementById('icon-audio-off');

    audioBtn.addEventListener('click', () => {
      const isEnabled = this.sound.toggleAudio();
      if (isEnabled) {
        iconAudioOn.classList.remove('hidden');
        iconAudioOff.classList.add('hidden');
        this.sound.playClick();
      } else {
        iconAudioOn.classList.add('hidden');
        iconAudioOff.classList.remove('hidden');
      }
    });

    // Snapshot Button
    document.getElementById('btn-snapshot').addEventListener('click', () => this.takeSnapshot());

    // Record Video Button
    document.getElementById('btn-record').addEventListener('click', () => this.toggleRecording());

    // Help Modal
    const modalHelp = document.getElementById('modal-help');
    document.getElementById('btn-help').addEventListener('click', () => {
      modalHelp.classList.remove('hidden');
      this.sound.playClick();
    });
    document.getElementById('btn-close-help').addEventListener('click', () => modalHelp.classList.add('hidden'));
    document.getElementById('btn-got-it').addEventListener('click', () => modalHelp.classList.add('hidden'));
  }

  takeSnapshot() {
    this.sound.playShutter();

    // Trigger visual flash feedback
    const flash = document.createElement('div');
    flash.style.position = 'fixed';
    flash.style.inset = '0';
    flash.style.backgroundColor = 'white';
    flash.style.opacity = '0.7';
    flash.style.zIndex = '999';
    flash.style.transition = 'opacity 0.3s ease-out';
    document.body.appendChild(flash);
    setTimeout(() => {
      flash.style.opacity = '0';
      setTimeout(() => flash.remove(), 300);
    }, 50);

    // Download snapshot PNG
    const dataUrl = this.canvasEl.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `AR-Framing-Snapshot-${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
  }

  toggleRecording() {
    if (this.isRecording) {
      this.stopRecording();
    } else {
      this.startRecording();
    }
  }

  startRecording() {
    try {
      const stream = this.canvasEl.captureStream(30);
      this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
    } catch (e) {
      const stream = this.canvasEl.captureStream(30);
      this.mediaRecorder = new MediaRecorder(stream);
    }

    this.recordedChunks = [];
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.recordedChunks.push(e.data);
    };

    this.mediaRecorder.onstop = () => {
      const blob = new Blob(this.recordedChunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `AR-Framing-Video-${Date.now()}.webm`;
      link.click();
    };

    this.mediaRecorder.start();
    this.isRecording = true;
    this.sound.playRecStart();

    // UI Recording State
    const recBtn = document.getElementById('btn-record');
    recBtn.classList.add('recording');
    this.recBtnTextEl.textContent = 'Stop';
    this.recIndicatorEl.classList.remove('hidden');

    this.recStartTime = Date.now();
    this.recTimerInterval = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - this.recStartTime) / 1000);
      const mins = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
      const secs = String(elapsedSec % 60).padStart(2, '0');
      this.recTimerEl.textContent = `${mins}:${secs}`;
    }, 1000);
  }

  stopRecording() {
    if (!this.isRecording) return;
    this.mediaRecorder.stop();
    this.isRecording = false;

    clearInterval(this.recTimerInterval);

    const recBtn = document.getElementById('btn-record');
    recBtn.classList.remove('recording');
    this.recBtnTextEl.textContent = 'Rekam';
    this.recIndicatorEl.classList.add('hidden');
  }
}

// Instantiate on DOM load
window.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  app.init();
});
