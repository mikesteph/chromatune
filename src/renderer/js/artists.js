// Artists panel: every artist in the library, searchable and sortable; click to open, double-click to play.
import { state, bus, setView, setSetting } from './store.js';
import { queue } from './player.js';
import { playView, shuffleLibrary } from './actions.js';
import { VirtualList } from './virtuallist.js';
import { h, $, esc, plural, coverUrl, collator } from './util.js';
import { icon } from './icons.js';
import { showMenu, dragBadge } from './ui.js';

let root, listEl, vlist, filter = '', artists = [];

export function initArtists() {
  root = $('#artists');
  const input = h('input.panel-search', { placeholder: 'Filter artists…', spellcheck: 'false' });
  input.addEventListener('input', () => { filter = input.value.toLowerCase(); refresh(); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { input.value = ''; filter = ''; refresh(); input.blur(); } });
  const sortBtn = h('button.icon-btn.sm', { title: 'Sort artists', html: icon('sort', 15) });
  sortBtn.addEventListener('click', (e) => {
    const r = sortBtn.getBoundingClientRect();
    const cur = state.settings.artistSort;
    showMenu(r.left, r.bottom + 4, [
      { label: 'Name (A–Z)', checked: cur === 'name', action: () => { setSetting('artistSort', 'name'); refresh(); } },
      { label: 'Most songs', checked: cur === 'songs', action: () => { setSetting('artistSort', 'songs'); refresh(); } },
      { label: 'Most played', checked: cur === 'plays', action: () => { setSetting('artistSort', 'plays'); refresh(); } },
    ]);
  });
  const head = h('div.panel-head', {},
    h('div.panel-title', {}, h('span', { html: icon('users', 16) }), h('span', { text: 'Artists' }), h('span.panel-count')),
    sortBtn);
  listEl = h('div.artist-list');
  root.append(head, h('div.panel-search-wrap', { html: icon('search', 14) }, input), listEl);
  vlist = new VirtualList(listEl, { rowHeight: 52, render: renderRow });
  listEl.addEventListener('click', (e) => {
    const row = e.target.closest('.vrow');
    if (!row) return;
    if (e.target.closest('.ar-play')) { const a = artists[+row.dataset.index]; return a ? playView({ type: 'artist', id: a.name }, { shuffle: true }) : shuffleLibrary(); }
    const a = artists[+row.dataset.index];
    setView(a ? { type: 'artist', id: a.name } : { type: 'all' });
  });
  listEl.addEventListener('dblclick', (e) => {
    const row = e.target.closest('.vrow');
    const a = row && artists[+row.dataset.index];
    if (a) playView({ type: 'artist', id: a.name });
  });
  listEl.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.vrow');
    const a = row && artists[+row.dataset.index];
    if (!a) return;
    e.preventDefault();
    showMenu(e.clientX, e.clientY, [
      { header: a.name },
      { label: 'Play', icon: 'play', action: () => playView({ type: 'artist', id: a.name }, { shuffle: false }) },
      { label: 'Shuffle', icon: 'shuffle', action: () => playView({ type: 'artist', id: a.name }, { shuffle: true }) },
      { label: 'Add to queue', icon: 'listEnd', action: () => queue.enqueue(a.ids) },
    ]);
  });
  listEl.addEventListener('dragstart', (e) => {
    const row = e.target.closest('.vrow');
    const a = row && artists[+row.dataset.index];
    if (!a) return e.preventDefault();
    e.dataTransfer.setData('application/x-ct-tracks', JSON.stringify(a.ids));
    e.dataTransfer.effectAllowed = 'copy';
    dragBadge(e, a.name);
  });
  bus.on('library', refresh);
  bus.on('view', () => vlist.refresh());
  queue.on('track', () => vlist.refresh());
  refresh();
}

function refresh() {
  artists = [...state.artists.values()];
  if (filter) artists = artists.filter((a) => a.name.toLowerCase().includes(filter));
  const s = state.settings.artistSort;
  const plays = (a) => a._plays ?? (a._plays = a.ids.reduce((n, id) => n + (state.tracks.get(id)?.plays || 0), 0));
  if (s === 'songs') artists.sort((a, b) => b.ids.length - a.ids.length || collator.compare(a.name, b.name));
  else if (s === 'plays') { artists.forEach((a) => { a._plays = undefined; }); artists.sort((a, b) => plays(b) - plays(a) || collator.compare(a.name, b.name)); }
  else artists.sort((a, b) => collator.compare(a.name.replace(/^the\s+/i, ''), b.name.replace(/^the\s+/i, '')));
  // Row 0 is "All artists" (unless filtering).
  if (!filter) artists.unshift(null);
  root.querySelector('.panel-count').textContent = state.artists.size ? state.artists.size.toLocaleString() : '';
  vlist.setCount(artists.length);
}

const initials = (n) => n.replace(/^the\s+/i, '').split(/\s+/).slice(0, 2).map((w) => w[0] || '').join('').toUpperCase();

function renderRow(i, row) {
  const a = artists[i];
  row.draggable = !!a;
  const playingArtist = queue.track && (queue.track.albumArtist || queue.track.artist);
  if (!a) {
    row.className = `vrow artist-row all${state.view.type === 'all' ? ' active' : ''}`;
    row.innerHTML = `<span class="ar-avatar all">${icon('library', 18)}</span><span class="ar-text"><span class="ar-name">All artists</span><span class="ar-meta">${plural(state.tracks.size, 'song')}</span></span><button class="ar-play" title="Shuffle library">${icon('shuffle', 14)}</button>`;
    return;
  }
  const active = state.view.type === 'artist' && state.view.id === a.name;
  row.className = `vrow artist-row${active ? ' active' : ''}${playingArtist === a.name ? ' playing' : ''}`;
  const hue = [...a.name].reduce((s, c) => s + c.charCodeAt(0), 0) % 6 + 1;
  const avatar = a.cover
    ? `<img class="ar-avatar" src="${coverUrl(a.cover, true)}" loading="lazy" draggable="false">`
    : `<span class="ar-avatar ph" style="--c: var(--viz${hue})">${esc(initials(a.name))}</span>`;
  row.innerHTML = `${avatar}<span class="ar-text"><span class="ar-name">${esc(a.name)}</span><span class="ar-meta">${plural(a.albums.size, 'album')} · ${plural(a.ids.length, 'song')}</span></span><button class="ar-play" title="Shuffle ${esc(a.name)}">${icon('shuffle', 14)}</button>`;
}
