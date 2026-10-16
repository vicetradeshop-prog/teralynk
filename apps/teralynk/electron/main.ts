/**
 * Processus principal de Teralynk.
 *
 * Architecture de sécurité (non négociable) :
 *  - contextIsolation: true, nodeIntegration: false, sandbox: true
 *  - preload limité (API figée, voir preload.ts)
 *  - navigation et nouvelles fenêtres bloquées sauf liste blanche https
 *  - CSP stricte injectée en production
 *  - Toutes les opérations sensibles (réseau, scripts, jetons) restent ici.
 */
import { app, BrowserWindow, dialog, session, shell } from 'electron';
import path from 'node:path';
import { registerIpcHandlers } from './ipc';
import { loadPrefs } from './services/prefs';
import { log } from './services/logger';

const DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

let mainWindow: BrowserWindow | null = null;

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

function createMainWindow(): void {
  const prefs = loadPrefs();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false, // affiché par le renderer quand l'intro est prête (évite le flash blanc)
    backgroundColor: '#07070c',
    title: 'Teralynk',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  if (prefs.windowStart === 'maximized') mainWindow.maximize();

  // Rendu de la fenêtre piloté par l'état réel de l'UI (pas de splash factice).
  mainWindow.webContents.on('did-finish-load', () => mainWindow?.show());
  mainWindow.once('ready-to-show', () => {
    // Filet de sécurité : si le renderer tarde, on affiche quand même après 8 s.
    setTimeout(() => {
      if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
    }, 8000);
  });

  // Navigation : uniquement l'app elle-même ; tout le reste → navigateur externe (https, liste blanche).
  const allowedExternal = new Set(['github.com', 'raw.githubusercontent.com', 'www.python.org', 'nodejs.org', 'teralynk.app']);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' && allowedExternal.has(parsed.hostname)) void shell.openExternal(url);
    } catch {
      /* URL invalide : refusée */
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devOrigin = DEV_SERVER_URL ?? 'app://-';
    if (!url.startsWith(devOrigin)) event.preventDefault();
  });

  if (DEV_SERVER_URL) {
    void mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.on('closed', () => {
    console.log('[app] fenêtre fermée');
    mainWindow = null;
  });
}

// CSP stricte en production : aucune source distante arbitraire pour l'UI.
app.whenReady().then(() => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://raw.githubusercontent.com https://github.com; font-src 'self' data:; connect-src 'self' https://raw.githubusercontent.com https://api.github.com https://github.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
        ]
      }
    });
  });

  // Permissions web (notifications, géoloc, etc.) : tout est refusé.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  registerIpcHandlers(getMainWindow);
  createMainWindow();
  log('info', `Teralynk ${app.getVersion()} démarré`, { packaged: app.isPackaged, platform: process.platform });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Verrou d'instance unique.
if (!app.requestSingleInstanceLock()) {
  console.error('[app] Une autre instance de Teralynk tourne déjà (verrou d’instance) — sortie immédiate.');
  console.error('[app] Fermez-la : Gestionnaire des tâches → electron.exe, ou : taskkill /F /IM electron.exe');
  app.quit();
} else {
  app.on('second-instance', () => {
    const window = getMainWindow();
    if (window) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
}

process.on('uncaughtException', (error) => {
  log('error', 'Exception non capturée dans le processus principal', { reason: error.message, stack: error.stack?.slice(0, 800) });
});
