/* ==========================================================================
   EFFECTS ENGINE v4.0 — MOBILE WEBKIT SAFE HARDWARE ACCELERATION
   ========================================================================== */

export class EffectsEngine {
  constructor() {
    this.activeEffect = 'neon';
    this.intensity = 0.8;
    this.scaleSize = 12;

    this.bufferCanvas = document.createElement('canvas');
    this.bufferCtx = this.bufferCanvas.getContext('2d');

    this.matrixColumns = [];
    this.matrixChars = '0123456789ABCDEFｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ';
    this.glitchFrame = 0;

    // Mobile WebKit Detection
    this.isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
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

    // 1. Unconditional Base Video Draw (60 FPS Smooth Camera Feed)
    ctx.save();
    if (isMirrored) {
      ctx.translate(width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, width, height);
    ctx.restore();

    // 2. Skip if no ROI box detected
    if (!box || !box.isDetected || !box.quad || box.quad.length < 4) {
      return;
    }

    const rx = Math.max(0, Math.min(width - 10, box.x));
    const ry = Math.max(0, Math.min(height - 10, box.y));
    const rw = Math.min(width - rx, box.width);
    const rh = Math.min(height - ry, box.height);

    if (rw <= 10 || rh <= 10) return;

    // 3. Apply Canvas Polygon Clip Path for 4-Corner Flexible Quad
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(box.quad[0].x, box.quad[0].y);
    ctx.lineTo(box.quad[1].x, box.quad[1].y);
    ctx.lineTo(box.quad[2].x, box.quad[2].y);
    ctx.lineTo(box.quad[3].x, box.quad[3].y);
    ctx.closePath();
    ctx.clip();

    // 4. Render Mobile-Safe Effect Inside Quad
    switch (this.activeEffect) {
      case 'neon':
        this.renderNeon(ctx, video, rx, ry, rw, rh, width, height, isMirrored);
        break;
      case 'pixelate':
        this.renderPixelate(ctx, rx, ry, rw, rh);
        break;
      case 'thermal':
        this.renderThermal(ctx, video, rx, ry, rw, rh, width, height, isMirrored);
        break;
      case 'glitch':
        this.renderGlitch(ctx, rx, ry, rw, rh);
        break;
      case 'matrix':
        this.renderMatrix(ctx, rx, ry, rw, rh);
        break;
      case 'ascii':
        this.renderAscii(ctx, rx, ry, rw, rh);
        break;
      case 'magnifier':
        this.renderMagnifier(ctx, video, rx, ry, rw, rh, width, height, isMirrored);
        break;
      case 'vortex':
        this.renderVortex(ctx, video, rx, ry, rw, rh, width, height, isMirrored);
        break;
      case 'invert':
        this.renderInvert(ctx, video, rx, ry, rw, rh, width, height, isMirrored);
        break;
      default:
        this.renderNeon(ctx, video, rx, ry, rw, rh, width, height, isMirrored);
    }

    ctx.restore();
  }

  // 1. Cyber Neon Effect (Mobile WebKit Safe)
  renderNeon(ctx, video, x, y, w, h, canvasWidth, canvasHeight, isMirrored) {
    ctx.save();
    if (!this.isMobile && ctx.filter) {
      ctx.filter = `contrast(180%) saturate(300%) hue-rotate(170deg)`;
      this.drawSourceRegion(ctx, video, x, y, w, h, canvasWidth, canvasHeight, isMirrored);
    } else {
      // Mobile-fast composite tint
      this.drawSourceRegion(ctx, video, x, y, w, h, canvasWidth, canvasHeight, isMirrored);
      ctx.globalCompositeOperation = 'color-dodge';
      ctx.fillStyle = 'rgba(0, 243, 255, 0.6)';
      ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
  }

  // 2. 8-Bit Pixelate Effect (Zero-CPU Fast Blit)
  renderPixelate(ctx, x, y, w, h) {
    const pSize = Math.max(4, Math.round(this.scaleSize));
    const smallW = Math.max(1, Math.floor(w / pSize));
    const smallH = Math.max(1, Math.floor(h / pSize));

    if (this.bufferCanvas.width !== smallW || this.bufferCanvas.height !== smallH) {
      this.bufferCanvas.width = smallW;
      this.bufferCanvas.height = smallH;
    }

    this.bufferCtx.imageSmoothingEnabled = false;
    this.bufferCtx.drawImage(ctx.canvas, x, y, w, h, 0, 0, smallW, smallH);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.bufferCanvas, 0, 0, smallW, smallH, x, y, w, h);
    ctx.imageSmoothingEnabled = true;
  }

  // 3. Thermal Heatmap Effect (Mobile WebKit Safe)
  renderThermal(ctx, video, x, y, w, h, canvasWidth, canvasHeight, isMirrored) {
    ctx.save();
    if (!this.isMobile && ctx.filter) {
      ctx.filter = `invert(90%) hue-rotate(220deg) contrast(200%)`;
      this.drawSourceRegion(ctx, video, x, y, w, h, canvasWidth, canvasHeight, isMirrored);
    } else {
      // Mobile-fast composite thermal simulation
      this.drawSourceRegion(ctx, video, x, y, w, h, canvasWidth, canvasHeight, isMirrored);
      ctx.globalCompositeOperation = 'difference';
      ctx.fillStyle = '#00ffff';
      ctx.fillRect(x, y, w, h);
      ctx.globalCompositeOperation = 'overlay';
      ctx.fillStyle = '#ffb700';
      ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
  }

  // 4. RGB Glitch Effect
  renderGlitch(ctx, x, y, w, h) {
    this.glitchFrame += 1;
    const offset = Math.round(8 * this.intensity);

    if (this.bufferCanvas.width !== w || this.bufferCanvas.height !== h) {
      this.bufferCanvas.width = w;
      this.bufferCanvas.height = h;
    }

    this.bufferCtx.drawImage(ctx.canvas, x, y, w, h, 0, 0, w, h);

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(this.bufferCanvas, x + offset, y, w, h);
    ctx.drawImage(this.bufferCanvas, x - offset, y, w, h);
    ctx.restore();
  }

  // 5. Matrix Code Rain
  renderMatrix(ctx, x, y, w, h) {
    ctx.save();
    ctx.fillStyle = `rgba(0, 20, 5, ${0.75 * this.intensity})`;
    ctx.fillRect(x, y, w, h);

    const fontSize = Math.max(10, Math.round(this.scaleSize));
    const columns = Math.floor(w / fontSize);

    if (this.matrixColumns.length !== columns) {
      this.matrixColumns = Array.from({ length: columns }, () => Math.floor(Math.random() * h / fontSize));
    }

    ctx.fillStyle = '#00ff66';
    ctx.font = `bold ${fontSize}px monospace`;

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

    ctx.restore();
  }

  // 6. ASCII Code Filter
  renderAscii(ctx, x, y, w, h) {
    ctx.save();
    ctx.fillStyle = '#040810';
    ctx.fillRect(x, y, w, h);

    const charSize = Math.max(10, Math.round(this.scaleSize));
    ctx.font = `bold ${charSize}px monospace`;
    ctx.fillStyle = '#00f3ff';

    const chars = ['@', '#', '$', '%', '*', '+', ';', ':', '.', ' '];

    for (let py = 0; py < h; py += charSize) {
      for (let px = 0; px < w; px += charSize) {
        const charIdx = Math.floor(Math.random() * (chars.length - 2));
        ctx.fillText(chars[charIdx], x + px, y + py + charSize);
      }
    }
    ctx.restore();
  }

  // 7. Magnifier Fisheye Lens
  renderMagnifier(ctx, video, x, y, w, h, canvasWidth, canvasHeight, isMirrored) {
    const zoom = 1.6;
    const zw = w / zoom;
    const zh = h / zoom;
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

  // 8. Vortex Spiral
  renderVortex(ctx, video, x, y, w, h, canvasWidth, canvasHeight, isMirrored) {
    ctx.save();
    if (!this.isMobile && ctx.filter) {
      ctx.filter = `hue-rotate(280deg) contrast(180%)`;
      this.drawSourceRegion(ctx, video, x, y, w, h, canvasWidth, canvasHeight, isMirrored);
    } else {
      this.drawSourceRegion(ctx, video, x, y, w, h, canvasWidth, canvasHeight, isMirrored);
      ctx.globalCompositeOperation = 'exclusion';
      ctx.fillStyle = '#ff0055';
      ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
  }

  // 9. Invert X-Ray
  renderInvert(ctx, video, x, y, w, h, canvasWidth, canvasHeight, isMirrored) {
    ctx.save();
    if (!this.isMobile && ctx.filter) {
      ctx.filter = `invert(100%) contrast(160%)`;
      this.drawSourceRegion(ctx, video, x, y, w, h, canvasWidth, canvasHeight, isMirrored);
    } else {
      this.drawSourceRegion(ctx, video, x, y, w, h, canvasWidth, canvasHeight, isMirrored);
      ctx.globalCompositeOperation = 'difference';
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x, y, w, h);
    }
    ctx.restore();
  }

  drawSourceRegion(ctx, video, x, y, w, h, canvasWidth, canvasHeight, isMirrored) {
    if (isMirrored) {
      ctx.save();
      ctx.translate(canvasWidth, 0);
      ctx.scale(-1, 1);
      const mx = canvasWidth - (x + w);
      ctx.drawImage(video, mx, y, w, h, mx, y, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(video, x, y, w, h, x, y, w, h);
    }
  }
}
