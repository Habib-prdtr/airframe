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
    this.bindEvents();

    try {
      await this.enumerateCameras();
      
      // Camera-First Architecture: Open webcam stream immediately
      await this.tracker.init(this.videoEl, this.canvasEl);

      this.videoEl.addEventListener('loadedmetadata', () => this.syncCanvasAspect());
      this.videoEl.addEventListener('resize', () => this.syncCanvasAspect());
      this.syncCanvasAspect();

      this.tracker.onFrameCallback = (data) => this.onFrameUpdate(data);
      
      // Hide camera loading overlay immediately as soon as video starts!
      this.loadingOverlay.classList.add('hidden');
    } catch (err) {
      console.error('Gagal menginisialisasi kamera:', err);
      this.handleInitializationError(err);
    }
  }

  handleInitializationError(err) {
    let errorTitle = 'Gagal Mengakses Kamera';
    let errorMessage = 'Mohon pastikan webcam terhubung dan beri izin akses di browser.';

    const errName = err.name || '';

    if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
      errorTitle = '🔒 Izin Kamera Ditolak';
      errorMessage = 'Browser Anda memblokir izin kamera. Klik ikon 🔒 (Gembok) di samping nama situs/URL browser lalu ubah izin Kamera menjadi **Izinkan (Allow)**.';
    } else if (errName === 'NotReadableError' || errName === 'TrackStartError') {
      errorTitle = '⚠️ Kamera Sedang Digunakan';
      errorMessage = 'Kamera sedang dipakai oleh aplikasi lain (seperti Zoom, WhatsApp, Meet). Mohon tutup aplikasi tersebut lalu muat ulang.';
    } else if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
      errorTitle = '📷 Kamera Tidak Ditemukan';
      errorMessage = 'Perangkat kamera tidak terdeteksi pada HP/Komputer Anda.';
    }

    this.loadingOverlay.innerHTML = `
      <div style="text-align: center; max-width: 400px; padding: 20px;">
        <h3 style="color: #ff0055; font-size: 1.1rem; margin-bottom: 10px;">${errorTitle}</h3>
        <p style="color: #cbd5e1; font-size: 0.85rem; line-height: 1.5; margin-bottom: 16px;">${errorMessage}</p>
        <button id="btn-retry-camera" class="btn-cyber btn-primary" style="padding: 10px 20px;">
          🔄 Coba Lagi / Refresh Kamera
        </button>
      </div>
    `;

    document.getElementById('btn-retry-camera')?.addEventListener('click', () => {
      window.location.reload(true);
    });
  }

  syncCanvasAspect() {
    const vWidth = this.videoEl.videoWidth || 1280;
    const vHeight = this.videoEl.videoHeight || 720;

    if (this.canvasEl.width !== vWidth || this.canvasEl.height !== vHeight) {
      this.canvasEl.width = vWidth;
      this.canvasEl.height = vHeight;
      document.documentElement.style.setProperty('--cam-aspect', `${vWidth} / ${vHeight}`);
    }
  }

  async enumerateCameras() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices.filter(d => d.kind === 'videoinput');

    this.cameraSelectEl.innerHTML = '';
    videoDevices.forEach((device, i) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || (i === 0 ? 'Kamera Depan' : `Kamera ${i + 1}`);
      this.cameraSelectEl.appendChild(option);
    });
  }

  onFrameUpdate({ results, box, smoothedLandmarks, fps, handCount, aiLoaded }) {
    if (this.videoEl.videoWidth > 0 && this.canvasEl.width !== this.videoEl.videoWidth) {
      this.syncCanvasAspect();
    }

    this.fpsCounterEl.textContent = fps;

    if (!aiLoaded) {
      this.gestureStatusEl.textContent = 'MEMUAT AI TRACKER...';
      this.gestureStatusEl.className = 'value text-yellow';
      this.framingMetricsEl.textContent = '0 x 0 px';
    } else if (box && box.isDetected) {
      this.gestureStatusEl.textContent = handCount === 2 ? '2 TANGAN FRAME' : '1 TANGAN PINCH';
      this.gestureStatusEl.className = 'value text-cyan';
      this.framingMetricsEl.textContent = `${box.width} x ${box.height} px`;
    } else {
      this.gestureStatusEl.textContent = 'MENCARI TANGAN...';
      this.gestureStatusEl.className = 'value text-green';
      this.framingMetricsEl.textContent = '0 x 0 px';
    }

    this.effects.render(this.ctx, this.videoEl, box, this.isMirrored);
    this.hud.render(this.ctx, box, smoothedLandmarks, fps);
  }

  bindEvents() {
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

    document.getElementById('btn-flip-camera').addEventListener('click', () => {
      this.isMirrored = !this.isMirrored;
      this.tracker.setMirrored(this.isMirrored);
      this.sound.playClick();
    });

    this.cameraSelectEl.addEventListener('change', async () => {
      this.sound.playClick();
    });

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

    document.getElementById('btn-snapshot').addEventListener('click', () => this.takeSnapshot());
    document.getElementById('btn-record').addEventListener('click', () => this.toggleRecording());

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
