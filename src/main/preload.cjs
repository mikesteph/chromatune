const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const fn = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('api', {
  getState: () => ipcRenderer.invoke('state:get'),
  addPaths: (paths) => ipcRenderer.invoke('library:add', paths),
  rescan: (folders) => ipcRenderer.invoke('library:rescan', folders),
  updateTracks: (patches) => ipcRenderer.invoke('library:update', patches),
  removeTracks: (ids) => ipcRenderer.invoke('library:remove', ids),
  setStore: (key, data) => ipcRenderer.invoke('store:set', key, data),
  pathExists: (p) => ipcRenderer.invoke('path:exists', p),
  pickFolders: () => ipcRenderer.invoke('dialog:folders'),
  pickFiles: () => ipcRenderer.invoke('dialog:files'),
  exportPlaylist: (name, ids) => ipcRenderer.invoke('playlist:export', name, ids),
  showInFolder: (p) => ipcRenderer.invoke('shell:show', p),
  pathForFile: (file) => webUtils.getPathForFile(file),
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    maximize: () => ipcRenderer.send('win:maximize'),
    close: () => ipcRenderer.send('win:close'),
    fullscreen: (on) => ipcRenderer.send('win:fullscreen', on),
    title: (t) => ipcRenderer.send('win:title', t),
  },
  onScanProgress: on('scan:progress'),
  onOpenPaths: on('open-paths'),
  onMaximized: on('win:maximized'),
  onOmarchyTheme: on('omarchy:theme'),
});
