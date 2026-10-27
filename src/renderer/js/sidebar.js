// Left sidebar: browse shortcuts and the library tree (All Songs → nested playlist folders → playlists).
import { state, bus, setView, createNode, deleteNode, renameNode, moveNode, addToPlaylist, findNode, nodeTrackIds, savePlaylists } from './store.js';
import { queue } from './player.js';
import { playView, importPaths, addFolders, addFiles, addNetworkPath, rescanLibrary, newPlaylistWith } from './actions.js';
import { h, $, plural, fmtLong } from './util.js';
import { icon } from './icons.js';
import { showMenu, toast, confirmDialog } from './ui.js';

const BROWSE = [
  { type: 'albums', label: 'Albums', icon: 'disc' },
  { type: 'liked', label: 'Liked Songs', icon: 'heart' },
  { type: 'recent', label: 'Recently Added', icon: 'clock' },
  { type: 'mostplayed', label: 'Most Played', icon: 'flame' },
  { type: 'history', label: 'Recently Played', icon: 'history' },
];

let root, treeEl, renaming = null;

export function initSidebar() {
  root = $('#sidebar');
  const r = () => render();
  bus.on('playlists', r);
  bus.on('library', r);
  bus.on('view', r);
  queue.on('change', r);
  bus.on('setting', (k) => { if (k === 'shuffle') r(); });
  render();
}

const isActive = (type, id) => state.view.type === type && (id == null || state.view.id === id);
const isPlayingCtx = (kind, id) => queue.current && queue.context.kind === kind && (id == null || queue.context.id === id);

function render() {
  const scroll = treeEl?.scrollTop || 0;
  root.innerHTML = '';
  const browse = h('nav.sb-section', {}, h('div.sb-title', {}, h('span', { text: 'Browse' })),
    BROWSE.map((b) => h('div.sb-item', {
      class: `sb-item${isActive(b.type) ? ' active' : ''}`,
      html: `${icon(b.icon, 17)}<span class="sb-label">${b.label}</span>`,
      onClick: () => setView({ type: b.type }),
    })));

  const actions = h('div.sb-actions', {},
    h('button.icon-btn.sm', { title: 'New playlist', html: icon('playlistPlus', 16), onClick: () => startCreate('playlist') }),
    h('button.icon-btn.sm', { title: 'New folder', html: icon('folderPlus', 16), onClick: () => startCreate('folder') }));

  treeEl = h('div.tree', {});
  treeEl.append(rootRow());
  const kids = h('div.tree-children.root-children', {});
  renderNodes(state.playlists, kids, 1);
  if (!state.playlists.length) {
    kids.append(h('div.tree-hint', { text: 'No playlists yet' }));
  }
  treeEl.append(kids);

  const lib = h('section.sb-section.grow', {}, h('div.sb-title', {}, h('span', { text: 'Library' }), actions), treeEl);

  const total = [...state.tracks.values()].reduce((s, t) => s + (t.duration || 0), 0);
  const footer = h('div.sb-footer', {},
    h('button.btn.sm.ghost', { title: `${plural(state.tracks.size, 'song')} · ${plural(state.artists.size, 'artist')} · ${fmtLong(total)}`, html: `${icon('plus', 15)}<span>Add music</span>`, onClick: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      showMenu(r.left, r.top - 150, [
        { label: 'Add folder…', icon: 'folderPlus', action: addFolders },
        { label: 'Add files…', icon: 'filePlus', action: addFiles },
        { label: 'Add network / custom path…', icon: 'server', action: addNetworkPath },
        { sep: true },
        { label: 'Rescan library folders', icon: 'refresh', action: rescanLibrary },
      ]);
    } }));

  root.append(browse, lib, footer);
  treeEl.scrollTop = scroll;
  if (renaming) {
    const input = root.querySelector('.rename-input');
    input?.focus();
    input?.select();
  }
}

function rootRow() {
  const row = h('div.tree-row.root', {
    class: `tree-row root${isActive('all') ? ' active' : ''}${isPlayingCtx('all') ? ' playing' : ''}`,
    html: `<span class="tr-ic">${icon('library', 17)}</span><span class="tr-name">All Songs</span><span class="tr-count">${state.tracks.size.toLocaleString()}</span>`,
  });
  row.append(shuffleBtn(() => playView({ type: 'all' }, { shuffle: true }), 'Shuffle the entire library'));
  row.addEventListener('click', () => setView({ type: 'all' }));
  row.addEventListener('dblclick', () => playView({ type: 'all' }));
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showMenu(e.clientX, e.clientY, [
      { label: 'Play all', icon: 'play', action: () => playView({ type: 'all' }, { shuffle: false }) },
      { label: 'Shuffle all', icon: 'shuffle', action: () => playView({ type: 'all' }, { shuffle: true }) },
      { sep: true },
      { label: 'New playlist', icon: 'playlistPlus', action: () => startCreate('playlist') },
      { label: 'New folder', icon: 'folderPlus', action: () => startCreate('folder') },
    ]);
  });
  // Dropping a node onto the root moves it to the top level; dropping files imports them.
  dropTarget(row, {
    node: (id) => { const f = findNode(id); if (f) { f.list.splice(f.list.indexOf(f.node), 1); state.playlists.push(f.node); savePlaylists(); bus.emit('playlists'); } },
    files: (paths) => importPaths(paths),
  });
  return row;
}

function shuffleBtn(fn, title) {
  return h('button.tr-shuffle', {
    title, html: icon('shuffle', 14),
    onClick: (e) => { e.stopPropagation(); fn(); },
  });
}

function renderNodes(nodes, container, depth) {
  for (const n of nodes) {
    container.append(nodeRow(n, depth));
    if (n.type === 'folder' && n.open) {
      const kids = h('div.tree-children', { style: { '--depth': depth } });
      if (!n.children.length) kids.append(h('div.tree-empty', { style: { paddingLeft: `${16 + (depth + 1) * 14}px` }, text: 'Empty folder — drop playlists here' }));
      renderNodes(n.children, kids, depth + 1);
      container.append(kids);
    }
  }
}

function nodeRow(n, depth) {
  const folder = n.type === 'folder';
  const count = nodeTrackIds(n).length;
  const row = h('div.tree-row', {
    class: `tree-row${isActive(n.type, n.id) ? ' active' : ''}${isPlayingCtx(n.type, n.id) ? ' playing' : ''}`,
    style: { paddingLeft: `${6 + depth * 14}px` },
    draggable: renaming === n.id ? null : 'true',
    dataset: { id: n.id },
  });
  const chev = h('span.tr-chev', { html: folder ? icon(n.open ? 'chevronDown' : 'chevronRight', 14) : '' });
  if (folder) chev.addEventListener('click', (e) => { e.stopPropagation(); n.open = !n.open; savePlaylists(); render(); });
  row.append(chev, h('span.tr-ic', { html: icon(folder ? (n.open ? 'folderOpen' : 'folder') : 'playlist', 16) }));
  if (renaming === n.id) {
    const input = h('input.rename-input', { value: n.name, spellcheck: 'false' });
    const commit = (ok) => { if (renaming !== n.id) return; renaming = null; if (ok) renameNode(n.id, input.value); else render(); };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') commit(true); if (e.key === 'Escape') commit(false); });
    input.addEventListener('blur', () => commit(true));
    input.addEventListener('click', (e) => e.stopPropagation());
    row.append(input);
  } else {
    row.append(h('span.tr-name', { text: n.name }), h('span.tr-count', { text: count ? count.toLocaleString() : '' }));
    row.append(shuffleBtn(() => playView({ type: n.type, id: n.id }, { shuffle: true }), `Shuffle ${folder ? 'everything in' : ''} “${n.name}”`));
  }
  row.addEventListener('click', () => setView({ type: n.type, id: n.id }));
  row.addEventListener('dblclick', (e) => { if (!e.target.closest('.tr-chev')) playView({ type: n.type, id: n.id }); });
  row.addEventListener('contextmenu', (e) => nodeMenu(e, n));
  row.addEventListener('keydown', (e) => { if (e.key === 'F2') { renaming = n.id; render(); } });
  row.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('application/x-ct-node', n.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  dropTarget(row, {
    node: (id, where) => moveNode(id, n.id, where),
    tracks: (ids) => {
      if (folder) createNode('playlist', 'New playlist', n.id, ids) && toast(`Created a playlist in “${n.name}”`, { icon: 'playlist' });
      else { const c = addToPlaylist(n.id, ids); toast(c ? `Added ${plural(c, 'song')} to ${n.name}` : `Already in ${n.name}`, { icon: 'playlist' }); }
    },
    files: (paths) => importPaths(paths, { playlistId: n.id }),
    folder,
  });
  return row;
}

// Wire up a tree row as a drop target for nodes (reorder/nest), songs and external files.
function dropTarget(row, { node, tracks, files, folder = false }) {
  const zone = (e) => {
    const r = row.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    if (row.classList.contains('root')) return 'inside';
    if (folder) return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside';
    return y < 0.5 ? 'before' : 'after';
  };
  const clear = () => row.classList.remove('drop-before', 'drop-after', 'drop-inside', 'drop-target');
  row.addEventListener('dragover', (e) => {
    const t = e.dataTransfer.types;
    if (t.includes('application/x-ct-node') && node) {
      e.preventDefault(); e.stopPropagation();
      clear(); row.classList.add(`drop-${zone(e)}`);
    } else if ((t.includes('application/x-ct-tracks') && tracks) || (t.includes('Files') && files)) {
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = 'copy';
      clear(); row.classList.add('drop-target');
    }
  });
  row.addEventListener('dragleave', clear);
  row.addEventListener('drop', (e) => {
    const where = zone(e);
    clear();
    const t = e.dataTransfer.types;
    e.preventDefault(); e.stopPropagation();
    document.body.classList.remove('dragging-files');
    if (t.includes('application/x-ct-node')) node?.(e.dataTransfer.getData('application/x-ct-node'), where);
    else if (t.includes('Files') && e.dataTransfer.files.length) files?.([...e.dataTransfer.files].map((f) => window.api.pathForFile(f)).filter(Boolean));
    else if (t.includes('application/x-ct-tracks')) tracks?.(JSON.parse(e.dataTransfer.getData('application/x-ct-tracks') || '[]'));
  });
}

function startCreate(type, parentId = null) {
  renaming = createNode(type, type === 'folder' ? 'New folder' : 'New playlist', parentId).id;
  render();
}

function nodeMenu(e, n) {
  e.preventDefault();
  e.stopPropagation();
  const folder = n.type === 'folder';
  const ids = nodeTrackIds(n);
  showMenu(e.clientX, e.clientY, [
    { header: n.name },
    { label: 'Play', icon: 'play', action: () => playView({ type: n.type, id: n.id }, { shuffle: false }) },
    { label: folder ? 'Shuffle everything inside' : 'Shuffle', icon: 'shuffle', action: () => playView({ type: n.type, id: n.id }, { shuffle: true }) },
    { label: 'Add to queue', icon: 'listEnd', disabled: !ids.length, action: () => { queue.enqueue(ids); toast(`Queued ${plural(ids.length, 'song')}`, { icon: 'queue' }); } },
    { sep: true },
    folder && { label: 'New playlist inside', icon: 'playlistPlus', action: () => startCreate('playlist', n.id) },
    folder && { label: 'New folder inside', icon: 'folderPlus', action: () => startCreate('folder', n.id) },
    !folder && { label: 'Duplicate', icon: 'squares', action: () => { const f = findNode(n.id); const copy = createNode('playlist', `${n.name} copy`, f.parent?.id, n.ids); renaming = copy.id; render(); } },
    { label: 'Rename', icon: 'pencil', hint: 'F2', action: () => { renaming = n.id; render(); } },
    { label: 'Export as M3U…', icon: 'download', disabled: !ids.length, action: async () => { if (await window.api.exportPlaylist(n.name, ids)) toast('Playlist exported', { icon: 'download' }); } },
    !folder && { label: 'Save selection as new playlist…', icon: 'playlistPlus', disabled: !state.selection.size, action: () => newPlaylistWith([...state.selection]) },
    { sep: true },
    { label: folder ? 'Delete folder' : 'Delete playlist', icon: 'trash', danger: true, action: async () => {
      const msg = folder ? `Delete “${n.name}” and everything inside it? Songs stay in your library.` : `Delete “${n.name}”? Songs stay in your library.`;
      if (await confirmDialog('Delete', msg)) {
        if (state.view.id === n.id) setView({ type: 'all' });
        deleteNode(n.id);
      }
    } },
  ]);
}

