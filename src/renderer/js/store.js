// Shared application state, derived indexes and the playlist tree model.
import { Emitter, debounce, uid, collator } from './util.js';

export const bus = new Emitter();

export const DEFAULT_SETTINGS = {
  themeId: 'tokyo-night',
  themeOverrides: {},
  customThemes: [],
  followOmarchy: false,
  dynamicAccent: false,
  font: 'sans',
  density: 'comfortable',
  volume: 0.8,
  muted: false,
  shuffle: false,
  repeat: 'off',
  eqEnabled: false,
  eqBands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  eqPreamp: 0,
  vizMode: 'prism',
  vizSensitivity: 1,
  vizTrails: true,
  showArtists: true,
  showNowPlaying: true,
  sidebarWidth: 250,
  artistsWidth: 230,
  nowPlayingWidth: 340,
  vizHeight: 190,
  artistSort: 'name',
  folders: [],
  sort: { key: null, dir: 1 },
  resume: true,
  session: null,
};

export const state = {
  tracks: new Map(),
  allIds: [],
  playlists: [],
  settings: { ...DEFAULT_SETTINGS },
  artists: new Map(),
  albums: new Map(),
  view: { type: 'all' },
  search: '',
  selection: new Set(),
  platform: 'linux',
  omarchy: null,
};

export const artistName = (t) => t.albumArtist || t.artist || 'Unknown Artist';
export const albumKey = (t) => `${artistName(t).toLowerCase()}\u0000${(t.album || '').toLowerCase()}`;

export function naturalCompare(a, b) {
  return collator.compare(artistName(a), artistName(b))
    || (a.year || 0) - (b.year || 0)
    || collator.compare(a.album, b.album)
    || (a.discNo || 0) - (b.discNo || 0)
    || (a.trackNo || 0) - (b.trackNo || 0)
    || collator.compare(a.title, b.title);
}

export function rebuildIndexes() {
  const list = [...state.tracks.values()];
  list.sort(naturalCompare);
  state.allIds = list.map((t) => t.id);
  const artists = new Map(), albums = new Map();
  for (const t of list) {
    t._hay = `${t.title} ${t.artist} ${t.albumArtist} ${t.album} ${t.genre} ${t.year || ''}`.toLowerCase();
    const an = artistName(t);
    let a = artists.get(an);
    if (!a) artists.set(an, (a = { name: an, ids: [], albums: new Set(), cover: null, duration: 0 }));
    a.ids.push(t.id);
    a.albums.add(t.album);
    a.duration += t.duration || 0;
    if (!a.cover && t.cover) a.cover = t.cover;
    const k = albumKey(t);
    let al = albums.get(k);
    if (!al) albums.set(k, (al = { key: k, name: t.album, artist: an, year: t.year, ids: [], cover: null, duration: 0 }));
    al.ids.push(t.id);
    al.duration += t.duration || 0;
    if (!al.cover && t.cover) al.cover = t.cover;
    if (!al.year && t.year) al.year = t.year;
  }
  state.artists = artists;
  state.albums = albums;
  bus.emit('library');
}

export function addTracks(tracks) {
  for (const t of tracks) {
    const prev = state.tracks.get(t.id);
    state.tracks.set(t.id, prev ? { ...prev, ...t } : t);
  }
  rebuildIndexes();
}

export function removeTracks(ids) {
  const set = new Set(ids);
  for (const id of set) state.tracks.delete(id);
  walk(state.playlists, (n) => { if (n.type === 'playlist') n.ids = n.ids.filter((id) => !set.has(id)); });
  window.api.removeTracks([...set]);
  rebuildIndexes();
  savePlaylists();
}

const pendingPatches = new Map();
const flushPatches = debounce(() => {
  window.api.updateTracks([...pendingPatches.values()]);
  pendingPatches.clear();
}, 600);
export function patchTrack(id, patch) {
  const t = state.tracks.get(id);
  if (!t) return;
  Object.assign(t, patch);
  pendingPatches.set(id, { ...(pendingPatches.get(id) || { id }), ...patch });
  flushPatches();
  bus.emit('track', id);
}

export const saveSettings = debounce(() => window.api.setStore('settings', state.settings), 400);
export function setSetting(key, value) {
  state.settings[key] = value;
  saveSettings();
  bus.emit('setting', key, value);
}

/* ---------- playlist tree ---------- */
export const savePlaylists = debounce(() => window.api.setStore('playlists', state.playlists), 300);

export function walk(nodes, fn, parent = null) {
  for (const n of nodes) {
    if (fn(n, parent) === false) return false;
    if (n.children && walk(n.children, fn, n) === false) return false;
  }
}

export function findNode(id, nodes = state.playlists, parent = null) {
  for (const n of nodes) {
    if (n.id === id) return { node: n, parent, list: nodes };
    if (n.children) {
      const r = findNode(id, n.children, n);
      if (r) return r;
    }
  }
  return null;
}

// Every song reachable from a node; folders merge their children without duplicates.
export function nodeTrackIds(node) {
  if (node.type === 'playlist') return node.ids.filter((id) => state.tracks.has(id));
  const seen = new Set(), out = [];
  walk(node.children || [], (n) => {
    if (n.type === 'playlist') for (const id of n.ids) if (!seen.has(id) && state.tracks.has(id)) { seen.add(id); out.push(id); }
  });
  return out;
}

export function createNode(type, name, parentId = null, ids = []) {
  const node = type === 'folder'
    ? { id: uid(), type, name, children: [], open: true }
    : { id: uid(), type, name, ids: [...ids] };
  const parent = parentId ? findNode(parentId)?.node : null;
  if (parent && parent.type === 'folder') { parent.children.push(node); parent.open = true; }
  else state.playlists.push(node);
  savePlaylists();
  bus.emit('playlists');
  return node;
}

export function deleteNode(id) {
  const f = findNode(id);
  if (!f) return;
  f.list.splice(f.list.indexOf(f.node), 1);
  savePlaylists();
  bus.emit('playlists');
}

export function renameNode(id, name) {
  const f = findNode(id);
  if (!f || !name.trim()) return;
  f.node.name = name.trim();
  savePlaylists();
  bus.emit('playlists');
}

const isInside = (node, id) => { let hit = false; walk(node.children || [], (n) => { if (n.id === id) { hit = true; return false; } }); return hit; };

// Move a node before/after/inside another node.
export function moveNode(id, targetId, where) {
  if (id === targetId) return;
  const src = findNode(id), dst = findNode(targetId);
  if (!src || !dst || isInside(src.node, targetId)) return;
  src.list.splice(src.list.indexOf(src.node), 1);
  if (where === 'inside' && dst.node.type === 'folder') {
    dst.node.children.push(src.node);
    dst.node.open = true;
  } else {
    const fresh = findNode(targetId);
    const idx = fresh.list.indexOf(fresh.node);
    fresh.list.splice(where === 'after' ? idx + 1 : idx, 0, src.node);
  }
  savePlaylists();
  bus.emit('playlists');
}

export function addToPlaylist(id, ids, atIndex = null) {
  const f = findNode(id);
  if (!f || f.node.type !== 'playlist') return 0;
  const existing = new Set(f.node.ids);
  const fresh = ids.filter((x) => !existing.has(x));
  if (atIndex == null) f.node.ids.push(...fresh);
  else f.node.ids.splice(atIndex, 0, ...fresh);
  savePlaylists();
  bus.emit('playlists');
  return fresh.length;
}

export function removeFromPlaylist(id, ids) {
  const f = findNode(id);
  if (!f || f.node.type !== 'playlist') return;
  const set = new Set(ids);
  f.node.ids = f.node.ids.filter((x) => !set.has(x));
  savePlaylists();
  bus.emit('playlists');
}

export function reorderInPlaylist(id, ids, toIndex) {
  const f = findNode(id);
  if (!f) return;
  const set = new Set(ids);
  const before = f.node.ids.slice(0, toIndex).filter((x) => !set.has(x)).length;
  const rest = f.node.ids.filter((x) => !set.has(x));
  rest.splice(before, 0, ...ids);
  f.node.ids = rest;
  savePlaylists();
  bus.emit('playlists');
}

export function allPlaylists() {
  const out = [];
  const rec = (nodes, depth, path) => {
    for (const n of nodes) {
      if (n.type === 'playlist') out.push({ node: n, depth, path });
      else { out.push({ node: n, depth, path, folder: true }); rec(n.children, depth + 1, [...path, n.name]); }
    }
  };
  rec(state.playlists, 0, []);
  return out;
}

export function setView(view) {
  state.view = view;
  state.selection.clear();
  bus.emit('view', view);
}
