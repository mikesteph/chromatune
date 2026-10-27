export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Tiny element builder: h('div.cls#id', {attrs/on*}, children)
export function h(spec, attrs = {}, ...children) {
  const [tag, ...rest] = spec.split(/(?=[.#])/);
  const el = document.createElement(tag || 'div');
  for (const r of rest) {
    if (r[0] === '.') el.classList.add(r.slice(1));
    else if (r[0] === '#') el.id = r.slice(1);
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function fmtTime(sec) {
  if (!isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtLong(sec) {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)} d ${h % 24} h`;
  return h ? `${h} h ${m} min` : `${m} min`;
}

export const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export class Emitter {
  constructor() { this._h = {}; }
  on(ev, fn) { (this._h[ev] ||= new Set()).add(fn); return () => this._h[ev].delete(fn); }
  emit(ev, ...a) { this._h[ev]?.forEach((fn) => fn(...a)); }
}

export const coverUrl = (key, small) => (key ? `ct://app/cover/${key}${small ? '_s' : ''}.jpg` : null);
export const mediaUrl = (path) => `ct://app/media?p=${encodeURIComponent(path)}`;

/* ---------- color math ---------- */
export function hexToRgb(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = (r, g, b) => '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
export const alpha = (hex, a) => { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; };
export function luminance(hex) {
  const c = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
export const readableOn = (bg) => (contrast(bg, '#ffffff') >= contrast(bg, '#111111') ? '#ffffff' : '#111111');

export function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}
export function hslToHex(h, s, l) {
  const f = (n) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return rgbToHex(f(0) * 255, f(8) * 255, f(4) * 255);
}

// Nudge a colour's lightness until it reaches the target contrast against bg.
export function ensureContrast(color, bg, target = 3) {
  let [h, s, l] = rgbToHsl(...hexToRgb(color));
  const dir = luminance(bg) > 0.4 ? -1 : 1;
  let out = color;
  for (let i = 0; i < 30 && contrast(out, bg) < target; i++) {
    l = clamp(l + dir * 0.03, 0, 1);
    out = hslToHex(h, s, l);
  }
  return out;
}
