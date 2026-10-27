// Settings dialog: library folders, appearance, visualizer, playback and shortcuts.
import { state, setSetting, removeTracks } from './store.js';
import { h, plural } from './util.js';
import { icon } from './icons.js';
import { modal, confirmDialog, toast } from './ui.js';
import { addFolders, addNetworkPath, rescanLibrary, importPaths } from './actions.js';
import { VIZ_MODES } from './visualizer.js';
import { openThemePicker } from './themepicker.js';

export const SHORTCUTS = [
  ['Space', 'Play / pause'], ['N / P', 'Next / previous song'], ['→ / ←', 'Seek ±5 s (Shift: ±30 s)'],
  ['+ / −', 'Volume up / down'], ['M', 'Mute'], ['S', 'Toggle shuffle'], ['R', 'Cycle repeat'], ['L', 'Like current song'],
  ['V', 'Fullscreen visualizer'], ['B', 'Next visualizer mode'], ['T', 'Color palette picker'], ['[ / ]', 'Previous / next theme'],
  ['Ctrl+F', 'Search'], ['Ctrl+L', 'Reveal playing song'], ['Ctrl+Shift+S', 'Shuffle entire library'], ['Ctrl+, ', 'Settings'],
  ['Ctrl+A', 'Select all (in list)'], ['Enter', 'Play selected'], ['Delete', 'Remove selected'], ['F2', 'Rename playlist / folder'],
];

export function openSettings() {
  const s = state.settings;
  const section = (title, ...kids) => h('section.set-section', {}, h('h3', { text: title }), ...kids);
  const row = (label, desc, control) => h('div.set-row', {}, h('div.set-text', {}, h('b', { text: label }), desc ? h('small', { text: desc }) : null), control);
  const sw = (key, after) => {
    const input = h('input', { type: 'checkbox', checked: !!s[key] });
    input.addEventListener('change', () => { setSetting(key, input.checked); after?.(); });
    return h('label.switch', {}, input, h('span'));
  };
  const select = (key, options, after) => {
    const sel = h('select.select', {}, options.map(([v, l]) => h('option', { value: v, text: l, selected: s[key] === v })));
    sel.addEventListener('change', () => { setSetting(key, sel.value); after?.(); });
    return sel;
  };

  const folderList = h('div.folder-list');
  const renderFolders = () => {
    folderList.innerHTML = '';
    const folders = state.settings.folders || [];
    if (!folders.length) folderList.append(h('div.muted.small', { text: 'No folders yet. Songs you drag in are still kept — folders are only needed for rescans.' }));
    for (const f of folders) {
      const net = /^\\\\|^\/\/|\/gvfs\/|^\/(mnt|media|net)\//.test(f);
      folderList.append(h('div.folder-row', {},
        h('span', { html: icon(net ? 'server' : 'folder', 16) }),
        h('span.fr-path', { text: f, title: f }),
        h('button.icon-btn.sm', { title: 'Rescan this folder', html: icon('refresh', 14), onClick: () => importPaths([f]) }),
        h('button.icon-btn.sm', { title: 'Stop watching this folder', html: icon('x', 14), onClick: async () => {
          const under = [...state.tracks.values()].filter((t) => t.path.startsWith(f));
          const drop = under.length && await confirmDialog('Remove folder', `Also remove the ${plural(under.length, 'song')} from this folder from your library?`, { ok: 'Remove songs too', danger: true });
          if (drop) removeTracks(under.map((t) => t.id));
          setSetting('folders', state.settings.folders.filter((x) => x !== f));
          renderFolders();
        } })));
    }
  };
  renderFolders();

  const sens = h('input.range', { type: 'range', min: '0.4', max: '2.5', step: '0.05', value: String(s.vizSensitivity) });
  sens.addEventListener('input', () => setSetting('vizSensitivity', +sens.value));

  const body = h('div.settings', {},
    section('Library',
      folderList,
      h('div.row.wrap', {},
        h('button.btn', { html: `${icon('folderPlus', 15)}<span>Add folder</span>`, onClick: async () => { await addFolders(); renderFolders(); } }),
        h('button.btn', { html: `${icon('server', 15)}<span>Add network path</span>`, onClick: async () => { await addNetworkPath(); renderFolders(); } }),
        h('button.btn', { html: `${icon('refresh', 15)}<span>Rescan all</span>`, onClick: rescanLibrary })),
      h('p.tiny.muted', { html: state.platform === 'win32'
        ? 'Network shares: use a UNC path like <code>\\\\NAS\\Music</code> or a mapped drive letter. You can also drag folders straight out of Explorer’s Network view.'
        : 'Network shares: mount them first (file manager/gvfs, <code>/etc/fstab</code>, autofs) then add the mount path, or drag the folder in from your file manager.' })),
    section('Appearance',
      row('Color palette', 'Pick a theme or recolor any sector of the app.', h('button.btn', { html: `${icon('palette', 15)}<span>Open palette…</span>`, onClick: openThemePicker })),
      row('Font style', 'Mono matches the Omarchy terminal aesthetic.', select('font', [['sans', 'Sans'], ['mono', 'Monospace']], applyLook)),
      row('Density', 'Row height in song lists.', select('density', [['comfortable', 'Comfortable'], ['compact', 'Compact']], applyLook)),
      row('Show artists panel', null, sw('showArtists', applyLook)),
      row('Show now-playing panel', null, sw('showNowPlaying', applyLook))),
    section('Visualizer',
      row('Mode', null, select('vizMode', VIZ_MODES.map((m) => [m.id, m.name]))),
      row('Sensitivity', 'How strongly the visuals react to the music.', sens),
      row('Motion trails', 'Ghosting trails between frames.', sw('vizTrails'))),
    section('Playback',
      row('Resume where you left off', 'Restore the last song, position and queue on launch.', sw('resume'))),
    section('Keyboard shortcuts',
      h('div.shortcuts', {}, SHORTCUTS.map(([k, d]) => h('div.sc', {}, h('kbd', { text: k }), h('span', { text: d }))))),
    section('Data',
      h('p.tiny.muted', { text: 'Everything stays on this computer: your library, playlists and settings live in plain JSON files in the app’s data folder. Nothing is uploaded.' }),
      h('button.btn.danger', { html: `${icon('trash', 15)}<span>Clear library…</span>`, onClick: async () => {
        if (!(await confirmDialog('Clear library', 'Remove every song from Chromatune? Files on disk and your playlists’ structure are kept.', { ok: 'Clear' }))) return;
        removeTracks([...state.tracks.keys()]);
        toast('Library cleared', { icon: 'trash' });
      } })));

  modal({ title: 'Settings', body, wide: true, className: 'settings-modal' });
}

export function applyLook() {
  const s = state.settings;
  document.body.dataset.font = s.font;
  document.body.dataset.density = s.density;
  document.body.classList.toggle('no-artists', !s.showArtists);
  document.body.classList.toggle('no-nowplaying', !s.showNowPlaying);
  document.documentElement.style.setProperty('--sidebar-w', `${s.sidebarWidth}px`);
  document.documentElement.style.setProperty('--artists-w', `${s.artistsWidth}px`);
  document.documentElement.style.setProperty('--nowplaying-w', `${s.nowPlayingWidth}px`);
}

