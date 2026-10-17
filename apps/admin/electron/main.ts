/**
 * Processus principal de Teralynk Admin.
 * Mêmes exigences de sécurité que l'application utilisateur, renforcées :
 * c'est ici (et nulle part ailleurs) que le jeton GitHub est déchiffré.
 */
import { app, BrowserWindow, dialog, session, shell } from 'electron';
import path from 'node:path';
import { registerAdminIpc } from './ipc';
import { addLog } from './services/vault';

const DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL'];

let mainWindow: BrowserWindow | null = null;

function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 880,
    minWidth: 980,
    minHeight: 620,
    show: false,
    backgroundColor: '#07070c',
    title: 'Teralynk Admin',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      webSecurity: true
    }
  });


  // Robustesse du démarrage : la fenêtre s'affiche via DEUX mécanismes
  // (ready-to-show et did-finish-load) — plus de fenêtre invisible si l'un manque.
  mainWindow.once('ready-to-show', () => {
    console.log('[admin] renderer prêt à être affiché');
    mainWindow?.show();
  });
  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[admin] renderer chargé — fenêtre affichée');
    if (mainWindow && !mainWindow.isVisible()) mainWindow.show();
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`[admin] ÉCHEC de chargement du renderer (code ${code}) : ${description} — ${url}`);
    dialog.showErrorBox(
      'TAG — chargement impossible',
      `Le rendu n'a pas pu être chargé (code ${code}).\n${description}\n${url}\n\nRelancez l'application ; si le problème persiste, consultez docs/troubleshooting.md.`
    );
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[admin] processus renderer terminé :', details.reason);
    dialog.showErrorBox('TAG — rendu interrompu', `Le processus de rendu s'est arrêté (${details.reason}). Relancez l'application.`);
  });
  // DevTools : plus d'ouverture automatique détachée (source de fermetures
  // intempestives observées sous Windows) — bascule manuelle Ctrl+Maj+I.
  mainWindow.webContents.on('before-input-event', (_event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow?.webContents.toggleDevTools();
    }
  });

  const allowedExternal = new Set(['github.com', 'raw.githubusercontent.com', 'docs.github.com']);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:' && allowedExternal.has(parsed.hostname)) void shell.openExternal(url);
    } catch {
      /* refusé */
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

  mainWindow.on('close', () => {
    console.log(`[admin] événement close reçu à ${new Date().toISOString()}`);
  });
  mainWindow.on('closed', () => {
    console.log('[admin] fenêtre fermée');
    mainWindow = null;
  });
}

if (!app.requestSingleInstanceLock()) {
  console.error('[admin] Une autre instance de Teralynk Admin tourne déjà (verrou d’instance) — sortie immédiate.');
  console.error('[admin] Fermez-la : Gestionnaire des tâches → electron.exe, ou : taskkill /F /IM electron.exe');
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  // CSP stricte en PRODUCTION uniquement : en développement, Vite injecte des
  // scripts inline et ouvre un websocket HMR que cette CSP casserait (page blanche).
  if (!DEV_SERVER_URL) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://raw.githubusercontent.com; font-src 'self' data:; connect-src 'self' https://api.github.com https://github.com https://raw.githubusercontent.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
          ]
        }
      });
    });
  }
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  registerAdminIpc(getMainWindow);
  createMainWindow();
  console.log('[admin] Prêt — fenêtre principale créée.');
  addLog('Teralynk Admin démarré', 'success', `v${app.getVersion()} · ${process.platform}`);
});

app.on('window-all-closed', () => {
  console.log('[admin] Toutes les fenêtres sont fermées — arrêt de l’application.');
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (error) => {
  console.error('[admin] Exception non capturée :', error.message);
  addLog('Exception non capturée (processus principal)', 'failed', error.message);
});
