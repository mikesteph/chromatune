// Reads the active Omarchy theme (Linux) so the player can follow the desktop palette live.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const THEME_DIR = path.join(os.homedir(), '.config', 'omarchy', 'current', 'theme');

function parseToml(text) {
  const out = {};
  let section = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#(?![0-9a-fA-F]{3,8}\b).*$/, '').trim();
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) { section = sec[1].trim(); continue; }
    const kv = line.match(/^([\w.-]+)\s*=\s*["']?(#|0x)([0-9a-fA-F]{6})["']?/);
    if (kv) out[(section ? section + '.' : '') + kv[1]] = '#' + kv[3].toLowerCase();
  }
  return out;
}

export async function readOmarchyTheme() {
  if (process.platform !== 'linux' || !fs.existsSync(THEME_DIR)) return null;
  let name = 'Omarchy';
  try { name = path.basename(await fsp.realpath(THEME_DIR)); } catch {}

  // Newer Omarchy themes ship colors.toml; older ones only alacritty.toml.
  for (const file of ['colors.toml', 'alacritty.toml']) {
    let c;
    try { c = parseToml(await fsp.readFile(path.join(THEME_DIR, file), 'utf8')); } catch { continue; }
    const pick = (...keys) => keys.map((k) => c[k]).find(Boolean);
    const bg = pick('background', 'colors.primary.background');
    const fg = pick('foreground', 'colors.primary.foreground');
    if (!bg || !fg) continue;
    return {
      name,
      bg, fg,
      accent: pick('accent', 'colors.normal.blue', 'color4'),
      muted: pick('color8', 'colors.bright.black'),
      red: pick('color1', 'colors.normal.red'),
      green: pick('color2', 'colors.normal.green'),
      yellow: pick('color3', 'colors.normal.yellow'),
      blue: pick('color4', 'colors.normal.blue'),
      magenta: pick('color5', 'colors.normal.magenta'),
      cyan: pick('color6', 'colors.normal.cyan'),
      orange: pick('color11', 'colors.bright.yellow'),
    };
  }
  return null;
}

// Polls the theme symlink; Omarchy swaps it on theme change, which fs.watch misses on some setups.
export function watchOmarchyTheme(onChange) {
  if (process.platform !== 'linux') return () => {};
  let last = '';
  const tick = async () => {
    let sig = '';
    try {
      const real = await fsp.realpath(THEME_DIR);
      const files = await Promise.all(['colors.toml', 'alacritty.toml'].map((f) => fsp.stat(path.join(real, f)).then((s) => s.mtimeMs, () => 0)));
      sig = real + files.join(':');
    } catch {}
    if (sig !== last) {
      const first = last === '';
      last = sig;
      if (!first) onChange(await readOmarchyTheme());
    }
  };
  tick();
  const timer = setInterval(tick, 3000);
  return () => clearInterval(timer);
}
