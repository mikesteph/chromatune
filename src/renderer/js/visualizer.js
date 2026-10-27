// Canvas audio visualizer. Every mode draws exclusively with the active theme's spectrum colours.
import { engine } from './player.js';
import { vizPalette, currentTheme } from './themes.js';
import { hexToRgb, clamp } from './util.js';
import { state } from './store.js';

export const VIZ_MODES = [
  { id: 'prism', name: 'Prism Bars' },
  { id: 'radial', name: 'Radial Bloom' },
  { id: 'wave', name: 'Neon Oscilloscope' },
  { id: 'starburst', name: 'Starburst' },
  { id: 'aurora', name: 'Aurora' },
  { id: 'rings', name: 'Sonic Rings' },
  { id: 'horizon', name: 'Synth Horizon' },
  { id: 'led', name: 'LED Matrix' },
];

const BANDS = 128;
let lut = [];
let lutRgb = [];

function buildLut() {
  const pal = vizPalette().map(hexToRgb);
  lut = []; lutRgb = [];
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * (pal.length - 1);
    const a = pal[Math.floor(t)], b = pal[Math.min(pal.length - 1, Math.floor(t) + 1)], f = t - Math.floor(t);
    const c = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f].map(Math.round);
    lutRgb.push(c);
    lut.push(`rgb(${c[0]},${c[1]},${c[2]})`);
  }
}
window.addEventListener('themechange', buildLut);

const col = (t) => lut[clamp(Math.round(t * 255), 0, 255)] || '#fff';
const cola = (t, a) => { const c = lutRgb[clamp(Math.round(t * 255), 0, 255)] || [255, 255, 255]; return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
const bgRgb = () => hexToRgb(currentTheme()?.vizbg || '#000000');

// Shared spectrum analysis, computed once per animation frame no matter how many canvases draw.
const spec = { bands: new Float32Array(BANDS), peaks: new Float32Array(BANDS), bass: 0, mid: 0, treble: 0, energy: 0, beat: 0, avgBass: 0, frame: -1, wave: null };

function analyse(frame) {
  if (spec.frame === frame) return spec;
  spec.frame = frame;
  const data = engine.paused ? null : engine.frequency();
  const sens = state.settings.vizSensitivity || 1;
  const t = performance.now() / 1000;
  if (data) {
    const binHz = engine.sampleRate / 2 / data.length;
    const lo = Math.log(32), hi = Math.log(16000);
    for (let i = 0; i < BANDS; i++) {
      const f0 = Math.exp(lo + ((hi - lo) * i) / BANDS), f1 = Math.exp(lo + ((hi - lo) * (i + 1)) / BANDS);
      const b0 = Math.floor(f0 / binHz), b1 = Math.max(b0 + 1, Math.ceil(f1 / binHz));
      let m = 0;
      for (let b = b0; b < b1 && b < data.length; b++) if (data[b] > m) m = data[b];
      let v = (m / 255) ** 1.6 * sens * (1 + (i / BANDS) * 0.9);
      v = Math.min(1.05, v);
      const prev = spec.bands[i];
      spec.bands[i] = v > prev ? prev + (v - prev) * 0.7 : prev * 0.86 + v * 0.14;
    }
    spec.wave = engine.waveform();
  } else {
    for (let i = 0; i < BANDS; i++) {
      const idle = 0.035 + 0.025 * Math.sin(t * 1.4 + i * 0.25);
      spec.bands[i] = spec.bands[i] * 0.9 + idle * 0.1;
    }
    spec.wave = null;
  }
  const avg = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += spec.bands[i]; return s / (b - a); };
  spec.bass = avg(0, 14);
  spec.mid = avg(14, 70);
  spec.treble = avg(70, BANDS);
  spec.energy = avg(0, BANDS);
  spec.avgBass = spec.avgBass * 0.95 + spec.bass * 0.05;
  spec.beat = spec.bass > spec.avgBass * 1.25 && spec.bass > 0.28 ? 1 : spec.beat * 0.9;
  for (let i = 0; i < BANDS; i++) {
    spec.peaks[i] = spec.bands[i] > spec.peaks[i] ? spec.bands[i] : Math.max(0, spec.peaks[i] - 0.008);
  }
  return spec;
}

// Resample the 128 analysis bands down to n display bands.
function bandsN(n) {
  const out = new Float32Array(n), pk = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor((i * BANDS) / n), b = Math.max(a + 1, Math.floor(((i + 1) * BANDS) / n));
    let m = 0, p = 0;
    for (let j = a; j < b; j++) { m = Math.max(m, spec.bands[j]); p = Math.max(p, spec.peaks[j]); }
    out[i] = m; pk[i] = p;
  }
  return [out, pk];
}

export class Visualizer {
  constructor(canvas, { compact = false } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.compact = compact;
    this.mode = state.settings.vizMode;
    this.particles = [];
    this.stars = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random() }));
    this.cover = null;
    this.running = false;
    this.w = this.h = 0;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    if (!lut.length) buildLut();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.clear(1);
  }

  setCover(url) {
    if (!url) { this.cover = null; return; }
    const img = new Image();
    img.onload = () => { this.cover = img; };
    img.src = url;
  }

  setMode(m) { this.mode = m; this.particles = []; this.clear(1); }

  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      if (this.canvas.offsetParent !== null && !document.hidden) this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop() { this.running = false; cancelAnimationFrame(this.raf); }

  clear(a) {
    const [r, g, b] = bgRgb();
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = `rgba(${r},${g},${b},${a})`;
    this.ctx.fillRect(0, 0, this.w, this.h);
  }

  draw() {
    analyse(Math.floor(performance.now() / 8));
    const trails = state.settings.vizTrails;
    const fade = { prism: 0.55, radial: 0.35, wave: 0.28, starburst: 0.22, aurora: 0.4, rings: 0.3, horizon: 1, led: 1 }[this.mode] ?? 1;
    this.clear(trails ? fade : 1);
    const ctx = this.ctx;
    ctx.save();
    (this[this.mode] || this.prism).call(this, ctx, this.w, this.h);
    ctx.restore();
  }

  /* ---------- modes ---------- */
  prism(ctx, w, h) {
    const n = this.compact ? 36 : 72;
    const [b, pk] = bandsN(n);
    const half = w / 2, slot = half / n, bw = Math.max(1.5, slot * 0.62), mid = h / 2;
    ctx.shadowBlur = this.compact ? 6 : 14;
    for (let i = 0; i < n; i++) {
      const v = b[i], bh = Math.max(1.5, v * h * 0.46);
      const c = col(i / n);
      ctx.shadowColor = c;
      ctx.fillStyle = c;
      for (const dir of [-1, 1]) {
        const x = half + dir * (i * slot + slot / 2) - bw / 2;
        ctx.globalAlpha = 1;
        ctx.fillRect(x, mid - bh, bw, bh);
        ctx.globalAlpha = 0.35;
        ctx.fillRect(x, mid, bw, bh * 0.85);
        ctx.globalAlpha = 0.95;
        ctx.fillRect(x, mid - pk[i] * h * 0.46 - 4, bw, 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, cola(1, 0)); g.addColorStop(0.5, cola(0, 0.9)); g.addColorStop(1, cola(1, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, mid - 0.5, w, 1);
  }

  radial(ctx, w, h) {
    const n = this.compact ? 90 : 160;
    const [b] = bandsN(n / 2);
    const cx = w / 2, cy = h / 2, base = Math.min(w, h);
    const r0 = base * (this.compact ? 0.2 : 0.17) * (1 + spec.bass * 0.18);
    const rot = performance.now() / 9000;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.5, ((Math.PI * 2 * r0) / n) * 0.55);
    ctx.shadowBlur = this.compact ? 6 : 16;
    for (let i = 0; i < n; i++) {
      const k = i < n / 2 ? i : n - 1 - i;
      const v = b[k];
      const a = rot + (i / n) * Math.PI * 2 - Math.PI / 2;
      const len = 3 + v * base * (this.compact ? 0.26 : 0.3);
      const c = col(k / (n / 2));
      ctx.strokeStyle = c; ctx.shadowColor = c;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r0 + 4), cy + Math.sin(a) * (r0 + 4));
      ctx.lineTo(cx + Math.cos(a) * (r0 + 4 + len), cy + Math.sin(a) * (r0 + 4 + len));
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r0, 0, Math.PI * 2);
    ctx.clip();
    if (this.cover) {
      ctx.translate(cx, cy); ctx.rotate(rot * 3);
      ctx.drawImage(this.cover, -r0, -r0, r0 * 2, r0 * 2);
    } else {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r0);
      g.addColorStop(0, col(0.2)); g.addColorStop(1, col(0.8));
      ctx.fillStyle = g; ctx.fillRect(cx - r0, cy - r0, r0 * 2, r0 * 2);
    }
    ctx.restore();
    ctx.lineWidth = 2 + spec.beat * 3;
    ctx.strokeStyle = cola(0, 0.9);
    ctx.shadowColor = col(0); ctx.shadowBlur = 20;
    ctx.beginPath(); ctx.arc(cx, cy, r0 + 1, 0, Math.PI * 2); ctx.stroke();
  }

  wave(ctx, w, h) {
    const data = spec.wave;
    const mid = h / 2;
    const layers = [[0, 3.2, 0], [0.45, 2.2, 24], [0.85, 1.4, 48]];
    ctx.lineJoin = 'round';
    for (const [t, lw, shift] of layers) {
      ctx.strokeStyle = col(t); ctx.shadowColor = col(t); ctx.shadowBlur = this.compact ? 8 : 18; ctx.lineWidth = lw;
      ctx.beginPath();
      const steps = this.compact ? 160 : 420;
      for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * w;
        let v;
        if (data) {
          const idx = Math.floor((i / steps) * (data.length / 2)) + shift;
          v = (data[Math.min(data.length - 1, idx)] - 128) / 128;
        } else {
          v = Math.sin(i * 0.05 + performance.now() / 600 + shift) * 0.04;
        }
        const env = Math.sin((i / steps) * Math.PI);
        const y = mid + v * h * 0.42 * (state.settings.vizSensitivity || 1) * (0.4 + env * 0.6);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
  }

  starburst(ctx, w, h) {
    const cx = w / 2, cy = h / 2, maxR = Math.hypot(cx, cy);
    const emit = Math.floor((this.compact ? 3 : 8) * (0.3 + spec.energy * 3) + spec.beat * (this.compact ? 12 : 40));
    for (let i = 0; i < emit && this.particles.length < (this.compact ? 400 : 1400); i++) {
      const a = Math.random() * Math.PI * 2;
      this.particles.push({ a, d: Math.random() * 8, v: 0.4 + Math.random() * 1.6, c: Math.random(), s: 0.6 + Math.random() * 1.8 });
    }
    const boost = 1 + spec.bass * 5 + spec.beat * 5;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    const alive = [];
    for (const p of this.particles) {
      const d0 = p.d;
      p.v *= 1.025;
      p.d += p.v * boost * (0.5 + p.d / maxR);
      if (p.d > maxR) continue;
      alive.push(p);
      const x0 = cx + Math.cos(p.a) * d0, y0 = cy + Math.sin(p.a) * d0;
      const x1 = cx + Math.cos(p.a) * p.d, y1 = cy + Math.sin(p.a) * p.d;
      ctx.strokeStyle = cola(p.c, Math.min(1, 0.25 + p.d / maxR));
      ctx.lineWidth = p.s * (0.5 + p.d / maxR * 1.5);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    this.particles = alive;
    const r = Math.min(w, h) * (0.05 + spec.bass * 0.12);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.5);
    g.addColorStop(0, cola(0, 0.55)); g.addColorStop(0.4, cola(0.5, 0.18)); g.addColorStop(1, cola(1, 0));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(cx, cy, r * 2.5, 0, Math.PI * 2); ctx.fill();
  }

  aurora(ctx, w, h) {
    const t = performance.now() / 1000;
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.stars) {
      ctx.fillStyle = cola(s.z, 0.2 + 0.35 * Math.abs(Math.sin(t * s.z * 2 + s.x * 10)) * (0.3 + spec.treble * 2));
      ctx.fillRect(s.x * w, s.y * h * 0.7, 1.4, 1.4);
    }
    ctx.globalCompositeOperation = 'screen';
    const layers = this.compact ? 4 : 5;
    const [b] = bandsN(48);
    for (let k = 0; k < layers; k++) {
      const ct = k / (layers - 1);
      const baseY = h * (0.42 + k * 0.08);
      const amp = h * (0.22 + 0.05 * Math.sin(t * 0.4 + k));
      const g = ctx.createLinearGradient(0, baseY - amp - h * 0.12, 0, baseY + h * 0.22);
      g.addColorStop(0, cola(ct, 0));
      g.addColorStop(0.35, cola(ct, 0.42));
      g.addColorStop(0.7, cola(ct, 0.12));
      g.addColorStop(1, cola(ct, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      const steps = 72, pts = [];
      for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * w;
        // Smooth the spectrum across neighbours so the curtain ripples instead of spiking.
        const f = (i / steps) * 47, j = Math.floor(f);
        const band = (b[Math.max(0, j - 1)] + b[j] * 2 + b[Math.min(47, j + 1)]) / 4;
        const wave = Math.sin(i * 0.11 + t * (0.5 + k * 0.17) + k * 1.7) * h * 0.05 + Math.sin(i * 0.037 - t * 0.3 + k) * h * 0.06;
        pts.push([x, baseY + wave - band * amp - spec.bass * h * 0.04]);
      }
      ctx.moveTo(0, h);
      for (const [x, y] of pts) ctx.lineTo(x, y);
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = cola(ct, 0.55);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
  }

  rings(ctx, w, h) {
    const cx = w / 2, cy = h / 2, maxR = Math.min(w, h) * 0.47;
    const rings = this.compact ? 7 : 11;
    const [b] = bandsN(rings);
    const t = performance.now() / 1000;
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowBlur = this.compact ? 6 : 14;
    for (let k = 0; k < rings; k++) {
      const v = b[k];
      const base = ((k + 1) / (rings + 1)) * maxR;
      const c = col(k / (rings - 1));
      ctx.strokeStyle = c; ctx.shadowColor = c;
      ctx.lineWidth = 1 + v * (this.compact ? 4 : 7);
      ctx.beginPath();
      const lobes = 3 + (k % 5);
      for (let i = 0; i <= 120; i++) {
        const a = (i / 120) * Math.PI * 2;
        const r = base * (1 + v * 0.28 * Math.sin(a * lobes + t * (k % 2 ? 1.3 : -1.1))) + spec.beat * 4;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
  }

  horizon(ctx, w, h) {
    const t = performance.now() / 1000;
    const hy = h * 0.58;
    const [br, bg, bb] = bgRgb();
    const sky = ctx.createLinearGradient(0, 0, 0, hy);
    sky.addColorStop(0, `rgb(${br},${bg},${bb})`);
    sky.addColorStop(1, cola(0.35, 0.35));
    ctx.fillStyle = sky; ctx.fillRect(0, 0, w, hy);
    // sun
    const sr = Math.min(w, h) * (this.compact ? 0.24 : 0.22) * (1 + spec.bass * 0.08);
    const sun = ctx.createLinearGradient(0, hy - sr, 0, hy);
    sun.addColorStop(0, col(0.75)); sun.addColorStop(1, col(0.2));
    ctx.save();
    ctx.beginPath(); ctx.arc(w / 2, hy - sr * 0.15, sr, Math.PI, 0); ctx.closePath(); ctx.clip();
    ctx.fillStyle = sun; ctx.shadowColor = col(0.5); ctx.shadowBlur = 30;
    ctx.fillRect(w / 2 - sr, hy - sr * 1.2, sr * 2, sr * 1.2);
    ctx.fillStyle = `rgb(${br},${bg},${bb})`;
    for (let i = 0; i < 7; i++) {
      const y = hy - sr * 0.15 - i * sr * 0.13 - ((t * 12) % (sr * 0.13));
      ctx.fillRect(w / 2 - sr, y, sr * 2, 1 + (7 - i) * 0.9);
    }
    ctx.restore();
    // spectrum mountains
    const n = this.compact ? 48 : 96;
    const [b] = bandsN(n / 2);
    ctx.beginPath();
    ctx.moveTo(0, hy);
    for (let i = 0; i <= n; i++) {
      const k = Math.abs(i - n / 2) / (n / 2);
      const v = b[Math.min(n / 2 - 1, Math.floor((1 - k) * (n / 2)))] || 0;
      ctx.lineTo((i / n) * w, hy - v * h * 0.26 * (0.15 + 0.85 * k ** 1.4) - k * h * 0.03);
    }
    ctx.lineTo(w, hy);
    ctx.closePath();
    ctx.fillStyle = `rgba(${br},${bg},${bb},0.86)`;
    ctx.fill();
    ctx.strokeStyle = col(0); ctx.shadowColor = col(0); ctx.shadowBlur = 12; ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;
    // grid
    ctx.fillStyle = `rgb(${br},${bg},${bb})`;
    ctx.fillRect(0, hy, w, h - hy);
    ctx.strokeStyle = cola(0.55, 0.85); ctx.lineWidth = 1.2;
    ctx.shadowColor = col(0.55); ctx.shadowBlur = 8;
    const speed = (t * (0.6 + spec.energy * 3)) % 1;
    for (let i = 0; i < 14; i++) {
      const z = (i + 1 - speed) / 14;
      const y = hy + (h - hy) * z * z;
      ctx.globalAlpha = z;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (let i = -12; i <= 12; i++) {
      ctx.beginPath(); ctx.moveTo(w / 2 + i * w * 0.012, hy); ctx.lineTo(w / 2 + i * w * 0.16, h); ctx.stroke();
    }
  }

  led(ctx, w, h) {
    const cols = this.compact ? 28 : 56, rows = this.compact ? 14 : 26;
    const [b, pk] = bandsN(cols);
    const gx = 2, gy = 2;
    const cw = (w - gx * (cols + 1)) / cols, ch = (h - gy * (rows + 1)) / rows;
    for (let i = 0; i < cols; i++) {
      const lit = Math.round(b[i] * rows), peak = Math.min(rows - 1, Math.round(pk[i] * rows));
      for (let r = 0; r < rows; r++) {
        const x = gx + i * (cw + gx), y = h - gy - (r + 1) * (ch + gy) + gy;
        const on = r < lit;
        const isPeak = r === peak && peak > 0;
        ctx.fillStyle = on || isPeak ? col(r / (rows - 1)) : cola(r / (rows - 1), 0.07);
        ctx.shadowBlur = on && !this.compact ? 8 : 0;
        ctx.shadowColor = col(r / (rows - 1));
        ctx.fillRect(x, y, cw, ch);
      }
    }
  }
}
