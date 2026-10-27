// Boot: load state, paint the theme, mount every panel, wire global input and OS integration.
import { state, bus, DEFAULT_SETTINGS, rebuildIndexes, setSetting, patchTrack } from './store.js';
import { queue, engine } from './player.js';
import { applyCurrentTheme, openThemePicker, cycleTheme, accentFromCover } from './themepicker.js';
import { initSidebar } from './sidebar.js';
import { initArtists } from './artists.js';
import { initViews, revealPlaying, focusList } from './views.js';
import { initNowPlaying, openFullViz, closeFullViz, fullVizOpen, nextVizMode } from './nowplaying.js';
import { initPlayerBar, togglePlay, changeVolume, cycleRepeat } from './playerbar.js';
import { openSettings, applyLook } from './settings.js';
import { importPaths, shuffleLibrary } from './actions.js';
import { h, $, debounce, coverUrl } from './util.js';
import { icon } from './icons.js';
import { toast, closeMenu } from './ui.js';

async function boot() {
  const init = await window.api.getState();
  state.platform = init.platform;
  state.omarchy = init.omarchy;
  state.settings = { ...DEFAULT_SETTINGS, ...(init.settings || {}) };
  // Older versions saved fixed panel sizes; switch them to the new auto-scaling layout once.
  if (init.settings?.themeId && init.settings.layoutVersion !== DEFAULT_SETTINGS.layoutVersion) {
    for (const k of ['sidebarWidth', 'artistsWidth', 'nowPlayingWidth', 'vizHeight']) state.settings[k] = null;
    setSetting('layoutVersion', DEFAULT_SETTINGS.layoutVersion);
  }
  state.playlists = init.playlists || [];
  for (const t of init.tracks) state.tracks.set(t.id, t);
  rebuildIndexes();
  document.body.dataset.platform = init.platform;

  applyCurrentTheme();
  applyLook();
  buildTitlebar();
  initSidebar();
  initArtists();
  initViews();
  initNowPlaying();
  initPlayerBar();
  initResizers();
  initDragAndDrop();
  initKeys();
  initMediaSession();

  queue.on('track', (t) => {
    window.api.win.title(t ? `${t.title} — ${t.artist} · Chromatune` : 'Chromatune');
    accentFromCover(t?.cover ? coverUrl(t.cover, true) : null);
  });
  queue.on('unplayable', (t) => toast(`Can't play “${t?.title}” — skipping`, { icon: 'x', kind: 'warn' }));
  bus.on('setting', (k) => { if (k === 'dynamicAccent' || k === 'followOmarchy') applyCurrentTheme(); });

  window.api.onOmarchyTheme((theme) => {
    state.omarchy = theme;
    if (state.settings.followOmarchy) { applyCurrentTheme(); toast(`Theme synced with Omarchy`, { icon: 'palette', timeout: 1600 }); }
  });
  window.api.onOpenPaths(openPaths);

  if (state.settings.resume && state.settings.session) queue.restore(state.settings.session);
  setInterval(saveSession, 5000);
  window.addEventListener('beforeunload', saveSession);
  if (init.openPaths?.length) openPaths(init.openPaths);
  document.body.classList.add('ready');
}

function saveSession() {
  if (queue.current) { state.settings.session = queue.snapshot(); setSetting('session', state.settings.session); }
}

async function openPaths(paths) {
  const res = await importPaths(paths, { rememberFolders: false });
  if (res?.ids.length) queue.playContext(res.ids, res.ids[0], { label: 'Opened files', kind: 'opened' });
}

/* ---------- title bar ---------- */
function buildTitlebar() {
  const tb = $('#titlebar');
  const search = h('input#search', { placeholder: 'Search songs, artists, albums…   Ctrl+F', spellcheck: 'false' });
  const clear = h('button.search-clear', { html: icon('x', 14), title: 'Clear', onClick: () => { search.value = ''; doSearch(); search.focus(); } });
  const doSearch = debounce(() => {
    state.search = search.value;
    clear.style.display = search.value ? 'flex' : 'none';
    bus.emit('search');
  }, 120);
  search.addEventListener('input', doSearch);
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { search.value = ''; doSearch(); search.blur(); }
    if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); focusList(); }
  });
  clear.style.display = 'none';

  const panelToggle = (key, ic, title) => {
    const b = h('button.icon-btn.toggle', { title, html: icon(ic, 17) });
    const sync = () => b.classList.toggle('on', !!state.settings[key]);
    b.addEventListener('click', () => { setSetting(key, !state.settings[key]); applyLook(); sync(); });
    sync();
    return b;
  };
  const scan = h('div.scan-status', {}, h('span.spinner'), h('span.scan-text', { text: 'Scanning…' }));
  const winBtns = h('div.win-controls', {},
    h('button.win-btn', { title: 'Minimize', html: icon('minus', 15), onClick: () => window.api.win.minimize() }),
    h('button.win-btn.max', { title: 'Maximize', html: icon('square', 13), onClick: () => window.api.win.maximize() }),
    h('button.win-btn.close', { title: 'Close', html: icon('x', 16), onClick: () => window.api.win.close() }));
  window.api.onMaximized((m) => { winBtns.querySelector('.max').innerHTML = icon(m ? 'squares' : 'square', 13); });

  tb.append(
    h('div.tb-left', {},
      h('div.brand', { html: `<span class="brand-ic">${icon('logo', 16)}</span><span class="brand-name">Chromatune</span>` }),
      panelToggle('showArtists', 'users', 'Toggle artists panel'),
      panelToggle('showNowPlaying', 'panelRight', 'Toggle now-playing panel')),
    h('div.tb-center', {}, h('div.search-box', { html: icon('search', 15) }, search, clear)),
    h('div.tb-right', {},
      scan,
      h('button.icon-btn.tb-shuffle', { title: 'Shuffle entire library (Ctrl+Shift+S)', html: icon('shuffle', 17), onClick: shuffleLibrary }),
      h('button.icon-btn.palette-btn', { title: 'Color palette (T)', html: icon('palette', 18), onClick: openThemePicker }),
      h('button.icon-btn', { title: 'Settings (Ctrl+,)', html: icon('settings', 17), onClick: openSettings }),
      winBtns));

  let scanning = false;
  window.api.onScanProgress((p) => {
    if (!scanning) return;
    scan.querySelector('.scan-text').textContent = p.phase === 'collect' ? `Finding music… ${p.found.toLocaleString()}` : `Reading tags ${p.done.toLocaleString()} / ${p.total.toLocaleString()}`;
  });
  bus.on('scan', (p) => {
    scanning = p.phase === 'start';
    if (scanning) { scan.classList.add('on'); scan.querySelector('.scan-text').textContent = 'Scanning…'; }
    else scan.classList.remove('on');
  });
}

/* ---------- panel resizing ---------- */
function initResizers() {
  for (const r of document.querySelectorAll('.resizer')) {
    r.title = 'Drag to resize · double-click to reset';
    r.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const key = r.dataset.for;
      const setting = { sidebar: 'sidebarWidth', artists: 'artistsWidth', nowplaying: 'nowPlayingWidth' }[key];
      const limits = { sidebar: [190, 420], artists: [170, 400], nowplaying: [260, 560] }[key];
      const panel = document.getElementById(key);
      const startX = e.clientX, start = panel.offsetWidth;
      const dir = key === 'nowplaying' ? -1 : 1;
      document.body.classList.add('resizing');
      const move = (ev) => {
        const w = Math.max(limits[0], Math.min(limits[1], start + (ev.clientX - startX) * dir));
        state.settings[setting] = w;
        document.documentElement.style.setProperty(`--${key}-w`, `${w}px`);
      };
      const up = () => {
        removeEventListener('mousemove', move); removeEventListener('mouseup', up);
        document.body.classList.remove('resizing');
        setSetting(setting, state.settings[setting]);
      };
      addEventListener('mousemove', move); addEventListener('mouseup', up);
    });
    // Double-click a divider to go back to automatic sizing.
    r.addEventListener('dblclick', () => {
      const setting = { sidebar: 'sidebarWidth', artists: 'artistsWidth', nowplaying: 'nowPlayingWidth' }[r.dataset.for];
      setSetting(setting, null);
      applyLook();
    });
  }
}

/* ---------- drag & drop from the OS (local + network drives) ---------- */
function initDragAndDrop() {
  $('#drop-hint .dh-ic').innerHTML = icon('download', 24);
  let depth = 0;
  const hasFiles = (e) => e.dataTransfer?.types.includes('Files');
  const off = () => { depth = 0; document.body.classList.remove('dragging-files'); };
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; depth++; document.body.classList.add('dragging-files'); });
  window.addEventListener('dragleave', (e) => { if (!hasFiles(e)) return; if (--depth <= 0) off(); });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    off();
    if (!hasFiles(e)) return;
    const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean);
    if (paths.length) importPaths(paths);
  });
  window.addEventListener('dragend', off);
}

/* ---------- keyboard ---------- */
function initKeys() {
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox';
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') {
      closeMenu();
      if (fullVizOpen()) closeFullViz();
      return;
    }
    if (ctrl && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#search').focus(); $('#search').select(); return; }
    if (ctrl && e.key === ',') { e.preventDefault(); openSettings(); return; }
    if (ctrl && e.key.toLowerCase() === 'l') { e.preventDefault(); revealPlaying(); return; }
    if (ctrl && e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); shuffleLibrary(); return; }
    if (typing || document.querySelector('.modal-wrap')) return;
    if (ctrl || e.altKey) return;
    switch (e.key) {
      case ' ': e.preventDefault(); togglePlay(); break;
      case 'ArrowRight': e.preventDefault(); engine.seek(engine.time + (e.shiftKey ? 30 : 5)); break;
      case 'ArrowLeft': e.preventDefault(); engine.seek(engine.time - (e.shiftKey ? 30 : 5)); break;
      case 'n': case 'N': queue.next(); break;
      case 'p': case 'P': queue.prev(); break;
      case '+': case '=': changeVolume(0.05); break;
      case '-': case '_': changeVolume(-0.05); break;
      case 'm': case 'M': setSetting('muted', !state.settings.muted); break;
      case 's': case 'S': queue.setShuffle(!state.settings.shuffle); toast(`Shuffle ${state.settings.shuffle ? 'on' : 'off'}`, { icon: 'shuffle', timeout: 1200 }); break;
      case 'r': case 'R': cycleRepeat(); toast(`Repeat: ${state.settings.repeat}`, { icon: 'repeat', timeout: 1200 }); break;
      case 'l': case 'L': { const t = queue.track; if (t) patchTrack(t.id, { liked: !t.liked }); break; }
      case 'v': case 'V': fullVizOpen() ? closeFullViz() : openFullViz(); break;
      case 'b': case 'B': nextVizMode(); break;
      case 't': case 'T': openThemePicker(); break;
      case '[': cycleTheme(-1); break;
      case ']': cycleTheme(1); break;
      case 'F11': e.preventDefault(); fullVizOpen() ? closeFullViz() : openFullViz(); break;
      default: break;
    }
  });
}

/* ---------- OS media integration (MPRIS on Linux, SMTC on Windows) ---------- */
function initMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  let artUrl = null;
  queue.on('track', async (t) => {
    if (!t) return;
    ms.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album });
    if (!t.cover) return;
    // The OS media overlay only accepts http/data/blob artwork, so hand it a blob of the cached cover.
    const blob = await fetch(coverUrl(t.cover)).then((r) => r.blob()).catch(() => null);
    if (!blob || queue.current !== t.id) return;
    if (artUrl) URL.revokeObjectURL(artUrl);
    artUrl = URL.createObjectURL(blob);
    ms.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album, artwork: [{ src: artUrl, sizes: '600x600', type: 'image/jpeg' }] });
  });
  engine.on('play', () => { ms.playbackState = 'playing'; });
  engine.on('pause', () => { ms.playbackState = 'paused'; });
  const set = (a, fn) => { try { ms.setActionHandler(a, fn); } catch {} };
  set('play', () => togglePlay());
  set('pause', () => engine.pause());
  set('nexttrack', () => queue.next());
  set('previoustrack', () => queue.prev());
  set('seekto', (d) => engine.seek(d.seekTime));
  set('seekforward', () => engine.seek(engine.time + 10));
  set('seekbackward', () => engine.seek(engine.time - 10));
  let last = 0;
  engine.on('timeupdate', () => {
    const now = Date.now();
    if (now - last < 1000 || !engine.duration) return;
    last = now;
    try { ms.setPositionState({ duration: engine.duration, position: Math.min(engine.time, engine.duration), playbackRate: 1 }); } catch {}
  });
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="padding:24px;color:#f88">Chromatune failed to start:\n${err.stack || err}</pre>`;
});

