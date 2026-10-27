// Theme engine glue + the palette picker / per-sector customiser.
import { state, setSetting, bus } from './store.js';
import { THEMES, SECTORS, resolve, applyTheme, themeFromOmarchy } from './themes.js';
import { h, $$, esc, uid, rgbToHsl, hslToHex, ensureContrast, luminance } from './util.js';
import { icon } from './icons.js';
import { modal, prompt, toast, confirmDialog } from './ui.js';

let dynamicAccent = null;

export const allThemes = () => [
  ...(state.omarchy ? [themeFromOmarchy(state.omarchy)] : []),
  ...THEMES,
  ...(state.settings.customThemes || []),
];

export function activeTheme() {
  const s = state.settings;
  if (s.followOmarchy && state.omarchy) return themeFromOmarchy(state.omarchy);
  return allThemes().find((t) => t.id === s.themeId) || THEMES[0];
}

export function applyCurrentTheme(preview = null) {
  const theme = preview || activeTheme();
  const overrides = { ...(state.settings.themeOverrides?.[theme.id] || {}) };
  if (!preview && state.settings.dynamicAccent && dynamicAccent) {
    overrides.accent = ensureContrast(dynamicAccent, overrides.main || theme.bg, 3);
    overrides.viz1 = overrides.accent;
  }
  const r = applyTheme(theme, overrides);
  if (!preview && state.settings.lastBg !== r.main) setSetting('lastBg', r.main);
  return r;
}

// Pull the most vivid colour out of an album cover for the optional "accent from artwork" mode.
export function accentFromCover(url) {
  if (!url) { dynamicAccent = null; if (state.settings.dynamicAccent) applyCurrentTheme(); return; }
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = c.height = 40;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, 40, 40);
    const d = ctx.getImageData(0, 0, 40, 40).data;
    const buckets = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const [hh, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
      if (s < 0.25 || l < 0.15 || l > 0.85) continue;
      const k = Math.round(hh * 24);
      const b = buckets.get(k) || { n: 0, h: 0, s: 0, l: 0 };
      b.n += s; b.h += hh * s; b.s += s * s; b.l += l * s;
      buckets.set(k, b);
    }
    let best = null;
    for (const b of buckets.values()) if (!best || b.n > best.n) best = b;
    dynamicAccent = best ? hslToHex(best.h / best.n, Math.min(1, (best.s / best.n) * 1.1), Math.min(0.68, Math.max(0.45, best.l / best.n))) : null;
    if (state.settings.dynamicAccent) applyCurrentTheme();
  };
  img.src = url;
}

/* ---------- picker UI ---------- */
function mock(theme) {
  const r = resolve(theme, state.settings.themeOverrides?.[theme.id] || {});
  const line = (w, c, o = 1) => `<i style="width:${w}%;background:${c};opacity:${o}"></i>`;
  const bars = [0.5, 0.8, 0.65, 1, 0.75, 0.55, 0.85, 0.4].map((v, i) => `<b style="height:${v * 100}%;background:${r[`viz${(i % 6) + 1}`]}"></b>`).join('');
  return `<div class="mock" style="background:${r.main};border-color:${r.border}">
    <div class="m-title" style="background:${r.titlebar}"><span style="background:${r.accent}"></span></div>
    <div class="m-body">
      <div class="m-side" style="background:${r.sidebar}">${line(70, r.fg, 0.8)}${line(50, r.muted)}${line(60, r.accent)}${line(40, r.muted)}</div>
      <div class="m-art" style="background:${r.artists}">${line(60, r.muted)}${line(70, r.muted)}${line(50, r.muted)}</div>
      <div class="m-main">
        <div class="m-row">${line(60, r.fg, 0.7)}</div>
        <div class="m-row" style="background:${r.accent}33">${line(70, r.accent)}</div>
        <div class="m-row">${line(50, r.fg, 0.7)}</div>
        <div class="m-row">${line(65, r.muted)}</div>
      </div>
      <div class="m-np" style="background:${r.nowplaying}"><div class="m-cover" style="background:linear-gradient(135deg,${r.viz1},${r.viz3})"></div><div class="m-viz" style="background:${r.vizbg}">${bars}</div></div>
    </div>
    <div class="m-player" style="background:${r.player}"><span class="m-play" style="background:${r.accent}"></span><span class="m-prog" style="background:${r.border}"><em style="background:linear-gradient(90deg,${r.accent},${r.accent2})"></em></span></div>
  </div>`;
}

export function openThemePicker() {
  let previewTimer;
  const tabs = h('div.tabs');
  const content = h('div.tp-content');
  const tab = (id, label) => h('button.tab', { dataset: { tab: id }, text: label, onClick: () => show(id) });
  tabs.append(tab('themes', 'Themes'), tab('customize', 'Customize every sector'));

  const show = (id) => {
    $$('.tab', tabs).forEach((t) => t.classList.toggle('active', t.dataset.tab === id));
    content.innerHTML = '';
    content.append(id === 'themes' ? themesTab() : customizeTab());
  };

  const themesTab = () => {
    const wrap = h('div.tp-themes');
    const toggles = h('div.tp-toggles', {},
      state.omarchy ? toggle('Follow Omarchy system theme', 'Tracks your desktop theme live, switching whenever Omarchy does.', 'followOmarchy') : null,
      toggle('Accent from album art', 'Re-tints the accent and first spectrum colour to match the cover that’s playing.', 'dynamicAccent'));
    wrap.append(toggles);
    const groups = {};
    for (const t of allThemes()) (groups[t.group || 'Custom'] ||= []).push(t);
    for (const [g, list] of Object.entries(groups)) {
      wrap.append(h('div.tp-group', { text: g === 'Omarchy' ? 'Omarchy-inspired' : g === 'Live' ? 'Live from your desktop' : g }));
      const grid = h('div.tp-grid');
      for (const t of list) {
        const active = activeTheme().id === t.id;
        const card = h('div.tcard', { class: `tcard${active ? ' active' : ''}`, tabindex: '0', dataset: { id: t.id } });
        card.innerHTML = `${mock(t)}<div class="tc-foot"><span class="tc-name">${esc(t.name)}</span>${active ? `<span class="tc-check">${icon('check', 14)}</span>` : ''}</div>`;
        if (t.group === 'Custom') {
          const del = h('button.tc-del', { title: 'Delete theme', html: icon('trash', 13) });
          del.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (!(await confirmDialog('Delete theme', `Delete “${t.name}”?`))) return;
            setSetting('customThemes', state.settings.customThemes.filter((x) => x.id !== t.id));
            if (state.settings.themeId === t.id) setSetting('themeId', THEMES[0].id);
            applyCurrentTheme(); show('themes');
          });
          card.append(del);
        }
        card.addEventListener('click', () => choose(t));
        card.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(t); } });
        card.addEventListener('mouseenter', () => { clearTimeout(previewTimer); previewTimer = setTimeout(() => applyCurrentTheme(t), 140); });
        card.addEventListener('mouseleave', () => { clearTimeout(previewTimer); previewTimer = setTimeout(() => applyCurrentTheme(), 160); });
        grid.append(card);
      }
      wrap.append(grid);
    }
    return wrap;
  };

  const choose = (t) => {
    clearTimeout(previewTimer);
    if (t.id === 'omarchy-live') setSetting('followOmarchy', true);
    else { setSetting('followOmarchy', false); setSetting('themeId', t.id); }
    applyCurrentTheme();
    const scroll = content.querySelector('.tp-themes')?.scrollTop;
    show('themes');
    if (scroll != null) content.querySelector('.tp-themes').scrollTop = scroll;
    bus.emit('theme');
  };

  const toggle = (label, desc, key) => {
    const input = h('input', { type: 'checkbox', checked: !!state.settings[key] });
    input.addEventListener('change', () => { setSetting(key, input.checked); applyCurrentTheme(); show('themes'); });
    return h('label.tp-toggle', {}, h('span.switch', {}, input, h('span')), h('span.tt-text', {}, h('b', { text: label }), h('small', { text: desc })));
  };

  const customizeTab = () => {
    const theme = activeTheme();
    const r = applyCurrentTheme();
    const overrides = () => (state.settings.themeOverrides?.[theme.id] || {});
    const setOverride = (key, val) => {
      const all = { ...(state.settings.themeOverrides || {}) };
      const o = { ...(all[theme.id] || {}) };
      if (val == null) delete o[key]; else o[key] = val;
      all[theme.id] = o;
      setSetting('themeOverrides', all);
      applyCurrentTheme();
    };
    const wrap = h('div.tp-custom');
    wrap.append(h('p.muted.small', { html: `Editing <b>${esc(theme.name)}</b>. Every area of the player has its own colour — tweak any of them and the whole app updates live. Text contrast is corrected automatically if a background gets too light or dark.` }));
    let group = '';
    let grid;
    for (const s of SECTORS) {
      if (s.group !== group) {
        group = s.group;
        wrap.append(h('div.tp-group', { text: group }));
        grid = h('div.sector-grid');
        wrap.append(grid);
      }
      const val = r[s.key];
      const changed = s.key in overrides();
      const color = h('input.color', { type: 'color', value: val });
      const hex = h('input.hex', { value: val, spellcheck: 'false', maxlength: '7' });
      const reset = h('button.icon-btn.sm', { title: 'Reset to theme default', html: icon('refresh', 13), style: { visibility: changed ? 'visible' : 'hidden' } });
      color.addEventListener('input', () => { hex.value = color.value; setOverride(s.key, color.value); reset.style.visibility = 'visible'; });
      hex.addEventListener('change', () => { if (/^#[0-9a-f]{6}$/i.test(hex.value)) { color.value = hex.value; setOverride(s.key, hex.value.toLowerCase()); reset.style.visibility = 'visible'; } });
      reset.addEventListener('click', () => { setOverride(s.key, null); show('customize'); });
      grid.append(h('div.sector', { class: `sector${changed ? ' changed' : ''}` }, h('label.swatch', {}, color), h('span.s-label', { text: s.label }), hex, reset));
    }
    const actions = h('div.row-end.tp-actions', {},
      h('button.btn', { html: `${icon('refresh', 15)}<span>Reset all</span>`, onClick: () => {
        const all = { ...(state.settings.themeOverrides || {}) }; delete all[theme.id];
        setSetting('themeOverrides', all); applyCurrentTheme(); show('customize');
      } }),
      h('button.btn', { html: `${icon('upload', 15)}<span>Import</span>`, onClick: importTheme }),
      h('button.btn', { html: `${icon('download', 15)}<span>Copy JSON</span>`, onClick: () => {
        navigator.clipboard.writeText(JSON.stringify(bake(theme), null, 2)); toast('Theme JSON copied to clipboard', { icon: 'palette' });
      } }),
      h('button.btn.primary', { html: `${icon('plus', 15)}<span>Save as new theme</span>`, onClick: async () => {
        const name = await prompt('Save theme', { value: `${theme.name} (custom)`, ok: 'Save' });
        if (!name) return;
        const t = { ...bake(theme), id: `custom-${uid()}`, name, group: 'Custom' };
        setSetting('customThemes', [...(state.settings.customThemes || []), t]);
        const all = { ...(state.settings.themeOverrides || {}) }; delete all[theme.id];
        setSetting('themeOverrides', all);
        setSetting('followOmarchy', false);
        setSetting('themeId', t.id);
        applyCurrentTheme();
        toast(`Saved “${name}”`, { icon: 'palette' });
        show('themes');
      } }));
    wrap.append(actions);
    return wrap;
  };

  // A self-contained theme object with the current tweaks folded in.
  const bake = (theme) => {
    const { id, name, group, bg, bg2, bg3, fg, muted, accent, accent2, colors, sectors } = theme;
    return { id, name, group, bg, bg2, bg3, fg, muted, accent, accent2, colors, sectors: { ...(sectors || {}), ...(state.settings.themeOverrides?.[theme.id] || {}) } };
  };

  const importTheme = async () => {
    const text = await prompt('Import theme JSON', { placeholder: 'Paste a theme JSON here', ok: 'Import' });
    if (!text) return;
    try {
      const t = JSON.parse(text);
      for (const k of ['bg', 'fg', 'accent']) if (!/^#[0-9a-f]{6}$/i.test(t[k] || '')) throw new Error(`missing ${k}`);
      const dark = luminance(t.bg) < 0.4;
      const theme = {
        ...t, id: `custom-${uid()}`, name: t.name || 'Imported theme', group: 'Custom',
        bg2: t.bg2 || t.bg, bg3: t.bg3 || t.bg, muted: t.muted || (dark ? '#888888' : '#666666'), accent2: t.accent2 || t.accent,
        colors: { red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', orange: '#ff9e64', ...(t.colors || {}) },
      };
      setSetting('customThemes', [...(state.settings.customThemes || []), theme]);
      setSetting('themeId', theme.id);
      setSetting('followOmarchy', false);
      applyCurrentTheme();
      show('themes');
      toast(`Imported “${theme.name}”`, { icon: 'palette' });
    } catch (e) {
      toast(`That doesn't look like a theme (${e.message})`, { icon: 'x', kind: 'warn' });
    }
  };

  const body = h('div.theme-picker', {}, tabs, content);
  modal({ title: 'Color palette', body, wide: true, className: 'tp-modal', onClose: () => { clearTimeout(previewTimer); applyCurrentTheme(); } });
  show('themes');
}

// Keyboard: cycle through themes without opening the picker.
export function cycleTheme(d) {
  const list = allThemes().filter((t) => t.id !== 'omarchy-live');
  const i = list.findIndex((t) => t.id === activeTheme().id);
  const next = list[(i + d + list.length) % list.length];
  setSetting('followOmarchy', false);
  setSetting('themeId', next.id);
  applyCurrentTheme();
  toast(`Theme: ${next.name}`, { icon: 'palette', timeout: 1400 });
}

