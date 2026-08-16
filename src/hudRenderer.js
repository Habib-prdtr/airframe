/* ==========================================================================
   HUD RENDERER - SCI-FI OVERLAY & ROTATED FLEXIBLE QUAD TELEMETRY
   ========================================================================== */

export class HudRenderer {
  constructor() {
    this.hudTheme = 'cyan';
    
    this.themes = {
      cyan: { primary: '#00f3ff', glow: 'rgba(0, 243, 255, 0.4)', text: '#00f3ff' },
      magenta: { primary: '#ff0055', glow: 'rgba(255, 0, 85, 0.4)', text: '#ff0055' },
      lime: { primary: '#00ff66', glow: 'rgba(0, 255, 102, 0.4)', text: '#00ff66' },
      amber: { primary: '#ffaa00', glow: 'rgba(255, 170, 0, 0.4)', text: '#ffaa00' }
    };

    this.pulsePhase = 0;
  }

  setTheme(themeName) {
    if (this.themes[themeName]) {
      this.hudTheme = themeName;
    }
  }

  render(ctx, box, smoothedLandmarks = [], fps = 60) {
    this.pulsePhase += 0.08;
    const colors = this.themes[this.hudTheme] || this.themes.cyan;

    // 1. Draw Hand Skeleton Landmarks & Laser Lines
    this.drawLandmarks(ctx, smoothedLandmarks, colors);

    // 2. If Flexible Quad Box is detected, draw Rotated Sci-Fi Corners & Telemetry
    if (box && box.isDetected && box.quad) {
      this.drawFlexibleQuadBrackets(ctx, box, colors);
      this.drawTelemetry(ctx, box, fps, colors);
    }
  }

  drawLandmarks(ctx, smoothedLandmarks, colors) {
    if (!smoothedLandmarks || smoothedLandmarks.length === 0) return;

    ctx.save();

    smoothedLandmarks.forEach((hand) => {
      const connections = [
        [0, 1], [1, 2], [2, 3], [3, 4],     // Thumb
        [0, 5], [5, 6], [6, 7], [7, 8],     // Index
        [5, 9], [9, 10], [10, 11], [11, 12],// Middle
        [9, 13], [13, 14], [14, 15], [15, 16], // Ring
        [13, 17], [0, 17], [17, 18], [18, 19], [19, 20] // Pinky
      ];

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1.5;

      connections.forEach(([i, j]) => {
        if (hand[i] && hand[j]) {
          ctx.beginPath();
          ctx.moveTo(hand[i].x, hand[i].y);
          ctx.lineTo(hand[j].x, hand[j].y);
          ctx.stroke();
        }
      });

      const thumb = hand[4];  // Landmark #4
      const index = hand[8];  // Landmark #8

      if (thumb && index) {
        // Glowing Laser Connection Line
        ctx.strokeStyle = colors.primary;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = colors.primary;
        ctx.shadowBlur = 10;

        ctx.beginPath();
        ctx.setLineDash([6, 4]);
        ctx.moveTo(thumb.x, thumb.y);
        ctx.lineTo(index.x, index.y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Finger Tip Node Markers
        [thumb, index].forEach((pt) => {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 7 + Math.sin(this.pulsePhase) * 2, 0, Math.PI * 2);
          ctx.fillStyle = colors.primary;
          ctx.shadowBlur = 14;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 12, 0, Math.PI * 2);
          ctx.strokeStyle = colors.primary;
          ctx.lineWidth = 1;
          ctx.stroke();
        });
      }
    });

    ctx.restore();
  }

  drawFlexibleQuadBrackets(ctx, box, colors) {
    const quad = box.quad;
    if (!quad || quad.length < 4) return;

    const pulseGlow = 10 + Math.sin(this.pulsePhase * 2) * 5;

    ctx.save();

    // 1. Draw Outer Quad Border Frame
    ctx.strokeStyle = colors.glow;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(quad[0].x, quad[0].y);
    ctx.lineTo(quad[1].x, quad[1].y);
    ctx.lineTo(quad[2].x, quad[2].y);
    ctx.lineTo(quad[3].x, quad[3].y);
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);

    // 2. Draw Rotated Sci-Fi Corner Brackets at Each Quad Vertex
    ctx.strokeStyle = colors.primary;
    ctx.lineWidth = 3.5;
    ctx.shadowColor = colors.primary;
    ctx.shadowBlur = pulseGlow;

    for (let i = 0; i < 4; i++) {
      const pCurr = quad[i];
      const pPrev = quad[(i + 3) % 4];
      const pNext = quad[(i + 1) % 4];

      // Vector to previous vertex
      const vPrevX = pPrev.x - pCurr.x;
      const vPrevY = pPrev.y - pCurr.y;
      const lenPrev = Math.hypot(vPrevX, vPrevY) || 1;

      // Vector to next vertex
      const vNextX = pNext.x - pCurr.x;
      const vNextY = pNext.y - pCurr.y;
      const lenNext = Math.hypot(vNextX, vNextY) || 1;

      const armLen = Math.min(25, Math.min(lenPrev, lenNext) * 0.35);

      const armPrevX = pCurr.x + (vPrevX / lenPrev) * armLen;
      const armPrevY = pCurr.y + (vPrevY / lenPrev) * armLen;

      const armNextX = pCurr.x + (vNextX / lenNext) * armLen;
      const armNextY = pCurr.y + (vNextY / lenNext) * armLen;

      ctx.beginPath();
      ctx.moveTo(armPrevX, armPrevY);
      ctx.lineTo(pCurr.x, pCurr.y);
      ctx.lineTo(armNextX, armNextY);
      ctx.stroke();
    }

    // 3. Draw Center Crosshair Marker
    if (box.center) {
      const { x: cx, y: cy } = box.center;
      const chSize = 8;

      ctx.strokeStyle = colors.primary;
      ctx.lineWidth = 1;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.moveTo(cx - chSize, cy);
      ctx.lineTo(cx + chSize, cy);
      ctx.moveTo(cx, cy - chSize);
      ctx.lineTo(cx, cy + chSize);
      ctx.stroke();
    }

    ctx.restore();
  }

  drawTelemetry(ctx, box, fps, colors) {
    const quad = box.quad;
    if (!quad || !quad[0]) return;

    // Anchor telemetry text near top-left vertex of rotated quad
    const anchorX = quad[0].x;
    const anchorY = Math.max(25, quad[0].y - 12);

    const degAngle = Math.round((box.angle || 0) * (180 / Math.PI));

    ctx.save();
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillStyle = colors.text;
    ctx.shadowColor = colors.primary;
    ctx.shadowBlur = 8;

    const label = `FLEX QUAD [ROT:${degAngle}° | W:${box.width} H:${box.height}] • LOCKED`;
    ctx.fillText(label, anchorX, anchorY);

    ctx.restore();
  }
}
