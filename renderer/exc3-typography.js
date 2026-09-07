'use strict';
import * as THREE from './lib/three.module.js';

/**
 * Technical typography HUD layer for EXC3_CM3 motion graphics visualizer.
 * Renders high-DPI vector typography and diagnostic meters to a CanvasTexture.
 */
export class Exc3Typography {
  constructor(width = 2048, height = 1024) {
    this._width  = width;
    this._height = height;
    this._canvas = document.createElement('canvas');
    this._canvas.width  = width;
    this._canvas.height = height;
    this._ctx    = this._canvas.getContext('2d');

    this.texture = new THREE.CanvasTexture(this._canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    this._lastDraw = 0;
  }

  _formatTime(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const m = Math.floor(s / 60);
    const remS = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 100);
    return `${String(m).padStart(2, '0')}:${String(remS).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
  }

  _drawMeter(ctx, x, y, width, height, val, label, accentRgb = [255, 255, 255]) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.font = '700 18px "Courier New", monospace';
    ctx.fillText(label, x, y);

    const barX = x + 70;
    const barW = width - 130;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.30)';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, y - 13, barW, height);

    const clamped = Math.max(0, Math.min(1, val));
    const fillW = Math.max(0, Math.min(barW, barW * clamped));
    if (fillW > 3) {
      if (clamped > 0.80) {
        ctx.fillStyle = '#ffffff';
      } else {
        const r = Math.floor(accentRgb[0]);
        const g = Math.floor(accentRgb[1]);
        const b = Math.floor(accentRgb[2]);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.55 + clamped * 0.40})`;
      }
      ctx.fillRect(barX + 2, y - 11, Math.max(0, fillW - 4), height - 4);
    }

    ctx.fillStyle = clamped > 0.80 ? '#ffffff' : 'rgba(255, 255, 255, 0.80)';
    ctx.fillText(clamped.toFixed(2), barX + barW + 10, y);
  }

  update(time, telemetry, themeColorA = [1, 1, 1], themeColorB = [0.8, 0.8, 0.8]) {
    const ctx = this._ctx;
    const w = this._width;
    const h = this._height;

    ctx.clearRect(0, 0, w, h);

    const kick   = telemetry?.kick   || 0;
    const snare  = telemetry?.snare  || 0;
    const hihat  = telemetry?.hihat  || 0;
    const energy = telemetry?.energy || 0;
    const bpm    = telemetry?.bpm    || 120;
    const phase  = telemetry?.phase  || 0;
    const meta   = telemetry?.metadata || {};
    const title  = meta.title  || 'UNTITLED';
    const artist = meta.artist || 'AFTERIMAGE AUDIO';
    const elapsed= meta.elapsed|| 0;

    // ── 1. Tactical Frame & Corner Reticles ─────────────────────────
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 2;
    const pad = 48;

    // Corner brackets [ ]
    const bLen = 32;
    ctx.beginPath();
    ctx.moveTo(pad, pad + bLen); ctx.lineTo(pad, pad); ctx.lineTo(pad + bLen, pad);
    ctx.moveTo(w - pad - bLen, pad); ctx.lineTo(w - pad, pad); ctx.lineTo(w - pad, pad + bLen);
    ctx.moveTo(pad, h - pad - bLen); ctx.lineTo(pad, h - pad); ctx.lineTo(pad + bLen, h - pad);
    ctx.moveTo(w - pad - bLen, h - pad); ctx.lineTo(w - pad, h - pad); ctx.lineTo(w - pad, h - pad - bLen);
    ctx.stroke();

    // ── 2. Top Header & Coordinate Telemetry ──────────────────────
    ctx.font = '700 20px "Courier New", monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('EXC3 // KINETIC MOTION MATRIX [SYS.07]', pad + 44, pad + 24);

    ctx.font = '400 16px "Courier New", monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.fillText(`CLK: ${time.toFixed(2)}s  //  SAMPLE: 48000Hz  //  FFT: 2048  //  CH: STEREO`, pad + 44, pad + 50);

    const rightInfo = `BPM: ${bpm.toFixed(1)} // PH: ${phase.toFixed(2)}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(rightInfo, w - pad - ctx.measureText(rightInfo).width - 44, pad + 24);

    // ── 3. Prominent Title & Track Metadata ───────────────────────
    ctx.save();
    ctx.font = '900 68px "Arial Black", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.letterSpacing = '4px';

    // Bass-kick ghost echo on hard hits
    if (kick > 0.45) {
      ctx.fillStyle = `rgba(${Math.floor(themeColorB[0]*255)}, ${Math.floor(themeColorB[1]*255)}, ${Math.floor(themeColorB[2]*255)}, 0.45)`;
      ctx.fillText(title, pad + 44 + (kick * 8), h - pad - 120);
      ctx.fillStyle = '#ffffff';
    }
    ctx.fillText(title, pad + 44, h - pad - 120);

    ctx.font = '600 24px "Courier New", monospace';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.fillText(`// ARTIST: ${artist}`, pad + 46, h - pad - 80);
    ctx.restore();

    // ── 4. Rhythmic Phase Gauge & Timecode ─────────────────────────
    const tcStr = `TC: ${this._formatTime(elapsed)}`;
    ctx.font = '700 28px "Courier New", monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(tcStr, pad + 46, h - pad - 32);

    // Segmented Phase Bar
    const segCount = 16;
    const activeSegs = Math.floor(phase * segCount);
    let barStr = '[';
    for (let s = 0; s < segCount; s++) {
      barStr += s <= activeSegs ? '■' : '·';
    }
    barStr += ']';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.font = '600 22px "Courier New", monospace';
    ctx.fillText(barStr, pad + 320, h - pad - 32);

    // ── 5. Audio Telemetry Meters (Right Margin) ──────────────────
    const meterX = w - pad - 320;
    const meterY = h - pad - 120;
    const acc = [themeColorB[0] * 255, themeColorB[1] * 255, themeColorB[2] * 255];
    this._drawMeter(ctx, meterX, meterY,       260, 16, kick,   'KICK', acc);
    this._drawMeter(ctx, meterX, meterY + 28,  260, 16, snare,  'SNAR', acc);
    this._drawMeter(ctx, meterX, meterY + 56,  260, 16, hihat,  'HIHT', acc);
    this._drawMeter(ctx, meterX, meterY + 84,  260, 16, energy, 'NRGY', [255, 255, 255]);

    // ── 6. Central Crosshair & Reticles ───────────────────────────
    const cx = w * 0.5;
    const cy = h * 0.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 24, cy); ctx.lineTo(cx + 24, cy);
    ctx.moveTo(cx, cy - 24); ctx.lineTo(cx, cy + 24);
    ctx.stroke();

    this.texture.needsUpdate = true;
  }

  dispose() {
    this.texture.dispose();
  }
}

