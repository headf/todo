const { contextBridge, ipcRenderer } = require('electron');

// Expose safe Electron APIs to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Get current mode (normal | widget)
  getMode: () => ipcRenderer.invoke('get-mode'),

  // Toggle between normal and widget mode
  toggleMode: () => ipcRenderer.invoke('toggle-mode'),

  // Get full config
  getConfig: () => ipcRenderer.invoke('get-config'),

  // Set always-on-top
  setAlwaysOnTop: (flag) => ipcRenderer.invoke('set-always-on-top', flag),

  // Minimize window
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),

  // Hide window (close to tray)
  closeWidget: () => ipcRenderer.invoke('close-widget'),

  // Quit the app entirely
  quitApp: () => ipcRenderer.invoke('quit-app'),

  // Analyze todos for deadlines (AI date extraction)
  analyzeTodos: (todos) => ipcRenderer.invoke('analyze-todos', todos),

  // Listen for mode changes from main process
  onModeChanged: (callback) => {
    ipcRenderer.on('mode-changed', (_event, mode) => callback(mode));
  },

  // Listen for analysis results
  onAnalysisResult: (callback) => {
    ipcRenderer.on('analysis-result', (_event, result) => callback(result));
  },

  // Resize widget window
  resizeWidget: (width, height) => ipcRenderer.invoke('resize-widget', width, height),

  // Remove listeners
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
