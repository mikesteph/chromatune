// The main panel: song tables for every view, the album grid, and view headers.
import { state, bus, setView, findNode, reorderInPlaylist, addToPlaylist, artistName, albumKey, patchTrack, removeFromPlaylist, renameNode } from './store.js';
import { queue, engine } from './player.js';
import { viewIds, viewLabel, playView, trackMenu, importPaths, addFolders, addFiles, addNetworkPath, removeFromLibrary } from './actions.js';
import { VirtualList } from './virtuallist.js';
import { h, $, esc, fmtTime, fmtLong, plural, coverUrl, collator } from './util.js';
import { icon } from './icons.js';
import { dragBadge, toast, prompt } from './ui.js';

const COLS = [
  { key: 'idx', label: '#' },
  { key: 'liked', label: '' },
  { key: 'title', label: 'Title' },
  { key: 'artist', label: 'Artist' },
  { key: 'album', label: 'Album' },
  { key: 'year', label: 'Year' },
  { key: 'genre', label: 'Genre' },
  { key: 'plays', label: 'Plays' },
  { key: 'duration', label: 'Time' },
];

let main, list, vlist, ids = [], sort = { key: null, dir: 1 }, anchor = -1, focusIdx = -1;
const rowHeight = () => (state.settings.density === 'compact' ? 30 : 40);

export function initViews() {
  main = $('#main');
  bus.on('view', () => { sort = { key: null, dir: 1 }; anchor = -1; focusIdx = -1; render(); main.scrollTop = 0; });
  bus.on('library', () => render(true));
  bus.on('playlists', () => { if (['playlist', 'folder'].includes(state.view.type)) render(true); });
  bus.on('search', () => render(true));
  bus.on('track', () => vlist?.refresh());
  bus.on('setting', (k) => { if (k === 'density') { vlist?.setRowHeight(rowHeight()); } });
  queue.on('track', () => vlist?.refresh());
  engine.on('play', () => vlist?.refresh());
  engine.on('pause', () => vlist?.refresh());
  render();
}

/* ---------- data ---------- */
function computeIds() {
  let out = viewIds();
  const q = state.search.trim().toLowerCase();
  if (q) {
    const terms = q.split(/\s+/);
    out = out.filter((id) => { const hay = state.tracks.get(id)._hay; return terms.every((t) => hay.includes(t)); });
  }
  if (sort.key) {
    const T = (id) => state.tracks.get(id);
    const k = sort.key, d = sort.dir;
    const num = ['year', 'plays', 'duration', 'liked'].includes(k);
    out = out.slice().sort((a, b) => {
      const A = T(a), B = T(b);
      const r = num ? (Number(A[k]) || 0) - (Number(B[k]) || 0) : collator.compare(k === 'artist' ? artistName(A) : A[k] || '', k === 'artist' ? artistName(B) : B[k] || '');
      return r * d || collator.compare(A.title, B.title);
    });
  }
  return out;
}

const canReorder = () => state.view.type === 'playlist' && !sort.key && !state.search.trim();

/* ---------- render ---------- */
function render(keepScroll = false) {
  const scroll = list?.scrollTop || 0;
  main.innerHTML = '';
  vlist = null;
  list = null;
  if (state.view.type === 'albums') return renderAlbums();
  ids = computeIds();
  main.append(header());
  if (!state.tracks.size && state.view.type === 'all') return main.append(emptyLibrary());
  main.append(columnHeader());
  list = h('div.track-list', { tabindex: '0' });
  main.append(list);
  vlist = new VirtualList(list, { rowHeight: rowHeight(), render: renderRow });
  vlist.setCount(ids.length);
  if (!ids.length) list.append(emptyView());
  if (keepScroll) list.scrollTop = scroll;
  bindList();
}

function header() {
  const v = state.view;
  const all = viewIds();
  const dur = all.reduce((s, id) => s + (state.tracks.get(id)?.duration || 0), 0);
  let kicker = 'Library', art = null, extra = [], subtitle = `${plural(all.length, 'song')} · ${fmtLong(dur)}`;
  // First few distinct covers, without walking a huge library more than needed.
  const coverList = [];
  for (const id of all) {
    const c = state.tracks.get(id)?.cover;
    if (c && !coverList.includes(c)) coverList.push(c);
    if (coverList.length === 4) break;
  }
  const covers = () => coverList;

  if (v.type === 'artist') {
    const a = state.artists.get(v.id);
    kicker = 'Artist';
    art = mosaic(covers(), 'user', true);
    subtitle = `${plural(a?.albums.size || 0, 'album')} · ${subtitle}`;
    extra.push(albumStrip(a));
  } else if (v.type === 'album') {
    const al = state.albums.get(v.id);
    kicker = 'Album';
    art = mosaic(al?.cover ? [al.cover] : [], 'disc');
    subtitle = h('span', {},
      h('a.link', { text: al?.artist || '', onClick: () => setView({ type: 'artist', id: al.artist }) }),
      ` · ${al?.year || '—'} · ${subtitle}`);
  } else if (v.type === 'playlist' || v.type === 'folder') {
    const node = findNode(v.id)?.node;
    kicker = v.type === 'folder' ? 'Playlist folder' : 'Playlist';
    art = mosaic(covers(), v.type === 'folder' ? 'folder' : 'playlist');
    if (v.type === 'folder' && node) {
      const kids = node.children || [];
      subtitle = `${plural(kids.length, 'item')} · ${subtitle}`;
      extra.push(h('div.chips', {}, kids.map((k) => h('button.chip', {
        html: `${icon(k.type === 'folder' ? 'folder' : 'playlist', 14)}<span>${esc(k.name)}</span>`,
        onClick: () => setView({ type: k.type, id: k.id }),
      }))));
    }
  } else {
    const ic = { all: 'library', liked: 'heartFill', recent: 'clock', mostplayed: 'flame', history: 'history' }[v.type] || 'music';
    art = mosaic(v.type === 'all' ? covers() : [], ic);
  }

  const actions = h('div.view-actions', {},
    h('button.btn.primary.big', { html: `${icon('play', 16)}<span>Play</span>`, onClick: () => playView(v, { shuffle: false, ids: ids.length ? ids : null }) }),
    h('button.btn.big', { html: `${icon('shuffle', 16)}<span>Shuffle</span>`, onClick: () => playView(v, { shuffle: true, ids: ids.length ? ids : null }) }),
    v.type === 'playlist' || v.type === 'folder' ? h('button.icon-btn', { title: 'Rename', html: icon('pencil', 17), onClick: async () => {
      const n = findNode(v.id)?.node; const name = await prompt('Rename', { value: n?.name }); if (name) renameNode(v.id, name);
    } }) : null,
    v.type === 'playlist' || v.type === 'folder' ? h('button.icon-btn', { title: 'Export as M3U', html: icon('download', 17), onClick: async () => {
      if (await window.api.exportPlaylist(viewLabel(), viewIds())) toast('Playlist exported', { icon: 'download' });
    } }) : null,
    v.type === 'all' ? h('button.icon-btn', { title: 'Add music folder', html: icon('folderPlus', 17), onClick: addFolders }) : null,
  );

  return h('div.view-header', {},
    h('div.vh-bg', { style: { backgroundImage: covers()[0] ? `url(${coverUrl(covers()[0])})` : 'none' } }),
    h('div.vh-row', {},
      art,
      h('div.vh-text', {},
        h('div.vh-kicker', { text: kicker }),
        h('h1.vh-title', { text: viewLabel() }),
        h('div.vh-sub', {}, subtitle),
        actions)),
    ...extra);
}

function mosaic(covers, fallbackIcon, round = false) {
  const m = h('div.mosaic', { class: `mosaic n${Math.min(covers.length, 4) === 1 ? 1 : covers.length >= 4 ? 4 : covers.length ? 1 : 0}${round ? ' round' : ''}` });
  if (!covers.length) m.innerHTML = icon(fallbackIcon, 44);
  else (covers.length >= 4 ? covers.slice(0, 4) : covers.slice(0, 1)).forEach((c) => m.append(h('img', { src: coverUrl(c, covers.length >= 4), draggable: 'false' })));
  return m;
}

function albumStrip(artist) {
  if (!artist) return null;
  const albums = [...state.albums.values()].filter((a) => a.artist === artist.name).sort((a, b) => (a.year || 0) - (b.year || 0));
  return h('div.album-strip', {}, albums.map((a) => albumCard(a, true)));
}

function albumCard(a, small = false) {
  const card = h('div.album-card', { class: `album-card${small ? ' small' : ''}`, title: `${a.name} — ${a.artist}` },
    h('div.ac-art', {},
      a.cover ? h('img', { src: coverUrl(a.cover, small), loading: 'lazy', draggable: 'false' }) : h('div.ac-ph', { html: icon('disc', small ? 30 : 46) }),
      h('button.ac-play', { title: 'Play album', html: icon('play', 18), onClick: (e) => { e.stopPropagation(); playView({ type: 'album', id: a.key }); } })),
    h('div.ac-name', { text: a.name }),
    h('div.ac-meta', { text: small ? `${a.year || ''} · ${plural(a.ids.length, 'song')}` : `${a.artist}${a.year ? ' · ' + a.year : ''}` }));
  card.addEventListener('click', () => setView({ type: 'album', id: a.key }));
  card.draggable = true;
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('application/x-ct-tracks', JSON.stringify(a.ids));
    e.dataTransfer.effectAllowed = 'copy';
    dragBadge(e, a.name);
  });
  return card;
}

function renderAlbums() {
  const q = state.search.trim().toLowerCase();
  let albums = [...state.albums.values()];
  if (q) albums = albums.filter((a) => `${a.name} ${a.artist} ${a.year}`.toLowerCase().includes(q));
  albums.sort((a, b) => collator.compare(a.artist, b.artist) || (a.year || 0) - (b.year || 0) || collator.compare(a.name, b.name));
  main.append(h('div.view-header.slim', {},
    h('div.vh-row', {},
      h('div.vh-text', {},
        h('div.vh-kicker', { text: 'Library' }),
        h('h1.vh-title', { text: 'Albums' }),
        h('div.vh-sub', { text: plural(albums.length, 'album') })))));
  const grid = h('div.album-grid', {}, albums.map((a) => albumCard(a)));
  main.append(h('div.album-scroll', {}, grid));
}

function columnHeader() {
  const row = h('div.col-header');
  for (const c of COLS) {
    const active = sort.key === c.key;
    const cell = h('div.cell', { class: `cell c-${c.key}${active ? ' sorted' : ''}`, html: `<span>${c.label}</span>${active ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}` });
    if (c.key === 'liked') cell.innerHTML = icon('heart', 13);
    if (c.key !== 'idx') cell.addEventListener('click', () => {
      if (sort.key !== c.key) sort = { key: c.key, dir: c.key === 'plays' || c.key === 'liked' ? -1 : 1 };
      else if (sort.dir === (c.key === 'plays' || c.key === 'liked' ? -1 : 1)) sort.dir *= -1;
      else sort = { key: null, dir: 1 };
      render();
    });
    row.append(cell);
  }
  return row;
}

function renderRow(i, row) {
  const id = ids[i];
  const t = state.tracks.get(id);
  if (!t) { row.innerHTML = ''; return; }
  const playing = queue.current === id;
  row.className = `vrow track${state.selection.has(id) ? ' selected' : ''}${playing ? ' playing' : ''}${i % 2 ? ' alt' : ''}${i === focusIdx ? ' focus' : ''}`;
  row.draggable = true;
  row.dataset.id = id;
  const num = playing
    ? (engine.paused ? icon('pause', 13) : '<span class="eqbars"><i></i><i></i><i></i></span>')
    : `<span class="num">${state.view.type === 'album' && !sort.key ? t.trackNo || i + 1 : i + 1}</span><span class="hover-play">${icon('play', 12)}</span>`;
  const badge = t.lossless ? `<span class="badge">${esc(String(t.codec).split(' ')[0].toUpperCase())}</span>` : '';
  row.innerHTML =
    `<div class="cell c-idx">${num}</div>` +
    `<div class="cell c-liked"><button class="like ${t.liked ? 'on' : ''}" tabindex="-1">${icon(t.liked ? 'heartFill' : 'heart', 15)}</button></div>` +
    `<div class="cell c-title">${t.cover ? `<img class="thumb" src="${coverUrl(t.cover, true)}" loading="lazy" draggable="false">` : `<span class="thumb ph">${icon('music', 13)}</span>`}<span class="t">${esc(t.title)}</span>${badge}</div>` +
    `<div class="cell c-artist"><span class="link" data-artist="${esc(artistName(t))}">${esc(t.artist)}</span></div>` +
    `<div class="cell c-album"><span class="link" data-album="${esc(albumKey(t))}">${esc(t.album)}</span></div>` +
    `<div class="cell c-year">${t.year || ''}</div>` +
    `<div class="cell c-genre">${esc(t.genre)}</div>` +
    `<div class="cell c-plays">${t.plays || ''}</div>` +
    `<div class="cell c-duration">${fmtTime(t.duration)}</div>`;
}

/* ---------- interaction ---------- */
function select(i, e) {
  const id = ids[i];
  if (id == null) return;
  if (e?.shiftKey && anchor >= 0) {
    if (!(e.ctrlKey || e.metaKey)) state.selection.clear();
    const [a, b] = anchor < i ? [anchor, i] : [i, anchor];
    for (let k = a; k <= b; k++) state.selection.add(ids[k]);
  } else if (e?.ctrlKey || e?.metaKey) {
    state.selection.has(id) ? state.selection.delete(id) : state.selection.add(id);
    anchor = i;
  } else {
    state.selection.clear();
    state.selection.add(id);
    anchor = i;
  }
  focusIdx = i;
  vlist.refresh();
}

const selectedIds = () => ids.filter((id) => state.selection.has(id));

function bindList() {
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.vrow');
    if (!row) return;
    const i = +row.dataset.index;
    const like = e.target.closest('.like');
    if (like) { const t = state.tracks.get(ids[i]); patchTrack(t.id, { liked: !t.liked }); return; }
    const link = e.target.closest('.link');
    if (link && !e.ctrlKey && !e.shiftKey) {
      if (link.dataset.artist) return setView({ type: 'artist', id: link.dataset.artist });
      if (link.dataset.album) return setView({ type: 'album', id: link.dataset.album });
    }
    if (e.target.closest('.hover-play')) return playAt(i);
    select(i, e);
  });
  list.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.vrow');
    if (row && !e.target.closest('.like')) playAt(+row.dataset.index);
  });
  list.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.vrow');
    if (!row) return;
    const i = +row.dataset.index;
    if (!state.selection.has(ids[i])) select(i);
    trackMenu(e, selectedIds());
  });
  list.addEventListener('keydown', onKey);

  // Dragging songs out (to playlists in the sidebar, or to reorder within a playlist).
  list.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.vrow');
    if (!row) return;
    const i = +row.dataset.index;
    if (!state.selection.has(ids[i])) select(i);
    const sel = selectedIds();
    e.dataTransfer.setData('application/x-ct-tracks', JSON.stringify(sel));
    if (canReorder()) e.dataTransfer.setData('application/x-ct-from-playlist', state.view.id);
    e.dataTransfer.effectAllowed = 'copyMove';
    dragBadge(e, sel.length > 1 ? plural(sel.length, 'song') : state.tracks.get(sel[0]).title);
  });

  // Dropping into a playlist view (reorder, add songs, or import files at a position).
  if (state.view.type !== 'playlist') return;
  const indicator = h('div.drop-line');
  const dropIndex = (e) => Math.max(0, Math.min(ids.length, Math.round((e.clientY - list.getBoundingClientRect().top + list.scrollTop) / rowHeight())));
  list.addEventListener('dragover', (e) => {
    const types = e.dataTransfer.types;
    if (!types.includes('application/x-ct-tracks') && !types.includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = types.includes('application/x-ct-from-playlist') ? 'move' : 'copy';
    if (!canReorder()) return;
    indicator.style.transform = `translateY(${dropIndex(e) * rowHeight() - 1}px)`;
    if (!indicator.isConnected) list.append(indicator);
  });
  list.addEventListener('dragleave', (e) => { if (!list.contains(e.relatedTarget)) indicator.remove(); });
  list.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    indicator.remove();
    const idx = canReorder() ? dropIndex(e) : null;
    const pid = state.view.id;
    if (e.dataTransfer.types.includes('Files') && e.dataTransfer.files.length) {
      const paths = [...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean);
      document.body.classList.remove('dragging-files');
      return importPaths(paths, { playlistId: pid, index: idx });
    }
    const dropped = JSON.parse(e.dataTransfer.getData('application/x-ct-tracks') || '[]');
    if (e.dataTransfer.getData('application/x-ct-from-playlist') === pid) reorderInPlaylist(pid, dropped, idx ?? ids.length);
    else { const n = addToPlaylist(pid, dropped, idx); toast(`Added ${plural(n, 'song')}`, { icon: 'playlist' }); }
  });
}

function playAt(i) {
  playView(state.view, { startId: ids[i], ids, shuffle: null });
}

function onKey(e) {
  if (!ids.length) return;
  const k = e.key;
  if (k === 'ArrowDown' || k === 'ArrowUp') {
    e.preventDefault();
    const i = Math.max(0, Math.min(ids.length - 1, (focusIdx < 0 ? -1 : focusIdx) + (k === 'ArrowDown' ? 1 : -1)));
    select(i, e.shiftKey ? e : null);
    vlist.scrollToIndex(i, false);
  } else if (k === 'Enter' && focusIdx >= 0) {
    playAt(focusIdx);
  } else if ((k === 'a' || k === 'A') && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    ids.forEach((id) => state.selection.add(id));
    vlist.refresh();
  } else if (k === 'Delete' && state.selection.size) {
    if (state.view.type === 'playlist') removeFromPlaylist(state.view.id, selectedIds());
    else removeFromLibrary(selectedIds());
  } else if (k === 'Home' || k === 'End') {
    e.preventDefault();
    select(k === 'Home' ? 0 : ids.length - 1);
    vlist.scrollToIndex(focusIdx, false);
  }
}

export function revealPlaying() {
  const i = ids.indexOf(queue.current);
  if (i >= 0 && vlist) { vlist.scrollToIndex(i); select(i); }
}

export function focusList() { list?.focus(); }

/* ---------- empty states ---------- */
function emptyLibrary() {
  return h('div.empty-lib', {},
    h('div.empty-ic', { html: icon('music', 54) }),
    h('h2', { text: 'Your library is empty' }),
    h('p.muted', { text: 'Drag & drop music files or folders from any local or network drive anywhere onto this window — or use the buttons below.' }),
    h('div.row-center', {},
      h('button.btn.primary.big', { html: `${icon('folderPlus', 16)}<span>Add folder</span>`, onClick: addFolders }),
      h('button.btn.big', { html: `${icon('filePlus', 16)}<span>Add files</span>`, onClick: addFiles }),
      h('button.btn.big', { html: `${icon('server', 16)}<span>Network path</span>`, onClick: addNetworkPath })),
    h('p.tiny.muted', { text: 'MP3 · FLAC · OGG · Opus · WAV · M4A/AAC · WebM — plus M3U/M3U8 playlists' }));
}

function emptyView() {
  const msg = state.search.trim() ? 'No songs match your search'
    : state.view.type === 'playlist' ? 'Drag songs here from the library, or drop files from your drives'
      : state.view.type === 'liked' ? 'Tap the heart on any song to collect it here'
        : 'Nothing here yet';
  return h('div.empty-view', { html: `${icon(state.view.type === 'playlist' ? 'playlistPlus' : 'music', 34)}<p>${esc(msg)}</p>` });
}
