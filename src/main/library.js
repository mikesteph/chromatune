// Library storage, folder scanning, tag reading and album-art caching.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { nativeImage } from 'electron';
import { parseFile, selectCover } from 'music-metadata';

export const AUDIO_EXTS = new Set(['.mp3', '.flac', '.ogg', '.oga', '.opus', '.wav', '.m4a', '.aac', '.mp4', '.webm', '.weba']);
const PLAYLIST_EXTS = new Set(['.m3u', '.m3u8']);
const COVER_NAMES = /^(cover|folder|front|album|albumart|albumartsmall|artwork)[^\\/]*\.(jpe?g|png)$/i;

const hash = (s, n = 16) => crypto.createHash('sha1').update(s).digest('hex').slice(0, n);
export const trackId = (p) => hash(process.platform === 'win32' ? p.toLowerCase() : p);

// Write JSON atomically so a crash mid-save never corrupts the library.
async function writeJsonAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data));
  await fsp.rename(tmp, file);
}

async function readJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
}

// Run `fn` over `items` with bounded concurrency.
async function pool(items, limit, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

export class Library {
  constructor(dir) {
    this.dir = dir;
    this.coverDir = path.join(dir, 'covers');
    this.files = {
      library: path.join(dir, 'library.json'),
      settings: path.join(dir, 'settings.json'),
      playlists: path.join(dir, 'playlists.json'),
    };
    this.tracks = new Map();
    this.store = { settings: {}, playlists: [] };
    this.saveTimers = {};
    this.folderCoverCache = new Map();
  }

  async load() {
    await fsp.mkdir(this.coverDir, { recursive: true });
    const lib = await readJson(this.files.library, { tracks: [] });
    for (const t of lib.tracks || []) this.tracks.set(t.id, t);
    this.store.settings = await readJson(this.files.settings, {});
    this.store.playlists = await readJson(this.files.playlists, []);
  }

  state() {
    return { tracks: [...this.tracks.values()], settings: this.store.settings, playlists: this.store.playlists };
  }

  scheduleSave(key, delay = 800) {
    clearTimeout(this.saveTimers[key]);
    this.saveTimers[key] = setTimeout(() => this.saveNow(key), delay);
  }

  async saveNow(key) {
    clearTimeout(this.saveTimers[key]);
    const data = key === 'library' ? { version: 1, tracks: [...this.tracks.values()] } : this.store[key];
    try { await writeJsonAtomic(this.files[key], data); } catch (e) { console.error('save failed', key, e); }
  }

  async flush() {
    await Promise.all(Object.keys(this.files).map((k) => this.saveNow(k)));
  }

  setStore(key, data) {
    if (!(key in this.store)) return;
    this.store[key] = data;
    this.scheduleSave(key);
  }

  updateTracks(patches) {
    const allowed = ['plays', 'lastPlayed', 'liked', 'rating', 'duration'];
    for (const p of patches) {
      const t = this.tracks.get(p.id);
      if (!t) continue;
      for (const k of allowed) if (k in p) t[k] = p[k];
    }
    this.scheduleSave('library');
  }

  removeTracks(ids) {
    for (const id of ids) this.tracks.delete(id);
    this.scheduleSave('library');
  }

  // Walk paths (files or folders, local or network) and collect audio + playlist files.
  async collect(inputPaths, onProgress) {
    const audio = [];
    const playlists = [];
    const seenDirs = new Set();
    const visit = async (p, depth) => {
      let st;
      try { st = await fsp.stat(p); } catch { return; }
      if (st.isDirectory()) {
        if (depth > 40) return;
        let real = p;
        try { real = await fsp.realpath(p); } catch {}
        if (seenDirs.has(real)) return;
        seenDirs.add(real);
        let entries;
        try { entries = await fsp.readdir(p, { withFileTypes: true }); } catch { return; }
        entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        for (const e of entries) {
          if (e.name.startsWith('.')) continue;
          const child = path.join(p, e.name);
          if (e.isFile()) pushFile(child);
          else await visit(child, depth + 1); // dirs, symlinks and unknown types (common on SMB/NFS)
        }
        onProgress?.({ phase: 'collect', found: audio.length });
      } else if (st.isFile()) {
        pushFile(p);
      }
    };
    const pushFile = (p) => {
      const ext = path.extname(p).toLowerCase();
      if (AUDIO_EXTS.has(ext)) audio.push(p);
      else if (PLAYLIST_EXTS.has(ext)) playlists.push(p);
    };
    for (const p of inputPaths) await visit(p, 0);
    return { audio, playlists };
  }

  async addPaths(inputPaths, onProgress) {
    const { audio, playlists } = await this.collect(inputPaths, onProgress);
    const importedPlaylists = [];
    for (const pl of playlists) {
      const entries = await this.readM3U(pl);
      if (entries.length) {
        importedPlaylists.push({ name: path.basename(pl, path.extname(pl)), paths: entries });
        audio.push(...entries);
      }
    }
    const unique = [...new Set(audio)];
    const changed = await this.scanFiles(unique, onProgress);
    const ids = unique.map(trackId).filter((id) => this.tracks.has(id));
    return {
      ids,
      changed,
      playlists: importedPlaylists.map((p) => ({ name: p.name, ids: p.paths.map(trackId).filter((id) => this.tracks.has(id)) })),
    };
  }

  async rescan(folders, onProgress) {
    const { audio } = await this.collect(folders, onProgress);
    const changed = await this.scanFiles(audio, onProgress);
    // Drop tracks under these folders whose files no longer exist.
    const present = new Set(audio.map(trackId));
    const roots = folders.map((f) => path.resolve(f) + path.sep);
    const removed = [];
    for (const t of this.tracks.values()) {
      if (present.has(t.id)) continue;
      if (!roots.some((r) => t.path.startsWith(r))) continue;
      if (!fs.existsSync(t.path)) removed.push(t.id);
    }
    this.removeTracks(removed);
    return { changed, removed };
  }

  async scanFiles(files, onProgress) {
    const changed = [];
    let done = 0;
    let lastEmit = 0;
    await pool(files, 8, async (file) => {
      const id = trackId(file);
      try {
        const st = await fsp.stat(file);
        const prev = this.tracks.get(id);
        if (!prev || prev.mtime !== st.mtimeMs || prev.size !== st.size) {
          const t = await this.readTrack(file, st, prev);
          this.tracks.set(id, t);
          changed.push(t);
        }
      } catch (e) {
        console.warn('skip', file, e.message);
      }
      done++;
      const now = Date.now();
      if (now - lastEmit > 120 || done === files.length) {
        lastEmit = now;
        onProgress?.({ phase: 'scan', done, total: files.length });
      }
    });
    if (changed.length) this.scheduleSave('library');
    return changed;
  }

  async readTrack(file, st, prev) {
    const ext = path.extname(file).toLowerCase();
    let common = {}, format = {};
    try {
      ({ common, format } = await parseFile(file, { duration: false, skipCovers: false }));
    } catch (e) {
      console.warn('tags unreadable', file, e.message);
    }
    // Some containers (Ogg/Opus, VBR MP3 without a header) only reveal their length on a full pass.
    if (!format.duration) {
      try { format = { ...format, duration: (await parseFile(file, { duration: true, skipCovers: true })).format.duration }; } catch {}
    }
    let cover = null;
    const pic = selectCover(common.picture);
    if (pic?.data) cover = await this.cacheCover(Buffer.from(pic.data));
    if (!cover) cover = await this.folderCover(path.dirname(file));
    return {
      id: trackId(file),
      path: file,
      title: common.title || path.basename(file, ext),
      artist: common.artist || common.albumartist || 'Unknown Artist',
      albumArtist: common.albumartist || '',
      album: common.album || 'Unknown Album',
      genre: (common.genre && common.genre[0]) || '',
      year: common.year || 0,
      trackNo: common.track?.no || 0,
      discNo: common.disk?.no || 0,
      duration: format.duration || 0,
      bitrate: format.bitrate || 0,
      sampleRate: format.sampleRate || 0,
      bits: format.bitsPerSample || 0,
      codec: (format.codec || ext.slice(1)).replace(/^MPEG 1 Layer 3$/, 'MP3'),
      lossless: !!format.lossless,
      size: st.size,
      mtime: st.mtimeMs,
      cover,
      added: prev?.added || Date.now(),
      plays: prev?.plays || 0,
      lastPlayed: prev?.lastPlayed || 0,
      liked: prev?.liked || false,
    };
  }

  // Store a large (600px) and small (160px) JPEG per unique image; returns the cache key.
  async cacheCover(buf) {
    const key = hash(buf);
    const big = path.join(this.coverDir, `${key}.jpg`);
    if (fs.existsSync(big)) return key;
    try {
      const img = nativeImage.createFromBuffer(buf);
      if (img.isEmpty()) return null;
      const { width } = img.getSize();
      const large = width > 600 ? img.resize({ width: 600, quality: 'best' }) : img;
      const small = img.resize({ width: Math.min(width, 160), quality: 'best' });
      await fsp.writeFile(path.join(this.coverDir, `${key}_s.jpg`), small.toJPEG(85));
      await fsp.writeFile(big, large.toJPEG(88));
      return key;
    } catch {
      return null;
    }
  }

  async folderCover(dir) {
    if (this.folderCoverCache.has(dir)) return this.folderCoverCache.get(dir);
    const job = (async () => {
      try {
        const names = (await fsp.readdir(dir)).filter((n) => COVER_NAMES.test(n));
        names.sort((a, b) => (/^(cover|folder|front)/i.test(a) ? -1 : 0) - (/^(cover|folder|front)/i.test(b) ? -1 : 0));
        for (const n of names) {
          const key = await this.cacheCover(await fsp.readFile(path.join(dir, n)));
          if (key) return key;
        }
      } catch {}
      return null;
    })();
    this.folderCoverCache.set(dir, job);
    return job;
  }

  async readM3U(file) {
    try {
      const base = path.dirname(file);
      const text = await fsp.readFile(file, 'utf8');
      return text.split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .map((l) => (l.startsWith('file://') ? decodeURIComponent(new URL(l).pathname) : l))
        .map((l) => (path.isAbsolute(l) || /^\\\\/.test(l) ? l : path.resolve(base, l)))
        .filter((l) => AUDIO_EXTS.has(path.extname(l).toLowerCase()));
    } catch {
      return [];
    }
  }

  async writeM3U(file, ids) {
    const lines = ['#EXTM3U'];
    for (const id of ids) {
      const t = this.tracks.get(id);
      if (!t) continue;
      lines.push(`#EXTINF:${Math.round(t.duration)},${t.artist} - ${t.title}`, t.path);
    }
    await fsp.writeFile(file, lines.join('\n') + '\n');
  }
}
