// Theme palettes and the token engine that paints every sector of the UI.
import { mix, alpha, contrast, readableOn, luminance, ensureContrast } from './util.js';

const T = (id, name, group, bg, bg2, bg3, fg, muted, accent, accent2, c, extra = {}) => ({
  id, name, group, bg, bg2, bg3, fg, muted, accent, accent2,
  colors: { red: c[0], green: c[1], yellow: c[2], blue: c[3], magenta: c[4], cyan: c[5], orange: c[6] },
  ...extra,
});

// Palettes inspired by the themes that ship with Omarchy, plus a few extras.
export const THEMES = [
  T('tokyo-night', 'Tokyo Night', 'Omarchy', '#1a1b26', '#16161e', '#24283b', '#c0caf5', '#565f89', '#7aa2f7', '#bb9af7',
    ['#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#ff9e64']),
  T('catppuccin', 'Catppuccin', 'Omarchy', '#1e1e2e', '#181825', '#313244', '#cdd6f4', '#7f849c', '#cba6f7', '#f5c2e7',
    ['#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#fab387']),
  T('catppuccin-latte', 'Catppuccin Latte', 'Omarchy', '#eff1f5', '#e6e9ef', '#ccd0da', '#4c4f69', '#8c8fa1', '#8839ef', '#1e66f5',
    ['#d20f39', '#40a02b', '#df8e1d', '#1e66f5', '#ea76cb', '#179299', '#fe640b']),
  T('ethereal', 'Ethereal', 'Omarchy', '#060b1e', '#03061a', '#151b38', '#ffcead', '#8a7f9f', '#7d82d9', '#c89dc1',
    ['#ed5b5a', '#92a593', '#e9bb4f', '#7d82d9', '#c89dc1', '#a3bfd1', '#faaaa9']),
  T('everforest', 'Everforest', 'Omarchy', '#2d353b', '#232a2e', '#3d484d', '#d3c6aa', '#859289', '#a7c080', '#83c092',
    ['#e67e80', '#a7c080', '#dbbc7f', '#7fbbb3', '#d699b6', '#83c092', '#e69875']),
  T('flexoki-light', 'Flexoki Light', 'Omarchy', '#fffcf0', '#f2f0e5', '#e6e4d9', '#100f0f', '#6f6e69', '#205ea6', '#bc5215',
    ['#af3029', '#66800b', '#ad8301', '#205ea6', '#a02f6f', '#24837b', '#bc5215']),
  T('gruvbox', 'Gruvbox', 'Omarchy', '#282828', '#1d2021', '#3c3836', '#ebdbb2', '#928374', '#fabd2f', '#fe8019',
    ['#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#fe8019']),
  T('hackerman', 'Hackerman', 'Omarchy', '#0b0c16', '#07080f', '#161a2c', '#ddf7ff', '#6a7a99', '#82fb9c', '#7cf8f7',
    ['#ff5f87', '#82fb9c', '#e9f87c', '#829dd4', '#a682e8', '#7cf8f7', '#ffb86c']),
  T('kanagawa', 'Kanagawa', 'Omarchy', '#1f1f28', '#16161d', '#2a2a37', '#dcd7ba', '#727169', '#7e9cd8', '#ffa066',
    ['#e46876', '#98bb6c', '#e6c384', '#7e9cd8', '#957fb8', '#7aa89f', '#ffa066']),
  T('matte-black', 'Matte Black', 'Omarchy', '#121212', '#0b0b0b', '#1e1e1e', '#d4d4d4', '#6f6f6f', '#e68e0d', '#d35f5f',
    ['#d35f5f', '#a4b07c', '#ffc107', '#8aa2c0', '#b98eb3', '#8fb8b0', '#e68e0d']),
  T('nord', 'Nord', 'Omarchy', '#2e3440', '#272c36', '#3b4252', '#eceff4', '#7b88a1', '#88c0d0', '#81a1c1',
    ['#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#d08770']),
  T('osaka-jade', 'Osaka Jade', 'Omarchy', '#111c18', '#0b1411', '#1e2f28', '#c1c497', '#53685b', '#2dd5b7', '#e5c736',
    ['#ff5345', '#549e6a', '#e5c736', '#509475', '#d2689c', '#2dd5b7', '#db9f9c']),
  T('ristretto', 'Ristretto', 'Omarchy', '#2c2525', '#211c1c', '#403838', '#e6d9db', '#857575', '#f9cc6c', '#fd6883',
    ['#fd6883', '#adda78', '#f9cc6c', '#a8a9eb', '#d68cbb', '#85dacc', '#f38d70']),
  T('rose-pine-dawn', 'Rosé Pine Dawn', 'Omarchy', '#faf4ed', '#f2e9e1', '#dfdad9', '#575279', '#9893a5', '#d7827e', '#907aa9',
    ['#b4637a', '#286983', '#ea9d34', '#56949f', '#907aa9', '#56949f', '#d7827e']),

  T('rose-pine', 'Rosé Pine', 'Extras', '#191724', '#13111e', '#26233a', '#e0def4', '#6e6a86', '#ebbcba', '#c4a7e7',
    ['#eb6f92', '#31748f', '#f6c177', '#9ccfd8', '#c4a7e7', '#9ccfd8', '#ebbcba']),
  T('dracula', 'Dracula', 'Extras', '#282a36', '#21222c', '#343746', '#f8f8f2', '#6272a4', '#bd93f9', '#ff79c6',
    ['#ff5555', '#50fa7b', '#f1fa8c', '#8be9fd', '#ff79c6', '#8be9fd', '#ffb86c']),
  T('synthwave', "Synthwave '84", 'Extras', '#241b2f', '#1a1423', '#34294f', '#f4eee4', '#848bbd', '#ff7edb', '#36f9f6',
    ['#fe4450', '#72f1b8', '#fede5d', '#36f9f6', '#ff7edb', '#36f9f6', '#f97e72']),
  T('cyberpunk', 'Neon Cyberpunk', 'Extras', '#0d0221', '#080116', '#1b0b3a', '#f2f2ff', '#7a6fa8', '#00f0ff', '#ff2a6d',
    ['#ff2a6d', '#05ffa1', '#f9f002', '#01c5c4', '#d300c5', '#00f0ff', '#ff8b00']),
  T('one-dark', 'One Dark', 'Extras', '#282c34', '#21252b', '#2c313c', '#d7dae0', '#7f848e', '#61afef', '#c678dd',
    ['#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#d19a66']),
  T('monokai', 'Monokai Pro', 'Extras', '#2d2a2e', '#221f22', '#403e41', '#fcfcfa', '#939293', '#ffd866', '#ff6188',
    ['#ff6188', '#a9dc76', '#ffd866', '#78dce8', '#ab9df2', '#78dce8', '#fc9867']),
  T('solarized', 'Solarized Dark', 'Extras', '#002b36', '#00212b', '#073642', '#eee8d5', '#839496', '#268bd2', '#2aa198',
    ['#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#cb4b16']),
  T('ocean', 'Deep Ocean', 'Extras', '#0f111a', '#090b10', '#1a1c25', '#c3cee3', '#4b526d', '#84ffff', '#c792ea',
    ['#ff5370', '#c3e88d', '#ffcb6b', '#82aaff', '#c792ea', '#89ddff', '#f78c6c']),
  T('sakura', 'Sakura', 'Extras', '#fdf6f8', '#f6e8ee', '#ecd5df', '#3f2a36', '#9a7c8a', '#e0578c', '#7f6bd6',
    ['#d6336c', '#5c9e57', '#c99a2e', '#4f7fd9', '#b04fc4', '#2e9ea3', '#e07b39']),
  T('vantablack', 'Vantablack', 'Extras', '#000000', '#000000', '#111111', '#e8e8e8', '#666666', '#ffffff', '#9a9a9a',
    ['#ff4d4d', '#7dff9a', '#ffe066', '#6fa8ff', '#d88bff', '#66f0ff', '#ff9f43']),
];

// Every user-editable sector of the interface.
export const SECTORS = [
  { key: 'titlebar', label: 'Title bar', group: 'Areas' },
  { key: 'sidebar', label: 'Library sidebar', group: 'Areas' },
  { key: 'artists', label: 'Artists panel', group: 'Areas' },
  { key: 'main', label: 'Song list', group: 'Areas' },
  { key: 'header', label: 'List header', group: 'Areas' },
  { key: 'nowplaying', label: 'Now playing panel', group: 'Areas' },
  { key: 'player', label: 'Player bar', group: 'Areas' },
  { key: 'vizbg', label: 'Visualizer backdrop', group: 'Areas' },
  { key: 'surface', label: 'Menus & dialogs', group: 'Areas' },
  { key: 'fg', label: 'Text', group: 'Text & accents' },
  { key: 'muted', label: 'Secondary text', group: 'Text & accents' },
  { key: 'accent', label: 'Accent', group: 'Text & accents' },
  { key: 'accent2', label: 'Accent 2', group: 'Text & accents' },
  { key: 'border', label: 'Borders', group: 'Text & accents' },
  { key: 'like', label: 'Heart / like', group: 'Text & accents' },
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ key: `viz${n}`, label: `Spectrum ${n}`, group: 'Visualizer' })),
];
const AREA_KEYS = SECTORS.filter((s) => s.group === 'Areas').map((s) => s.key);

// Resolve a theme to one concrete colour per sector (overrides win).
export function resolve(theme, overrides = {}) {
  const dark = luminance(theme.bg) < 0.4;
  const c = theme.colors;
  // Six distinct spectrum colours, starting from the accents.
  const viz = theme.viz || [...new Set([theme.accent, theme.accent2, c.magenta, c.cyan, c.yellow, c.orange, c.green, c.red, c.blue])].slice(0, 6);
  const base = {
    titlebar: theme.bg2,
    sidebar: theme.bg2,
    artists: mix(theme.bg, theme.bg2, 0.5),
    main: theme.bg,
    header: theme.bg,
    nowplaying: theme.bg2,
    player: dark ? mix(theme.bg2, '#000000', 0.15) : theme.bg2,
    vizbg: dark ? mix(theme.bg2, '#000000', 0.35) : mix(theme.bg2, theme.bg3, 0.5),
    surface: dark ? mix(theme.bg3, theme.bg, 0.35) : '#ffffff',
    fg: theme.fg,
    muted: theme.muted,
    accent: theme.accent,
    accent2: theme.accent2 || c.magenta,
    border: mix(theme.bg, theme.fg, dark ? 0.1 : 0.14),
    like: c.red,
    ...Object.fromEntries(viz.map((v, i) => [`viz${i + 1}`, v])),
    ...(theme.sectors || {}),
  };
  return { ...base, ...overrides, dark, colors: c };
}

// Turn resolved sector colours into CSS custom properties.
export function tokens(r) {
  const v = {};
  const fg = r.fg, muted = r.muted, accent = r.accent;
  for (const key of AREA_KEYS) {
    const bg = r[key];
    const darkBg = luminance(bg) < 0.4;
    const okFg = contrast(fg, bg) >= 4.5 ? fg : readableOn(bg);
    const okMuted = contrast(muted, bg) >= 2.6 ? muted : mix(okFg, bg, 0.4);
    v[`--${key}-bg`] = bg;
    v[`--${key}-fg`] = okFg;
    v[`--${key}-muted`] = okMuted;
    v[`--${key}-hover`] = mix(bg, okFg, darkBg ? 0.06 : 0.05);
    v[`--${key}-active`] = mix(bg, accent, darkBg ? 0.2 : 0.16);
    v[`--${key}-line`] = mix(bg, okFg, darkBg ? 0.09 : 0.12);
    v[`--${key}-accent`] = ensureContrast(accent, bg, 2.6);
  }
  v['--fg'] = fg;
  v['--muted'] = muted;
  v['--accent'] = accent;
  v['--accent-2'] = r.accent2;
  v['--accent-fg'] = readableOn(accent);
  v['--accent-soft'] = alpha(accent, 0.16);
  v['--accent-glow'] = alpha(accent, r.dark ? 0.45 : 0.3);
  v['--border'] = r.border;
  v['--like'] = r.like;
  v['--row-alt'] = mix(r.main, fg, r.dark ? 0.018 : 0.025);
  v['--selection'] = mix(r.main, accent, r.dark ? 0.24 : 0.18);
  v['--scrollbar'] = alpha(fg, 0.18);
  v['--scrollbar-hover'] = alpha(accent, 0.6);
  v['--shadow'] = r.dark ? 'rgba(0,0,0,.55)' : 'rgba(40,30,60,.18)';
  v['--input-bg'] = mix(r.surface, fg, r.dark ? 0.06 : 0.03);
  v['--overlay'] = r.dark ? 'rgba(0,0,0,.55)' : 'rgba(30,20,40,.3)';
  for (const [k, col] of Object.entries(r.colors)) v[`--c-${k}`] = col;
  for (let i = 1; i <= 6; i++) v[`--viz${i}`] = r[`viz${i}`];
  return v;
}

export function themeFromOmarchy(o) {
  const dark = luminance(o.bg) < 0.4;
  return {
    id: 'omarchy-live',
    name: `System · ${o.name.replace(/[-_]/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())}`,
    group: 'Live',
    bg: o.bg,
    bg2: mix(o.bg, dark ? '#000000' : o.fg, dark ? 0.22 : 0.05),
    bg3: mix(o.bg, o.fg, dark ? 0.1 : 0.12),
    fg: o.fg,
    muted: o.muted && contrast(o.muted, o.bg) > 2 ? o.muted : mix(o.fg, o.bg, 0.45),
    accent: o.accent || o.blue || '#7aa2f7',
    accent2: o.magenta || o.cyan || '#bb9af7',
    colors: {
      red: o.red || '#f7768e', green: o.green || '#9ece6a', yellow: o.yellow || '#e0af68', blue: o.blue || '#7aa2f7',
      magenta: o.magenta || '#bb9af7', cyan: o.cyan || '#7dcfff', orange: o.orange || o.yellow || '#ff9e64',
    },
  };
}

let current = null;
export function applyTheme(theme, overrides = {}) {
  const r = resolve(theme, overrides);
  const vars = tokens(r);
  const root = document.documentElement;
  for (const [k, val] of Object.entries(vars)) root.style.setProperty(k, val);
  root.dataset.scheme = r.dark ? 'dark' : 'light';
  current = r;
  window.dispatchEvent(new CustomEvent('themechange', { detail: r }));
  return r;
}
export const currentTheme = () => current;
export const vizPalette = () => (current ? [1, 2, 3, 4, 5, 6].map((i) => current[`viz${i}`]) : ['#7aa2f7', '#bb9af7', '#7dcfff', '#9ece6a', '#e0af68', '#ff9e64']);
