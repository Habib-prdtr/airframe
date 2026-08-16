/* ==========================================================================
   EFFECTS ENGINE - ULTRA-FAST ROI PIPELINE (60 FPS Motion Optimized)
   ========================================================================== */

export class EffectsEngine {
  constructor() {
    this.activeEffect = 'neon';
    this.intensity = 0.8;
    this.scaleSize = 12;

    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenCtx = this.offscreenCanvas.getContext('2d', { willReadFrequently: true });

    this.matrixColumns = [];
    this.matrixChars = '0123456789ABCDEFｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ';
    this.glitchTimer = 0;
    this.vortexAngle = 0;
  }

  setEffect(effectName) {
    this.activeEffect = effectName;
  }

  setParams({ intensity, scale }) {
    if (intensity !== undefined) this.intensity = intensity / 100;
    if (scale !== undefined) this.scaleSize = Math.max(4, scale);
  }

  render(ctx, video, box, isMirrored = true) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;

    // 1. Draw Base Video Frame with aspect-ratio cover (prevents gepeng/squished camera)
    const vWidth = video.videoWidth || width;
    const vHeight = video.videoHeight || height;
    const vAspect = vWidth / vHeight;
    const cAspect = width / height;

    let sx = 0, sy = 0, sw = vWidth, sh = vHeight;
    if (vAspect > cAspect) {
      sw = vHeight * cAspect;
      sx = (vWidth - sw) / 2;
    } else if (vAspect < cAspect) {
      sh = vWidth / cAspect;
      sy = (vHeight - sh) / 2;
    }

    ctx.save();
    if (isMirrored) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
    ctx.restore();

    // 2. Skip if no box detected
    if (!box || !box.isDetected || !box.quad || box.quad.length < 4) {
      return;
    }

    const rx = Math.max(0, Math.min(width - 10, box.x));
    const ry = Math.max(0, Math.min(height - 10, box.y));
    const rw = Math.min(width - rx, box.width);
    const rh = Math.min(height - ry, box.height);

    if (rw <= 10 || rh <= 10) return;

    // 3. Size Offscreen Canvas strictly to ROI dimensions for max performance
    if (this.offscreenCanvas.width !== rw || this.offscreenCanvas.height !== rh) {
      this.offscreenCanvas.width = rw;
      this.offscreenCanvas.height = rh;
    }

    // Copy ROI portion from main canvas onto offscreen canvas
    this.offscreenCtx.clearRect(0, 0, rw, rh);
    this.offscreenCtx.drawImage(ctx.canvas, rx, ry, rw, rh, 0, 0, rw, rh);

    // Render Filter Effect directly on ROI buffer (0, 0, rw, rh)
    switch (this.activeEffect) {
      case 'neon':
        this.applyNeonEffect(this.offscreenCtx, 0, 0, rw, rh);
        break;
      case 'pixelate':
        this.applyPixelateEffect(this.offscreenCtx, 0, 0, rw, rh);
        break;
      case 'thermal':
        this.applyThermalEffect(this.offscreenCtx, 0, 0, rw, rh);
        break;
      case 'glitch':
        this.applyGlitchEffect(this.offscreenCtx, 0, 0, rw, rh);
        break;
      case 'matrix':
        this.applyMatrixEffect(this.offscreenCtx, 0, 0, rw, rh);
        break;
      case 'ascii':
        this.applyAsciiEffect(this.offscreenCtx, 0, 0, rw, rh);
        break;
      case 'magnifier':
        this.applyMagnifierEffect(this.offscreenCtx, video, rx, ry, rw, rh, width, height, isMirrored);
        break;
      case 'vortex':
        this.applyVortexEffect(this.offscreenCtx, 0, 0, rw, rh);
        break;
      case 'invert':
        this.applyInvertEffect(this.offscreenCtx, 0, 0, rw, rh);
        break;
      default:
        this.applyNeonEffect(this.offscreenCtx, 0, 0, rw, rh);
    }

    // 4. Clip Main Canvas using 4-Corner Flexible Quad Polygon
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(box.quad[0].x, box.quad[0].y);
    ctx.lineTo(box.quad[1].x, box.quad[1].y);
    ctx.lineTo(box.quad[2].x, box.quad[2].y);
    ctx.lineTo(box.quad[3].x, box.quad[3].y);
    ctx.closePath();
    ctx.clip();

    // Draw processed ROI offscreen buffer into canvas at (rx, ry)
    ctx.drawImage(this.offscreenCanvas, rx, ry);
    ctx.restore();
  }

  // 1. Cyber Neon Effect
  applyNeonEffect(ctx, x, y, w, h) {
    const imgData = ctx.getImageData(x, y, w, h);
    const data = imgData.data;
    const factor = this.intensity;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = (r * 0.299 + g * 0.587 + b * 0.114);

      if (lum > 110) {
        data[i] = Math.min(255, r + 50 * factor);
        data[i + 1] = Math.min(255, 230 * factor);
        data[i + 2] = 255;
      } else {
        data[i] = Math.max(0, r * 0.3);
        data[i + 1] = Math.max(0, g * 0.5);
        data[i + 2] = Math.min(255, b * 1.5);
      }
    }

    ctx.putImageData(imgData, x, y);
  }

  // 2. 8-Bit Pixelate Effect
  applyPixelateEffect(ctx, x, y, w, h) {
    const pSize = Math.max(4, Math.round(this.scaleSize));
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');

    tempCanvas.width = Math.max(1, Math.floor(w / pSize));
    tempCanvas.height = Math.max(1, Math.floor(h / pSize));

    tempCtx.imageSmoothingEnabled = false;
    tempCtx.drawImage(ctx.canvas, x, y, w, h, 0, 0, tempCanvas.width, tempCanvas.height);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tempCanvas, 0, 0, tempCanvas.width, tempCanvas.height, x, y, w, h);
    ctx.imageSmoothingEnabled = true;
  }

  // 3. Thermal Heatmap Effect
  applyThermalEffect(ctx, x, y, w, h) {
    const imgData = ctx.getImageData(x, y, w, h);
    const data = imgData.data;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const val = (r + g + b) / 3;

      let tr, tg, tb;
      if (val < 64) {
        tr = 0; tg = val * 4; tb = 255;
      } else if (val < 128) {
        tr = 0; tg = 255; tb = 255 - (val - 64) * 4;
      } else if (val < 192) {
        tr = (val - 128) * 4; tg = 255; tb = 0;
      } else {
        tr = 255; tg = 255 - (val - 192) * 4; tb = (val - 192) * 4;
      }

      data[i] = tr * this.intensity + r * (1 - this.intensity);
      data[i + 1] = tg * this.intensity + g * (1 - this.intensity);
      data[i + 2] = tb * this.intensity + b * (1 - this.intensity);
    }

    ctx.putImageData(imgData, x, y);
  }

  // 4. RGB Glitch Effect
  applyGlitchEffect(ctx, x, y, w, h) {
    const imgData = ctx.getImageData(x, y, w, h);
    const copyData = new Uint8ClampedArray(imgData.data);
    const data = imgData.data;

    const offset = Math.round(10 * this.intensity);
    this.glitchTimer += 1;

    for (let py = 0; py < h; py++) {
      const lineShift = (Math.sin(py / 10 + this.glitchTimer * 0.2) > 0.8) ? Math.floor((Math.random() - 0.5) * 20) : 0;

      for (let px = 0; px < w; px++) {
        const i = (py * w + px) * 4;
        const rIndex = (py * w + Math.max(0, Math.min(w - 1, px + offset + lineShift))) * 4;
        const bIndex = (py * w + Math.max(0, Math.min(w - 1, px - offset))) * 4;

        data[i] = copyData[rIndex];
        data[i + 1] = copyData[i + 1];
        data[i + 2] = copyData[bIndex + 2];
      }
    }

    ctx.putImageData(imgData, x, y);
  }

  // 5. Matrix Code Rain Effect
  applyMatrixEffect(ctx, x, y, w, h) {
    ctx.fillStyle = `rgba(0, 20, 5, ${0.7 * this.intensity})`;
    ctx.fillRect(x, y, w, h);

    const fontSize = Math.max(10, Math.round(this.scaleSize));
    const columns = Math.floor(w / fontSize);

    if (this.matrixColumns.length !== columns) {
      this.matrixColumns = Array.from({ length: columns }, () => Math.floor(Math.random() * h / fontSize));
    }

    ctx.fillStyle = '#00ff66';
    ctx.font = `${fontSize}px monospace`;

    this.matrixColumns.forEach((cy, colIdx) => {
      const char = this.matrixChars.charAt(Math.floor(Math.random() * this.matrixChars.length));
      const cx = x + colIdx * fontSize;
      const cpy = y + cy * fontSize;

      ctx.fillText(char, cx, cpy);

      if (cpy > y + h && Math.random() > 0.95) {
        this.matrixColumns[colIdx] = 0;
      } else {
        this.matrixColumns[colIdx]++;
      }
    });
  }

  // 6. ASCII Art Effect
  applyAsciiEffect(ctx, x, y, w, h) {
    const charSize = Math.max(8, Math.round(this.scaleSize));
    const imgData = ctx.getImageData(x, y, w, h);
    const data = imgData.data;

    ctx.fillStyle = '#06090e';
    ctx.fillRect(x, y, w, h);

    const chars = ['@', '#', '$', '%', '*', '+', ';', ':', '.', ' '];
    ctx.font = `bold ${charSize}px monospace`;

    for (let py = 0; py < h; py += charSize) {
      for (let px = 0; px < w; px += charSize) {
        const idx = (py * w + px) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];

        const brightness = (r + g + b) / 3;
        const charIdx = Math.floor((1 - brightness / 255) * (chars.length - 1));
        const char = chars[charIdx];

        ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
        ctx.fillText(char, x + px, y + py + charSize);
      }
    }
  }

  // 7. Magnifier Fisheye Lens Effect
  applyMagnifierEffect(ctx, video, x, y, w, h, canvasWidth, canvasHeight, isMirrored) {
    const zoomFactor = 1.6;
    const zw = w / zoomFactor;
    const zh = h / zoomFactor;
    const zx = x + (w - zw) / 2;
    const zy = y + (h - zh) / 2;

    ctx.save();
    if (isMirrored) {
      ctx.translate(canvasWidth, 0);
      ctx.scale(-1, 1);
      const mx = canvasWidth - (x + w);
      const mzx = canvasWidth - (zx + zw);
      ctx.drawImage(video, mzx, zy, zw, zh, mx, y, w, h);
    } else {
      ctx.drawImage(video, zx, zy, zw, zh, x, y, w, h);
    }
    ctx.restore();
  }

  // 8. Vortex Spiral Effect
  applyVortexEffect(ctx, x, y, w, h) {
    const imgData = ctx.getImageData(x, y, w, h);
    const copyData = new Uint8ClampedArray(imgData.data);
    const data = imgData.data;

    const cx = w / 2;
    const cy = h / 2;
    const maxRadius = Math.sqrt(cx * cx + cy * cy);
    this.vortexAngle += 0.05;

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const dx = px - cx;
        const dy = py - cy;
        const radius = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) + (1 - radius / maxRadius) * 1.5 * this.intensity;

        const sx = Math.floor(cx + radius * Math.cos(angle));
        const sy = Math.floor(cy + radius * Math.sin(angle));

        const targetIndex = (py * w + px) * 4;
        if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
          const sourceIndex = (sy * w + sx) * 4;
          data[targetIndex] = copyData[sourceIndex];
          data[targetIndex + 1] = copyData[sourceIndex + 1];
          data[targetIndex + 2] = copyData[sourceIndex + 2];
        }
      }
    }

    ctx.putImageData(imgData, x, y);
  }

  // 9. Invert X-Ray Effect
  applyInvertEffect(ctx, x, y, w, h) {
    const imgData = ctx.getImageData(x, y, w, h);
    const data = imgData.data;

    for (let i = 0; i < data.length; i += 4) {
      data[i] = 255 - data[i];
      data[i + 1] = 255 - data[i + 1];
      data[i + 2] = 255 - data[i + 2];
    }

    ctx.putImageData(imgData, x, y);
  }
}
