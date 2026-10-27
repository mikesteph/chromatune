// Right panel (cover, track info, visualizer, up next) and the fullscreen visualizer.
import { state, bus, setView, setSetting, artistName, albumKey, patchTrack } from './store.js';
import { queue, engine } from './player.js';
import { Visualizer, VIZ_MODES } from './visualizer.js';
import { h, $, esc, fmtTime, coverUrl } from './util.js';
import { icon } from './icons.js';
import { showMenu } from './ui.js';
import { trackMenu } from './actions.js';

let panel, panelViz, fullViz, fullEl, coverEl;

export function initNowPlaying() {
  panel = $('#nowplaying');
  coverEl = h('div.np-cover');
  const info = h('div.np-info');
  const vizCanvas = h('canvas.np-viz');
  const vizBar = h('div.viz-bar', {},
    h('button.icon-btn.sm', { title: 'Previous visualizer', html: icon('chevronLeft', 15), onClick: () => cycleMode(-1) }),
    h('button.viz-name', { onClick: (e) => modeMenu(e) }),
    h('button.icon-btn.sm', { title: 'Next visualizer', html: icon('chevronRight', 15), onClick: () => cycleMode(1) }),
    h('span.grow'),
    h('button.icon-btn.sm', { title: 'Random visualizer', html: icon('dice', 15), onClick: () => setMode(VIZ_MODES[Math.floor(Math.random() * VIZ_MODES.length)].id) }),
    h('button.icon-btn.sm', { title: 'Fullscreen visualizer (V)', html: icon('expand', 15), onClick: () => openFullViz() }));
  const vizWrap = h('div.np-viz-wrap', { style: state.settings.vizHeight ? { height: `${state.settings.vizHeight}px` } : {} }, vizCanvas, vizBar);
  const vizResize = h('div.np-viz-resize', { title: 'Drag to resize · double-click to reset' });
  vizResize.addEventListener('dblclick', () => { vizWrap.style.height = ''; setSetting('vizHeight', null); });
  vizResize.addEventListener('mousedown', (e) => {
    const startY = e.clientY, startH = vizWrap.offsetHeight;
    const move = (ev) => { vizWrap.style.height = `${Math.max(90, Math.min(520, startH + ev.clientY - startY))}px`; };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); setSetting('vizHeight', vizWrap.offsetHeight); };
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  });
  const upNext = h('div.np-queue');
  panel.append(h('div.np-scroll', {}, coverEl, info, vizWrap, vizResize, h('div.np-q-head', {},
    h('span', { text: 'Up next' }),
    h('span.np-q-ctx'),
    h('button.link-btn', { text: 'Clear', onClick: () => queue.clearUpNext() })), upNext));

  panelViz = new Visualizer(vizCanvas, { compact: true });
  panelViz.start();

  fullEl = $('#viz-full');
  const fullCanvas = h('canvas');
  fullEl.append(fullCanvas, h('div.vf-overlay', {},
    h('div.vf-track'),
    h('div.vf-controls', {},
      h('button.icon-btn', { html: icon('chevronLeft', 20), onClick: () => cycleMode(-1) }),
      h('span.vf-mode'),
      h('button.icon-btn', { html: icon('chevronRight', 20), onClick: () => cycleMode(1) }),
      h('button.icon-btn', { title: 'Close (Esc)', html: icon('x', 20), onClick: closeFullViz }))));
  fullViz = new Visualizer(fullCanvas);
  let idle;
  fullEl.addEventListener('mousemove', () => { fullEl.classList.add('ui'); clearTimeout(idle); idle = setTimeout(() => fullEl.classList.remove('ui'), 2200); });
  fullEl.addEventListener('dblclick', closeFullViz);

  queue.on('track', renderTrack);
  queue.on('change', renderQueue);
  bus.on('track', (id) => { if (id === queue.current) renderTrack(); });
  bus.on('library', () => { renderTrack(); renderQueue(); });
  bus.on('setting', (k) => {
    if (k === 'vizMode') { panelViz.setMode(state.settings.vizMode); fullViz.setMode(state.settings.vizMode); syncModeLabels(); }
    if (k === 'shuffle') renderQueue();
  });
  engine.on('play', () => panel.classList.add('is-playing'));
  engine.on('pause', () => panel.classList.remove('is-playing'));
  renderTrack();
  renderQueue();
  syncModeLabels();
}

function renderTrack() {
  const t = queue.track;
  const info = panel.querySelector('.np-info');
  coverEl.innerHTML = '';
  if (!t) {
    coverEl.append(h('div.np-cover-ph', { html: icon('music', 64) }));
    info.innerHTML = `<div class="np-title muted">Nothing playing</div><div class="np-artist muted">Double-click a song, or hit Shuffle</div>`;
    panelViz.setCover(null); fullViz.setCover(null);
    fullEl.querySelector('.vf-track').innerHTML = '';
    return;
  }
  const url = coverUrl(t.cover);
  coverEl.append(url ? h('img', { src: url, draggable: 'false' }) : h('div.np-cover-ph', { html: icon('disc', 72) }));
  panelViz.setCover(url); fullViz.setCover(url);
  const quality = [t.codec && String(t.codec).split(' ')[0].toUpperCase(), t.bits ? `${t.bits}-bit` : '', t.sampleRate ? `${(t.sampleRate / 1000).toFixed(t.sampleRate % 1000 ? 1 : 0)} kHz` : '', !t.lossless && t.bitrate ? `${Math.round(t.bitrate / 1000)} kbps` : ''].filter(Boolean).join(' · ');
  info.innerHTML = '';
  info.append(
    h('div.np-title-row', {},
      h('div.np-title', { text: t.title, title: t.title }),
      h('button.like', { class: `like${t.liked ? ' on' : ''}`, title: t.liked ? 'Unlike' : 'Like', html: icon(t.liked ? 'heartFill' : 'heart', 19), onClick: () => patchTrack(t.id, { liked: !t.liked }) })),
    h('a.np-artist.link', { text: t.artist, onClick: () => setView({ type: 'artist', id: artistName(t) }) }),
    h('a.np-album.link', { text: `${t.album}${t.year ? ` · ${t.year}` : ''}`, onClick: () => setView({ type: 'album', id: albumKey(t) }) }),
    h('div.np-tags', {}, quality ? h('span.badge', { text: quality }) : null, t.genre ? h('span.badge.soft', { text: t.genre }) : null, t.plays ? h('span.badge.soft', { text: `${t.plays} plays` }) : null));
  coverEl.oncontextmenu = (e) => trackMenu(e, [t.id]);
  fullEl.querySelector('.vf-track').innerHTML = `${url ? `<img src="${url}">` : ''}<div><div class="vf-title">${esc(t.title)}</div><div class="vf-artist">${esc(t.artist)} — ${esc(t.album)}</div></div>`;
}

function renderQueue() {
  const el = panel.querySelector('.np-queue');
  const items = queue.peek(40);
  panel.querySelector('.np-q-ctx').textContent = queue.current ? `from ${queue.context.label}${state.settings.shuffle ? ' · shuffled' : ''}` : '';
  el.innerHTML = '';
  if (!items.length) { el.append(h('div.np-q-empty', { text: queue.current ? 'End of queue' : 'Your queue is empty' })); return; }
  for (const { id, manual } of items) {
    const t = state.tracks.get(id);
    const row = h('div.q-row', { class: `q-row${manual ? ' manual' : ''}`, title: `${t.title} — ${t.artist}` },
      t.cover ? h('img', { src: coverUrl(t.cover, true), loading: 'lazy', draggable: 'false' }) : h('span.q-ph', { html: icon('music', 12) }),
      h('div.q-text', {}, h('div.q-title', { text: t.title }), h('div.q-artist', { text: t.artist })),
      h('span.q-time', { text: fmtTime(t.duration) }));
    row.addEventListener('dblclick', () => queue.jumpTo(id));
    row.addEventListener('click', () => queue.jumpTo(id));
    row.addEventListener('contextmenu', (e) => trackMenu(e, [id]));
    el.append(row);
  }
}

/* ---------- visualizer modes ---------- */
const setMode = (id) => setSetting('vizMode', id);
function cycleMode(d) {
  const i = VIZ_MODES.findIndex((m) => m.id === state.settings.vizMode);
  setMode(VIZ_MODES[(i + d + VIZ_MODES.length) % VIZ_MODES.length].id);
}
export const nextVizMode = () => cycleMode(1);
function syncModeLabels() {
  const name = VIZ_MODES.find((m) => m.id === state.settings.vizMode)?.name || VIZ_MODES[0].name;
  panel.querySelector('.viz-name').textContent = name;
  fullEl.querySelector('.vf-mode').textContent = name;
}
function modeMenu(e) {
  const r = e.currentTarget.getBoundingClientRect();
  showMenu(r.left, r.bottom + 4, VIZ_MODES.map((m) => ({ label: m.name, checked: m.id === state.settings.vizMode, action: () => setMode(m.id) })));
}

export function openFullViz() {
  fullEl.hidden = false;
  fullEl.classList.add('ui');
  panelViz.stop();
  fullViz.resize();
  fullViz.start();
  window.api.win.fullscreen(true);
  setTimeout(() => fullEl.classList.remove('ui'), 2500);
}
export function closeFullViz() {
  if (fullEl.hidden) return;
  fullEl.hidden = true;
  fullViz.stop();
  panelViz.start();
  window.api.win.fullscreen(false);
}
export const fullVizOpen = () => !fullEl.hidden;
