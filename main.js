const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const koffi = require('koffi');

// ── Single instance lock ────────────────────────────
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running — quit this one
  app.quit();
} else {
  app.on('second-instance', (_event, _commandLine, _workingDirectory) => {
    // Someone tried to run a second instance — restore the existing window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // ═══════════════════════════════════════════════════
  // All initialization happens inside this block
  // so the second instance never reaches it.
  // ═══════════════════════════════════════════════════

  // ── Config ──────────────────────────────────────
const CONFIG_PATH = path.join(app.getPath('userData'), 'widget-config.json');
const isWindows = process.platform === 'win32';

// Default settings
const DEFAULT_CONFIG = {
  mode: 'widget',       // 'normal' | 'widget'
  x: undefined,
  y: undefined,
  normalWidth: 480,
  normalHeight: 700,
  widgetWidth: 380,
  widgetHeight: 520,
};

let config = { ...DEFAULT_CONFIG };
let mainWindow = null;
let tray = null;
let isQuitting = false;

// ── Config persistence ────────────────────────────
function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      config = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) };
    }
  } catch { /* keep defaults */ }
}

function saveConfig() {
  try {
    const toSave = {
      mode: config.mode,
      x: config.x,
      y: config.y,
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(toSave, null, 2));
  } catch { /* ignore */ }
}

function saveWindowBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getBounds();
  config.x = bounds.x;
  config.y = bounds.y;
  if (config.mode === 'normal') {
    config.normalWidth = bounds.width;
    config.normalHeight = bounds.height;
  }
  saveConfig();
}

// ── Tray icon ─────────────────────────────────────
function createTrayIcon() {
  // Use a simple colored square as tray icon
  const iconSize = 16;
  const canvas = Buffer.alloc(iconSize * iconSize * 4);
  for (let i = 0; i < iconSize * iconSize; i++) {
    const x = i % iconSize;
    const y = Math.floor(i / iconSize);
    // Draw a simple checkmark-like pattern
    const isCheckmark =
      (x >= 2 && x <= 6 && y === 8) ||
      (x >= 4 && x <= 8 && y === 9) ||
      (x >= 6 && x <= 10 && y === 10) ||
      (x >= 8 && x <= 12 && y === 11) ||
      (x >= 6 && x <= 10 && y === 12) ||
      (x >= 4 && x <= 8 && y === 7);
    const idx = i * 4;
    canvas[idx] = isCheckmark ? 0xff : 0x63;     // R
    canvas[idx + 1] = isCheckmark ? 0xff : 0x66; // G
    canvas[idx + 2] = isCheckmark ? 0xff : 0xf1; // B
    canvas[idx + 3] = 255;                        // A
  }
  return nativeImage.createFromBuffer(canvas, { width: iconSize, height: iconSize });
}

function setupTray() {
  const icon = createTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('待办清单');

  updateTrayMenu();

  // Click tray to toggle window visibility
  tray.on('click', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createWindow();
      return;
    }
    if (mainWindow.isVisible()) {
      mainWindow.focus();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function updateTrayMenu() {
  if (!tray) return;

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示窗口',
      click: () => {
        if (!mainWindow || mainWindow.isDestroyed()) createWindow();
        else { mainWindow.show(); mainWindow.focus(); }
      }
    },
    { type: 'separator' },
    {
      label: config.mode === 'widget' ? '✓ 桌面小组件模式' : '桌面小组件模式',
      click: () => toggleMode()
    },
    {
      label: config.mode === 'normal' ? '✓ 普通窗口模式' : '普通窗口模式',
      click: () => toggleMode()
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(contextMenu);
}

// ── Window management ─────────────────────────────

// ═══════════════════════════════════════════════════════
// Win32 API helpers — for true desktop widget experience
// Makes the widget behave like macOS desktop widgets:
//  - Lives directly on the desktop (behind all windows)
//  - Survives Win+D (Show Desktop)
//  - Hidden from Alt+Tab task switcher
//  - Not in taskbar
// ═══════════════════════════════════════════════════════

let win32api = null; // lazy-loaded cache

function loadWin32API() {
  if (win32api) return win32api;
  if (process.platform !== 'win32') return null;

  const user32 = koffi.load('user32.dll');

  win32api = {
    FindWindowW: user32.func(
      'intptr_t FindWindowW(str16 lpClassName, str16 lpWindowName)',
    ),
    FindWindowExW: user32.func(
      'intptr_t FindWindowExW(intptr_t hWndParent, intptr_t hWndChildAfter, str16 lpClassName, str16 lpWindowName)',
    ),
    SendMessageW: user32.func(
      'intptr_t SendMessageW(intptr_t hWnd, uint32_t Msg, intptr_t wParam, intptr_t lParam)',
    ),
    SetParent: user32.func(
      'intptr_t SetParent(intptr_t hWndChild, intptr_t hWndNewParent)',
    ),
    SetWindowLongPtrW: user32.func(
      'intptr_t SetWindowLongPtrW(intptr_t hWnd, int32_t nIndex, intptr_t dwNewLong)',
    ),
    GetWindowLongPtrW: user32.func(
      'intptr_t GetWindowLongPtrW(intptr_t hWnd, int32_t nIndex)',
    ),
    SetWindowPos: user32.func(
      'int32_t SetWindowPos(intptr_t hWnd, intptr_t hWndInsertAfter, int32_t X, int32_t Y, int32_t cx, int32_t cy, uint32_t uFlags)',
    ),
    GetWindowThreadProcessId: user32.func(
      'uint32_t GetWindowThreadProcessId(intptr_t hWnd, uint32_t *lpdwProcessId)',
    ),
  };

  return win32api;
}

// Read HWND from Electron's NativeWindow handle buffer
function getHwnd(win) {
  const buf = win.getNativeWindowHandle();
  return buf.length >= 8
    ? buf.readBigUInt64LE(0)
    : BigInt(buf.readUInt32LE(0));
}

// ── Window style flags ──────────────────────────
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW  = 0x00000080; // Hide from Alt+Tab
const WS_EX_NOACTIVATE   = 0x08000000; // Don't activate on click
const WS_EX_APPWINDOW    = 0x00040000; // Force taskbar entry
const SWP_NOMOVE         = 0x0002;
const SWP_NOSIZE         = 0x0001;
const SWP_NOACTIVATE     = 0x0010;
const SWP_NOOWNERZORDER  = 0x0200;
const HWND_BOTTOM        = 1n;

// Hide window from Alt+Tab by adding WS_EX_TOOLWINDOW
function hideFromAltTab(win) {
  const api = loadWin32API();
  if (!api) return;
  try {
    const hwnd = getHwnd(win);
    const exStyle = api.GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
    // Remove APPWINDOW (forces taskbar) and add TOOLWINDOW (hides from Alt+Tab)
    const newExStyle = (exStyle & ~BigInt(WS_EX_APPWINDOW)) | BigInt(WS_EX_TOOLWINDOW);
    api.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, newExStyle);
    // Apply style change: SWP_FRAMECHANGED = 0x0020
    api.SetWindowPos(hwnd, 0, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | 0x0020);
    console.log('[widget] Window hidden from Alt+Tab');
  } catch (err) {
    console.warn('[widget] Failed to hide from Alt+Tab:', err.message);
  }
}

// Restore normal window style (for switching back to normal mode)
function restoreNormalStyle(win) {
  const api = loadWin32API();
  if (!api) return;
  try {
    const hwnd = getHwnd(win);
    const exStyle = api.GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
    const newExStyle = (exStyle & ~BigInt(WS_EX_TOOLWINDOW)) | BigInt(WS_EX_APPWINDOW);
    api.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, newExStyle);
    api.SetWindowPos(hwnd, 0, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | 0x0020);
  } catch (err) {
    console.warn('[widget] Failed to restore window style:', err.message);
  }
}

// ── Desktop Pinning ─────────────────────────────
// Reparents the window to the desktop WorkerW.
// This is the core technique that makes the window:
//   - Sit on the desktop (behind normal windows, above icons)
//   - Stay visible when pressing Win+D (Show Desktop)
//   - Feel like a native desktop widget (similar to macOS widgets)
function pinToDesktop(win) {
  if (process.platform !== 'win32') return false;
  const api = loadWin32API();
  if (!api) return false;

  try {
    const hwnd = getHwnd(win);

    // Step 1: Tell Progman to create a WorkerW behind desktop icons
    // 0x052C is a secret message that causes Progman to spawn a WorkerW
    const progman = api.FindWindowW('Progman', null);
    if (progman) {
      api.SendMessageW(progman, 0x052c, 0, 0);
    }

    // Step 2: Find the WorkerW that hosts SHELLDLL_DefView (the desktop)
    let workerW = 0;
    let foundWorkerW = 0;
    while (true) {
      workerW = api.FindWindowExW(0, workerW, 'WorkerW', null);
      if (!workerW) break;
      const defView = api.FindWindowExW(workerW, 0, 'SHELLDLL_DefView', null);
      if (defView) {
        foundWorkerW = workerW;
        break;
      }
    }

    if (!foundWorkerW) {
      console.warn('[widget] Could not find desktop WorkerW');
      return false;
    }

    // Step 3: Reparent our window to the desktop WorkerW
    api.SetParent(hwnd, foundWorkerW);
    console.log('[widget] Successfully pinned to desktop');
    return true;
  } catch (err) {
    console.error('[widget] pinToDesktop failed:', err.message);
    return false;
  }
}

// Retry pinToDesktop with exponential backoff
// Explorer might not have the WorkerW ready immediately
function pinToDesktopWithRetry(win, maxAttempts = 8) {
  let attempt = 0;

  function tryPin() {
    if (!win || win.isDestroyed()) return;
    attempt++;
    const ok = pinToDesktop(win);
    if (ok) {
      // After successful pin, also hide from Alt+Tab
      hideFromAltTab(win);
      return;
    }
    if (attempt < maxAttempts) {
      const delay = Math.min(200 * Math.pow(1.5, attempt), 3000);
      console.log(`[widget] Pinning retry ${attempt}/${maxAttempts} in ${delay}ms…`);
      setTimeout(tryPin, delay);
    } else {
      console.warn('[widget] Desktop pinning failed after', maxAttempts, 'attempts — widget shown as frameless window');
      // Even if pinning fails, still try to hide from Alt+Tab
      hideFromAltTab(win);
      // And set as bottom-most so it stays behind other windows
      setDesktopZOrder(win);
    }
  }

  tryPin();
}

// Set window to bottom of z-order (behind all normal windows)
function setDesktopZOrder(win) {
  const api = loadWin32API();
  if (!api) return;
  try {
    const hwnd = getHwnd(win);
    api.SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
  } catch (err) {
    console.warn('[widget] Failed to set z-order:', err.message);
  }
}

// Check if the window is still pinned to the desktop
function isPinnedToDesktop(win) {
  if (process.platform !== 'win32') return true; // non-Windows: always report OK
  const api = loadWin32API();
  if (!api) return true;
  try {
    const hwnd = getHwnd(win);
    // Get our window's parent
    let parent = 0;
    // Simple heuristic: check if parent is a WorkerW
    return true; // Assume pinned — full check would need more API calls
  } catch {
    return false;
  }
}

// Monitor for Explorer restarts and re-pin the widget
// Explorer restarts destroy the WorkerW tree, so we need to re-parent
let explorerMonitorInterval = null;

function startExplorerMonitor() {
  if (process.platform !== 'win32') return;
  if (explorerMonitorInterval) return;

  // Check every 10 seconds if the window needs re-pinning
  explorerMonitorInterval = setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (config.mode !== 'widget') return;
    if (!mainWindow.isVisible()) return;

    // Quick check: is Progman's WorkerW still valid?
    // If Explorer restarted, our parent chain is broken
    try {
      const api = loadWin32API();
      if (!api) return;
      // Try to find WorkerW again — if found but different from last time, re-pin
      const hwnd = getHwnd(mainWindow);
      // Check if window still responds
      // A simple approach: try to get window rect — if it fails, window is orphaned
      pinToDesktop(mainWindow); // Re-pin (safe: SetParent to same parent is a no-op)
    } catch { /* ignore monitor errors */ }
  }, 10000);

  console.log('[widget] Explorer restart monitor started');
}

function stopExplorerMonitor() {
  if (explorerMonitorInterval) {
    clearInterval(explorerMonitorInterval);
    explorerMonitorInterval = null;
  }
}

// ── Full Desktop Widget Setup ───────────────────
// Applies all transformations to make the window a true desktop widget
function setupDesktopWidget(win) {
  if (process.platform !== 'win32') {
    console.log('[widget] Desktop pinning only supported on Windows');
    return;
  }
  // 1. Pin to desktop with retry (this also calls hideFromAltTab on success)
  pinToDesktopWithRetry(win);
  // 2. Start monitoring for Explorer restarts
  startExplorerMonitor();
}

function teardownDesktopWidget(win) {
  stopExplorerMonitor();
  if (win && !win.isDestroyed()) {
    restoreNormalStyle(win);
  }
}

function getWindowOptions() {
  const isWidget = config.mode === 'widget';

  const options = {
    width: isWidget ? config.widgetWidth : config.normalWidth,
    height: isWidget ? config.widgetHeight : config.normalHeight,
    minWidth: isWidget ? 320 : 360,
    minHeight: isWidget ? 300 : 500,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    alwaysOnTop: false,
    skipTaskbar: isWidget,
    frame: !isWidget,
    resizable: true,
    title: '待办清单',
    thickFrame: !isWidget,
  };

  // Restore position
  if (config.x !== undefined && config.y !== undefined) {
    options.x = config.x;
    options.y = config.y;
  }

  return options;
}

function createWindow() {
  const options = getWindowOptions();
  mainWindow = new BrowserWindow(options);

  mainWindow.loadFile('index.html');

  // Send initial mode to renderer
  mainWindow.webContents.on('did-finish-load', () => {
    mainWindow.webContents.send('mode-changed', config.mode);
  });

  // Save position when moved/resized
  mainWindow.on('resize', () => saveWindowBounds());
  mainWindow.on('move', () => saveWindowBounds());
  mainWindow.on('close', () => saveWindowBounds());

  // Handle close — hide to tray instead of quitting
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    // Pin to Windows desktop if starting in widget mode
    if (config.mode === 'widget') {
      // Delay to let the window fully render before reparenting
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          setupDesktopWidget(mainWindow);
          // Force layout refresh after pinning — the 100vh may need recalculation
          setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.executeJavaScript('window.dispatchEvent(new Event("resize"))');
            }
          }, 400);
        }
      }, 500);
    }
  });
}

function toggleMode() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  // Save current bounds (position + size)
  const bounds = mainWindow.getBounds();
  config.x = bounds.x;
  config.y = bounds.y;

  // Remember the current mode's window size so it's restored next time
  if (config.mode === 'normal') {
    config.normalWidth = bounds.width;
    config.normalHeight = bounds.height;
  } else {
    config.widgetWidth = bounds.width;
    config.widgetHeight = bounds.height;
  }

  // Tear down desktop widget if currently in widget mode
  if (config.mode === 'widget') {
    teardownDesktopWidget(mainWindow);
  }

  // Toggle mode
  config.mode = config.mode === 'widget' ? 'normal' : 'widget';
  saveConfig();

  // Recreate window — frame & desktop pinning can't be changed at runtime
  const oldWin = mainWindow;
  mainWindow = null; // detach so close handler doesn't interfere
  oldWin.removeAllListeners(); // remove ALL listeners (resize, move, close, closed, etc.)
  oldWin.close();
  createWindow(); // creates with new mode options & pins to desktop if widget

  // Update tray menu
  updateTrayMenu();
}

// ── AI Date Analysis ──────────────────────────────

// Chinese date patterns — extracts deadlines from todo text
const DATE_PATTERNS = [
  // ISO dates: 2024-12-31, 2024/12/31
  { regex: /(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/, parse: m => new Date(m[1]) },
  // 中文年月日: 2024年12月31日, 2024年12月31号
  { regex: /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/, parse: m => new Date(+m[1], +m[2] - 1, +m[3]) },
  // 月日: 12月31日, 12月31号
  { regex: /(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/, parse: m => {
    const now = new Date();
    const d = new Date(now.getFullYear(), +m[1] - 1, +m[2]);
    // If date already passed this year, assume next year
    if (d < now) d.setFullYear(d.getFullYear() + 1);
    return d;
  }},
  // MM/DD or M-D
  { regex: /(\d{1,2})[-\/](\d{1,2})\b(?!\d)/, parse: m => {
    const now = new Date();
    const d = new Date(now.getFullYear(), +m[1] - 1, +m[2]);
    if (d < now) d.setFullYear(d.getFullYear() + 1);
    return d;
  }},
  // 明天
  { regex: /明天/, parse: () => { const d = new Date(); d.setDate(d.getDate() + 1); return d; }},
  // 后天
  { regex: /后天/, parse: () => { const d = new Date(); d.setDate(d.getDate() + 2); return d; }},
  // 大后天
  { regex: /大后天/, parse: () => { const d = new Date(); d.setDate(d.getDate() + 3); return d; }},
  // 今天
  { regex: /今天/, parse: () => new Date() },
  // N天后 / N天之后 / N天以后
  { regex: /(\d+)\s*天\s*[后之以]/, parse: m => { const d = new Date(); d.setDate(d.getDate() + (+m[1])); return d; }},
  // 下周X / 下星期X
  { regex: /下[周星期]([一二三四五六日天1-6])/, parse: m => {
    const dayMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6 };
    const target = dayMap[m[1]] ?? 0;
    const now = new Date();
    const today = now.getDay();
    const daysUntil = (target - today + 7) % 7 || 7;
    now.setDate(now.getDate() + daysUntil + 7); // next week = this week + 7
    return now;
  }},
  // 这周X / 本周X / 星期X / 周X
  { regex: /[这本周]?[周星期]([一二三四五六日天1-6])/, parse: m => {
    const dayMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 0, '天': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6 };
    const target = dayMap[m[1]] ?? 0;
    const now = new Date();
    const today = now.getDay();
    let daysUntil = (target - today + 7) % 7;
    if (daysUntil === 0) daysUntil = 0; // today
    now.setDate(now.getDate() + daysUntil);
    return now;
  }},
  // N小时后 / N小时后截止
  { regex: /(\d+)\s*小?时\s*[后之]/, parse: m => { const d = new Date(); d.setHours(d.getHours() + (+m[1])); return d; }},
  // 截止 / 截止日期 / deadline / due / ddl
  { regex: /(?:截止|截止日期|deadline|due|ddl)[：:\s]*(\S+)/, parse: m => null /* marker only, use matched text for further parsing */ },
];

function extractDate(text) {
  const now = new Date();
  let bestDate = null;
  let bestMatch = null;

  for (const pattern of DATE_PATTERNS) {
    const match = text.match(pattern.regex);
    if (match) {
      try {
        const d = pattern.parse(match);
        if (d && !isNaN(d.getTime())) {
          // Prefer the earliest future date
          if (!bestDate || (d >= now && d < bestDate) || (bestDate < now && d >= now)) {
            bestDate = d;
            bestMatch = match[0];
          }
        }
      } catch {}
    }
  }

  return bestDate ? { date: bestDate, match: bestMatch } : null;
}

function getUrgency(date) {
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  if (diffMs < 0) return { level: 'overdue', label: '已过期', color: '#ef4444' };
  if (diffDays === 0) return { level: 'today', label: '今天截止', color: '#f97316' };
  if (diffDays === 1) return { level: 'tomorrow', label: '明天截止', color: '#f59e0b' };
  if (diffDays <= 3) return { level: 'soon', label: `${diffDays}天后截止`, color: '#eab308' };
  if (diffDays <= 7) return { level: 'week', label: `${diffDays}天后`, color: '#6366f1' };
  return { level: 'future', label: `${diffDays}天后`, color: '#9ca3af' };
}

function analyzeTodos(todos) {
  if (!todos || todos.length === 0) {
    return { deadlines: [], summary: '暂无待办事项', urgent: null };
  }

  const active = todos.filter(t => !t.completed);
  const deadlines = [];

  for (const todo of active) {
    const extracted = extractDate(todo.text);
    if (extracted) {
      const urgency = getUrgency(extracted.date);
      deadlines.push({
        id: todo.id,
        text: todo.text,
        date: extracted.date.toISOString(),
        dateLocal: extracted.date.toLocaleDateString('zh-CN', {
          year: 'numeric', month: 'long', day: 'numeric', weekday: 'short',
        }),
        match: extracted.match,
        urgency,
      });
    }
  }

  // Sort by date (closest first)
  deadlines.sort((a, b) => new Date(a.date) - new Date(b.date));

  // Find most urgent (closest non-overdue, or most recently overdue)
  const urgent = deadlines.length > 0 ? deadlines[0] : null;

  let summary = '';
  if (deadlines.length === 0) {
    summary = `${active.length} 项待办，未检测到明确截止日期`;
  } else if (urgent.urgency.level === 'overdue') {
    summary = `⚠️ ${deadlines.length} 项有时效任务，最近已过期`;
  } else if (urgent.urgency.level === 'today') {
    summary = `🔴 ${deadlines.length} 项有时效任务，有今天截止的`;
  } else {
    summary = `📋 ${deadlines.length} 项有时效任务，最近：${urgent.dateLocal}`;
  }

  return { deadlines, summary, urgent, totalActive: active.length };
}

// ── IPC handlers ──────────────────────────────────
function setupIPC() {
  ipcMain.handle('get-mode', () => config.mode);

  ipcMain.handle('toggle-mode', () => {
    toggleMode();
    return config.mode;
  });

  ipcMain.handle('get-config', () => config);

  ipcMain.handle('set-always-on-top', (_event, flag) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setAlwaysOnTop(flag);
    }
  });

  ipcMain.handle('minimize-window', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.minimize();
    }
  });

  ipcMain.handle('close-widget', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
    }
  });

  ipcMain.handle('resize-widget', (_event, width, height) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      const minW = 320;
      const minH = 300;
      mainWindow.setBounds({
        x: mainWindow.getBounds().x,
        y: mainWindow.getBounds().y,
        width: Math.max(minW, Math.round(width)),
        height: Math.max(minH, Math.round(height)),
      });
    }
  });

  ipcMain.handle('quit-app', () => {
    isQuitting = true;
    app.quit();
  });

  // AI analysis: extract deadlines from todo items
  ipcMain.handle('analyze-todos', (_event, todos) => {
    return analyzeTodos(todos);
  });
}

// ── Application menu ──────────────────────────────
function setupMenu() {
  const appMenu = Menu.buildFromTemplate([
    {
      label: '文件',
      submenu: [
        {
          label: '显示窗口',
          click: () => {
            if (!mainWindow || mainWindow.isDestroyed()) createWindow();
            else { mainWindow.show(); mainWindow.focus(); }
          }
        },
        {
          label: '切换到桌面小组件模式',
          click: () => toggleMode()
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: 'Alt+F4',
          click: () => {
            isQuitting = true;
            app.quit();
          }
        }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: '重做', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
      ]
    },
    {
      label: '视图',
      submenu: [
        {
          label: '重新加载',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.reload();
            }
          }
        },
        { type: 'separator' },
        { label: '开发者工具', accelerator: 'F12', role: 'toggleDevTools' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于待办清单',
          click: () => {
            const { dialog } = require('electron');
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于待办清单',
              message: '📝 待办清单 — 桌面小组件',
              detail: '一个简洁优雅的待办事项桌面小组件\n始终置顶，随时记录您的想法与任务\n\n版本 1.0.0'
            });
          }
        }
      ]
    }
  ]);

  Menu.setApplicationMenu(appMenu);
}

// ── App lifecycle ─────────────────────────────────
app.whenReady().then(() => {
  loadConfig();
  setupMenu();
  setupIPC();
  setupTray();
  createWindow();
});

app.on('window-all-closed', () => {
  // Don't quit on window close — tray keeps running
});

app.on('before-quit', () => {
  isQuitting = true;
  stopExplorerMonitor();
  saveWindowBounds();
});

app.on('activate', () => {
  // macOS dock click
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
  } else {
    mainWindow.show();
  }
});

} // end of else block (gotTheLock)
