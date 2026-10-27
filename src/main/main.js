import { app, BrowserWindow, protocol, ipcMain, dialog, shell, Menu } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Library, AUDIO_EXTS } from './library.js';
import { readOmarchyTheme, watchOmarchyTheme } from './omarchy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RENDERER_DIR = path.join(__dirname, '..', 'renderer');
const ICON = path.join(__dirname, '..', '..', 'assets', 'icon.png');

// Everything (UI, audio, covers) is served from one origin so Web Audio can analyse the stream.
protocol.registerSchemesAsPrivileged([
  { scheme: 'ct', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
]);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Optional override of the data folder (portable installs, testing).
if (process.env.CHROMATUNE_DATA) app.setPath('userData', path.resolve(process.env.CHROMATUNE_DATA));

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.json': 'application/json', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg',
  '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.aac': 'audio/aac', '.webm': 'audio/webm', '.weba': 'audio/webm',
};

let win = null;
let library = null;
const pendingOpen = [];

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const paths = argvPaths(argv);
    if (paths.length) win?.webContents.send('open-paths', paths);
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(start);
}

function argvPaths(argv) {
  const self = path.resolve(app.getAppPath());
  return argv.slice(1)
    .filter((a) => !a.startsWith('-') && fs.existsSync(a))
    .map((a) => path.resolve(a))
    .filter((a) => a !== self && a !== path.resolve(process.execPath));
}

async function serveFile(file, request, type) {
  const st = await fsp.stat(file);
  const range = request.headers.get('range');
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  if (range) {
    const m = range.match(/bytes=(\d*)-(\d*)/);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : st.size - 1;
    if (m && !m[1] && m[2]) { start = Math.max(0, st.size - parseInt(m[2], 10)); end = st.size - 1; }
    end = Math.min(end, st.size - 1);
    if (start > end || start >= st.size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}` } });
    const body = Readable.toWeb(fs.createReadStream(file, { start, end }));
    return new Response(body, {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...headers, 'Content-Length': String(st.size) } });
}

function registerProtocol() {
  protocol.handle('ct', async (request) => {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/media') {
        const file = url.searchParams.get('p');
        const ext = path.extname(file || '').toLowerCase();
        if (!file || !AUDIO_EXTS.has(ext)) return new Response('forbidden', { status: 403 });
        return await serveFile(file, request, MIME[ext] || 'application/octet-stream');
      }
      if (url.pathname.startsWith('/cover/')) {
        const name = path.basename(url.pathname);
        if (!/^[0-9a-f]{16}(_s)?\.jpg$/.test(name)) return new Response('not found', { status: 404 });
        return await serveFile(path.join(library.coverDir, name), request, 'image/jpeg');
      }
      const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '') || 'index.html';
      const file = path.join(RENDERER_DIR, rel);
      if (!file.startsWith(RENDERER_DIR)) return new Response('forbidden', { status: 403 });
      return await serveFile(file, request, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream');
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function registerIpc() {
  ipcMain.handle('state:get', async () => ({
    ...library.state(),
    platform: process.platform,
    omarchy: await readOmarchyTheme(),
    openPaths: pendingOpen.splice(0),
    version: app.getVersion(),
  }));
  ipcMain.handle('library:add', (_e, paths) => library.addPaths(paths, (p) => send('scan:progress', p)));
  ipcMain.handle('library:rescan', (_e, folders) => library.rescan(folders, (p) => send('scan:progress', p)));
  ipcMain.handle('library:update', (_e, patches) => library.updateTracks(patches));
  ipcMain.handle('library:remove', (_e, ids) => library.removeTracks(ids));
  ipcMain.handle('store:set', (_e, key, data) => library.setStore(key, data));
  ipcMain.handle('path:exists', (_e, p) => fs.existsSync(p));

  ipcMain.handle('dialog:folders', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Add music folders', properties: ['openDirectory', 'multiSelections'] });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('dialog:files', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Add music files',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio & playlists', extensions: [...AUDIO_EXTS].map((e) => e.slice(1)).concat(['m3u', 'm3u8']) }],
    });
    return r.canceled ? [] : r.filePaths;
  });
  ipcMain.handle('playlist:export', async (_e, name, ids) => {
    const r = await dialog.showSaveDialog(win, { title: 'Export playlist', defaultPath: `${name}.m3u8`, filters: [{ name: 'M3U playlist', extensions: ['m3u8', 'm3u'] }] });
    if (r.canceled || !r.filePath) return false;
    await library.writeM3U(r.filePath, ids);
    return true;
  });
  ipcMain.handle('shell:show', (_e, p) => shell.showItemInFolder(p));

  ipcMain.on('win:minimize', () => win?.minimize());
  ipcMain.on('win:maximize', () => (win?.isMaximized() ? win.unmaximize() : win?.maximize()));
  ipcMain.on('win:close', () => win?.close());
  ipcMain.on('win:fullscreen', (_e, on) => win?.setFullScreen(!!on));
  ipcMain.on('win:title', (_e, t) => win?.setTitle(t));
}

async function start() {
  Menu.setApplicationMenu(null);
  library = new Library(app.getPath('userData'));
  await library.load();
  pendingOpen.push(...argvPaths(process.argv));
  registerProtocol();
  registerIpc();

  const bounds = library.store.settings?.windowBounds || { width: 1480, height: 900 };
  win = new BrowserWindow({
    ...bounds,
    minWidth: 960,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: library.store.settings?.lastBg || '#1a1b26',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    title: 'Chromatune',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  if (library.store.settings?.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('maximize', () => send('win:maximized', true));
  win.on('unmaximize', () => send('win:maximized', false));
  win.on('close', () => {
    const s = library.store.settings || {};
    s.maximized = win.isMaximized();
    if (!s.maximized && !win.isFullScreen()) s.windowBounds = win.getBounds();
    library.store.settings = s;
  });
  // Never let a dropped file navigate the window away from the app.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  watchOmarchyTheme((theme) => send('omarchy:theme', theme));
  await win.loadURL('ct://app/index.html');
}

app.on('before-quit', async (e) => {
  if (library && !library._flushed) {
    e.preventDefault();
    library._flushed = true;
    await library.flush();
    app.quit();
  }
});
app.on('window-all-closed', () => app.quit());
