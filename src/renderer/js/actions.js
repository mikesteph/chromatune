// Cross-cutting actions shared by every panel: view resolution, playback shortcuts, menus, imports.
import { state, bus, findNode, nodeTrackIds, addTracks, createNode, addToPlaylist, removeFromPlaylist, removeTracks,
  patchTrack, setView, allPlaylists, setSetting, artistName, albumKey } from './store.js';
import { queue, engine } from './player.js';
import { showMenu, toast, prompt, confirmDialog } from './ui.js';
import { plural } from './util.js';

export function viewIds(view = state.view) {
  const all = state.allIds;
  const T = (id) => state.tracks.get(id);
  switch (view.type) {
    case 'all': return all;
    case 'liked': return all.filter((id) => T(id).liked);
    case 'recent': return all.slice().sort((a, b) => T(b).added - T(a).added);
    case 'mostplayed': return all.filter((id) => T(id).plays > 0).sort((a, b) => T(b).plays - T(a).plays);
    case 'history': return all.filter((id) => T(id).lastPlayed > 0).sort((a, b) => T(b).lastPlayed - T(a).lastPlayed);
    case 'artist': return state.artists.get(view.id)?.ids || [];
    case 'album': return state.albums.get(view.id)?.ids || [];
    case 'playlist':
    case 'folder': { const f = findNode(view.id); return f ? nodeTrackIds(f.node) : []; }
    default: return all;
  }
}

export function viewLabel(view = state.view) {
  switch (view.type) {
    case 'all': return 'All Songs';
    case 'albums': return 'Albums';
    case 'liked': return 'Liked Songs';
    case 'recent': return 'Recently Added';
    case 'mostplayed': return 'Most Played';
    case 'history': return 'Recently Played';
    case 'artist': return view.id;
    case 'album': return state.albums.get(view.id)?.name || 'Album';
    case 'playlist':
    case 'folder': return findNode(view.id)?.node.name || 'Playlist';
    default: return 'Library';
  }
}

export function playView(view, { shuffle = null, startId = null, ids = null } = {}) {
  const list = ids || viewIds(view);
  if (!list.length) return toast('Nothing to play here yet', { icon: 'music' });
  queue.playContext(list, startId, { label: viewLabel(view), kind: view.type, id: view.id }, { shuffle });
}

export const shuffleLibrary = () => playView({ type: 'all' }, { shuffle: true });

export function toggleLike(ids) {
  const allLiked = ids.every((id) => state.tracks.get(id)?.liked);
  for (const id of ids) patchTrack(id, { liked: !allLiked });
}

export function playlistSubmenu(ids) {
  const items = [{ label: 'New playlist…', icon: 'playlistPlus', action: () => newPlaylistWith(ids) }];
  const list = allPlaylists();
  if (list.length) items.push({ sep: true });
  for (const p of list) {
    if (p.folder) items.push({ header: `${'  '.repeat(p.depth)}${p.node.name}` });
    else items.push({
      label: p.node.name, icon: 'playlist', indent: p.depth,
      action: () => { const n = addToPlaylist(p.node.id, ids); toast(n ? `Added ${plural(n, 'song')} to ${p.node.name}` : `Already in ${p.node.name}`, { icon: 'playlist' }); },
    });
  }
  return items;
}

export async function newPlaylistWith(ids, parentId = null) {
  const name = await prompt('New playlist', { placeholder: 'Playlist name', ok: 'Create' });
  if (!name) return null;
  const node = createNode('playlist', name, parentId, ids);
  if (ids.length) toast(`Created “${name}” with ${plural(ids.length, 'song')}`, { icon: 'playlist' });
  return node;
}

export function trackMenu(e, ids) {
  e.preventDefault();
  const first = state.tracks.get(ids[0]);
  if (!first) return;
  const inPlaylist = state.view.type === 'playlist';
  const liked = ids.every((id) => state.tracks.get(id)?.liked);
  const many = ids.length > 1;
  showMenu(e.clientX, e.clientY, [
    { header: many ? plural(ids.length, 'song') : first.title },
    { label: 'Play', icon: 'play', action: () => (many ? queue.playContext(ids, ids[0], { label: 'Selection' }) : playView(state.view, { startId: ids[0] })) },
    { label: 'Play next', icon: 'listStart', action: () => { queue.playNext(ids); toast(`Playing next: ${many ? plural(ids.length, 'song') : first.title}`, { icon: 'queue' }); } },
    { label: 'Add to queue', icon: 'listEnd', action: () => { queue.enqueue(ids); toast(`Queued ${plural(ids.length, 'song')}`, { icon: 'queue' }); } },
    { sep: true },
    { label: 'Add to playlist', icon: 'playlistPlus', submenu: playlistSubmenu(ids) },
    { label: liked ? 'Remove from Liked' : 'Add to Liked', icon: 'heart', action: () => toggleLike(ids) },
    { sep: true },
    !many && { label: `Go to artist`, icon: 'user', hint: artistName(first), action: () => setView({ type: 'artist', id: artistName(first) }) },
    !many && { label: 'Go to album', icon: 'disc', hint: first.album, action: () => setView({ type: 'album', id: albumKey(first) }) },
    !many && { label: 'Show in folder', icon: 'folderOpen', action: () => window.api.showInFolder(first.path) },
    { sep: true },
    inPlaylist && { label: 'Remove from playlist', icon: 'minus', action: () => removeFromPlaylist(state.view.id, ids) },
    { label: 'Remove from library', icon: 'trash', danger: true, action: () => removeFromLibrary(ids) },
  ]);
}

export async function removeFromLibrary(ids) {
  const ok = await confirmDialog('Remove from library',
    `Remove ${plural(ids.length, 'song')} from Chromatune? Your files on disk are not touched.`, { ok: 'Remove' });
  if (!ok) return;
  if (ids.includes(queue.current)) engine.pause();
  removeTracks(ids);
  toast(`Removed ${plural(ids.length, 'song')}`, { icon: 'trash' });
}

/* ---------- importing ---------- */
let scanning = 0;
export async function importPaths(paths, { playlistId = null, index = null, rememberFolders = true } = {}) {
  if (!paths?.length) return;
  scanning++;
  bus.emit('scan', { phase: 'start' });
  try {
    if (rememberFolders) {
      const dirs = [];
      for (const p of paths) if (!/\.(mp3|flac|ogg|oga|opus|wav|m4a|aac|mp4|webm|weba|m3u8?)$/i.test(p)) dirs.push(p);
      const merged = [...new Set([...(state.settings.folders || []), ...dirs])];
      if (merged.length !== (state.settings.folders || []).length) setSetting('folders', merged);
    }
    const res = await window.api.addPaths(paths);
    if (res.changed.length) addTracks(res.changed);
    for (const pl of res.playlists) if (pl.ids.length) createNode('playlist', pl.name, null, pl.ids);
    if (playlistId && res.ids.length) {
      const f = findNode(playlistId);
      if (f?.node.type === 'playlist') addToPlaylist(playlistId, res.ids, index);
      else if (f?.node.type === 'folder') createNode('playlist', 'Dropped songs', playlistId, res.ids);
    }
    const msg = res.ids.length
      ? `Added ${plural(res.ids.length, 'song')}${res.playlists.length ? ` and ${plural(res.playlists.length, 'playlist')}` : ''}${playlistId ? ` to ${findNode(playlistId)?.node.name}` : ''}`
      : 'No playable audio found there';
    toast(msg, { icon: res.ids.length ? 'music' : 'x', kind: res.ids.length ? '' : 'warn' });
    return res;
  } catch (err) {
    toast(`Import failed: ${err.message}`, { icon: 'x', kind: 'warn', timeout: 5000 });
  } finally {
    scanning--;
    if (!scanning) bus.emit('scan', { phase: 'done' });
  }
}

export async function addFolders() { importPaths(await window.api.pickFolders()); }
export async function addFiles() { importPaths(await window.api.pickFiles(), { rememberFolders: false }); }
export async function addNetworkPath() {
  const hint = state.platform === 'win32' ? '\\\\NAS\\Music  or  Z:\\Music' : '/mnt/nas/music  or  /run/user/1000/gvfs/smb-share:server=nas,share=music';
  const p = await prompt('Add a network or local path', { placeholder: hint, ok: 'Add' });
  if (!p) return;
  if (!(await window.api.pathExists(p))) {
    return toast(state.platform === 'win32' ? 'Path not reachable — check the share name and that you are signed in to it' : 'Path not found — mount the share first (e.g. via your file manager or /etc/fstab)', { icon: 'x', kind: 'warn', timeout: 6000 });
  }
  importPaths([p]);
}

export async function rescanLibrary() {
  const folders = state.settings.folders || [];
  if (!folders.length) return toast('No library folders yet — add one first', { icon: 'folder' });
  bus.emit('scan', { phase: 'start' });
  try {
    const res = await window.api.rescan(folders);
    if (res.changed.length) addTracks(res.changed);
    if (res.removed.length) removeTracks(res.removed);
    toast(`Rescan complete · ${plural(res.changed.length, 'update')} · ${plural(res.removed.length, 'removal')}`, { icon: 'refresh' });
  } finally {
    bus.emit('scan', { phase: 'done' });
  }
}
