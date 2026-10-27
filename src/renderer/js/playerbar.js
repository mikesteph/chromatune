// Bottom transport bar: track, controls, seek, volume, EQ.
import { state, bus, setView, setSetting, artistName, albumKey, patchTrack } from './store.js';
import { queue, engine, EQ_FREQS, EQ_PRESETS } from './player.js';
import { h, $, fmtTime, coverUrl } from './util.js';
import { icon } from './icons.js';
import { modal } from './ui.js';
import { openFullViz } from './nowplaying.js';
import { revealPlaying } from './views.js';

let bar, seek, seekFill, seekKnob, seekHover, tCur, tDur, playBtn, shuffleBtn, repeatBtn, volBtn, vol, likeBtn, dragging = false;

export function initPlayerBar() {
  bar = $('#playerbar');
  const left = h('div.pb-left', {},
    h('div.pb-cover', { title: 'Show playing song', onClick: revealPlaying }),
    h('div.pb-meta', {}, h('div.pb-title'), h('div.pb-artist')),
    (likeBtn = h('button.like', { title: 'Like', html: icon('heart', 18), onClick: () => { const t = queue.track; if (t) patchTrack(t.id, { liked: !t.liked }); } })));

  shuffleBtn = h('button.icon-btn.toggle', { title: 'Shuffle (S)', html: icon('shuffle', 18), onClick: () => queue.setShuffle(!state.settings.shuffle) });
  repeatBtn = h('button.icon-btn.toggle', { title: 'Repeat (R)', onClick: cycleRepeat });
  playBtn = h('button.play-btn', { title: 'Play / Pause (Space)', html: icon('play', 22), onClick: togglePlay });
  const controls = h('div.pb-controls', {},
    shuffleBtn,
    h('button.icon-btn', { title: 'Previous', html: icon('prev', 20), onClick: () => queue.prev() }),
    playBtn,
    h('button.icon-btn', { title: 'Next', html: icon('next', 20), onClick: () => queue.next() }),
    repeatBtn);

  seekFill = h('div.seek-fill');
  seekKnob = h('div.seek-knob');
  seekHover = h('div.seek-tip');
  seek = h('div.seek', {}, h('div.seek-track', {}, seekFill), seekKnob, seekHover);
  tCur = h('span.time', { text: '0:00' });
  tDur = h('span.time', { text: '0:00' });
  const center = h('div.pb-center', {}, controls, h('div.pb-seek', {}, tCur, seek, tDur));

  volBtn = h('button.icon-btn', { title: 'Mute (M)', onClick: () => { setSetting('muted', !state.settings.muted); } });
  vol = h('input.vol', { type: 'range', min: '0', max: '1', step: '0.01', value: String(state.settings.volume), title: 'Volume' });
  vol.addEventListener('input', () => { setSetting('volume', +vol.value); if (state.settings.muted) setSetting('muted', false); });
  vol.addEventListener('wheel', (e) => { e.preventDefault(); changeVolume(e.deltaY < 0 ? 0.05 : -0.05); }, { passive: false });
  const right = h('div.pb-right', {},
    h('button.icon-btn', { class: 'icon-btn eq-btn', title: 'Equalizer', html: icon('eq', 18), onClick: openEq }),
    h('button.icon-btn', { title: 'Fullscreen visualizer (V)', html: icon('wave', 18), onClick: openFullViz }),
    volBtn, vol);

  bar.append(left, center, right);
  bindSeek();

  queue.on('track', renderTrack);
  bus.on('track', (id) => { if (id === queue.current) renderTrack(); });
  engine.on('play', syncPlay);
  engine.on('pause', syncPlay);
  engine.on('timeupdate', syncTime);
  engine.on('durationchange', syncTime);
  bus.on('setting', (k) => {
    if (k === 'volume' || k === 'muted') { syncVolume(); engine.applyVolume(); }
    if (k === 'shuffle' || k === 'repeat') syncModes();
    if (k.startsWith('eq')) { engine.applyEq(); bar.querySelector('.eq-btn').classList.toggle('on', state.settings.eqEnabled); }
  });
  bar.querySelector('.eq-btn').classList.toggle('on', state.settings.eqEnabled);
  renderTrack(); syncPlay(); syncVolume(); syncModes();
}

export function togglePlay() {
  if (!queue.current) {
    if (state.allIds.length) queue.playContext(state.allIds, null, { label: 'All Songs', kind: 'all' });
    return;
  }
  engine.paused ? engine.play() : engine.pause();
}
export function changeVolume(d) {
  const v = Math.max(0, Math.min(1, state.settings.volume + d));
  setSetting('volume', Math.round(v * 100) / 100);
  if (state.settings.muted) setSetting('muted', false);
}
export function cycleRepeat() {
  const order = ['off', 'all', 'one'];
  setSetting('repeat', order[(order.indexOf(state.settings.repeat) + 1) % 3]);
  queue.emit('change');
}

function renderTrack() {
  const t = queue.track;
  const cover = bar.querySelector('.pb-cover');
  cover.innerHTML = t?.cover ? `<img src="${coverUrl(t.cover, true)}" draggable="false">` : icon('music', 22);
  const title = bar.querySelector('.pb-title'), artist = bar.querySelector('.pb-artist');
  title.textContent = t ? t.title : 'Chromatune';
  artist.innerHTML = '';
  if (t) {
    artist.append(h('a.link', { text: t.artist, onClick: () => setView({ type: 'artist', id: artistName(t) }) }), ' — ',
      h('a.link', { text: t.album, onClick: () => setView({ type: 'album', id: albumKey(t) }) }));
  } else artist.textContent = 'Pick something to play';
  likeBtn.classList.toggle('on', !!t?.liked);
  likeBtn.innerHTML = icon(t?.liked ? 'heartFill' : 'heart', 18);
  likeBtn.disabled = !t;
  syncTime();
}

function syncPlay() {
  const playing = !engine.paused;
  playBtn.innerHTML = icon(playing ? 'pause' : 'play', 22);
  bar.classList.toggle('is-playing', playing);
}

function syncTime() {
  if (dragging) return;
  const d = engine.duration || queue.track?.duration || 0;
  const p = d ? engine.time / d : 0;
  seekFill.style.width = `${p * 100}%`;
  seekKnob.style.left = `${p * 100}%`;
  tCur.textContent = fmtTime(engine.time);
  tDur.textContent = fmtTime(d);
}

function syncVolume() {
  const s = state.settings;
  vol.value = String(s.volume);
  vol.style.setProperty('--p', `${(s.muted ? 0 : s.volume) * 100}%`);
  volBtn.innerHTML = icon(s.muted || s.volume === 0 ? 'mute' : s.volume < 0.5 ? 'volumeLow' : 'volume', 18);
}

function syncModes() {
  shuffleBtn.classList.toggle('on', !!state.settings.shuffle);
  const r = state.settings.repeat;
  repeatBtn.classList.toggle('on', r !== 'off');
  repeatBtn.innerHTML = icon(r === 'one' ? 'repeat1' : 'repeat', 18);
  repeatBtn.title = `Repeat: ${r} (R)`;
}

function bindSeek() {
  const frac = (e) => { const r = seek.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  const dur = () => engine.duration || queue.track?.duration || 0;
  seek.addEventListener('mousemove', (e) => {
    const f = frac(e);
    seekHover.textContent = fmtTime(f * dur());
    seekHover.style.left = `${f * 100}%`;
  });
  seek.addEventListener('mousedown', (e) => {
    if (!queue.current) return;
    dragging = true;
    seek.classList.add('dragging');
    const move = (ev) => {
      const f = frac(ev);
      seekFill.style.width = `${f * 100}%`;
      seekKnob.style.left = `${f * 100}%`;
      tCur.textContent = fmtTime(f * dur());
    };
    const up = (ev) => {
      removeEventListener('mousemove', move); removeEventListener('mouseup', up);
      dragging = false;
      seek.classList.remove('dragging');
      engine.seek(frac(ev) * dur());
    };
    move(e);
    addEventListener('mousemove', move); addEventListener('mouseup', up);
  });
}

/* ---------- equalizer ---------- */
function openEq() {
  const s = state.settings;
  const sliders = [];
  const labelOf = (f) => (f >= 1000 ? `${f / 1000}k` : `${f}`);
  const enable = h('label.switch', {}, h('input', { type: 'checkbox', checked: s.eqEnabled }), h('span'));
  enable.querySelector('input').addEventListener('change', (e) => setSetting('eqEnabled', e.target.checked));
  const presetSel = h('select.select', {}, h('option', { value: '', text: 'Presets…' }), Object.keys(EQ_PRESETS).map((p) => h('option', { value: p, text: p })));
  presetSel.addEventListener('change', () => {
    const p = EQ_PRESETS[presetSel.value];
    if (!p) return;
    setSetting('eqBands', p.slice());
    sliders.forEach((sl, i) => { sl.value = p[i]; sl.dispatchEvent(new Event('sync')); });
    if (!state.settings.eqEnabled) { setSetting('eqEnabled', true); enable.querySelector('input').checked = true; }
  });
  const mk = (val, onInput, label) => {
    const out = h('span.eq-val', { text: `${val > 0 ? '+' : ''}${val}` });
    const sl = h('input.eq-slider', { type: 'range', min: '-12', max: '12', step: '0.5', value: String(val) });
    const sync = () => { out.textContent = `${+sl.value > 0 ? '+' : ''}${sl.value}`; sl.style.setProperty('--p', `${((+sl.value + 12) / 24) * 100}%`); };
    sl.addEventListener('input', () => { onInput(+sl.value); sync(); });
    sl.addEventListener('sync', sync);
    sl.addEventListener('dblclick', () => { sl.value = '0'; onInput(0); sync(); });
    sync();
    return { sl, el: h('div.eq-band', {}, out, h('div.eq-slot', {}, sl), h('span.eq-label', { text: label })) };
  };
  const pre = mk(s.eqPreamp || 0, (v) => setSetting('eqPreamp', v), 'Pre');
  const bands = EQ_FREQS.map((f, i) => {
    const b = mk(s.eqBands[i] || 0, (v) => { const arr = state.settings.eqBands.slice(); arr[i] = v; setSetting('eqBands', arr); }, labelOf(f));
    sliders.push(b.sl);
    return b.el;
  });
  const body = h('div.eq', {},
    h('div.eq-top', {}, h('div.row', {}, enable, h('span', { text: 'Enabled' })), presetSel),
    h('div.eq-bands', {}, pre.el, h('div.eq-divider'), bands),
    h('p.tiny.muted', { text: 'Double-click a slider to reset it. Changes apply instantly.' }));
  modal({ title: 'Equalizer', body, className: 'eq-modal' });
}
