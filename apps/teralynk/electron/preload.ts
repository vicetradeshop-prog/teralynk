/**
 * Preload de Teralynk — surface API minimale et figée.
 * contextIsolation: true, nodeIntegration: false, sandbox: true côté fenêtre.
 * Le renderer n'accède à AUCUNE API Node ou Electron directe : uniquement
 * aux fonctions listées ici, dont les payloads sont revalidés côté main.
 */
import { contextBridge, ipcRenderer } from 'electron';

/** Écoute d'événements autorisée : canaux strictement limités. */
const ALLOWED_EVENT_CHANNELS = [
  'updates:progress',
  'updates:error',
  'updates:downloaded',
  'updates:installing',
  'scripts:event',
  'music:event'
] as const;
type EventChannel = (typeof ALLOWED_EVENT_CHANNELS)[number];

const api = {
  system: {
    info: () => ipcRenderer.invoke('system:info'),
    githubStatus: () => ipcRenderer.invoke('system:github-status'),
    openLogs: () => ipcRenderer.invoke('system:open-logs'),
    openExternal: (url: string) => ipcRenderer.invoke('system:open-external', url)
  },
  updates: {
    check: (channel?: 'stable' | 'beta') => ipcRenderer.invoke('updates:check', channel),
    download: () => ipcRenderer.invoke('updates:download'),
    installNow: () => ipcRenderer.invoke('updates:install-now')
  },
  content: {
    catalog: () => ipcRenderer.invoke('content:catalog'),
    announcements: () => ipcRenderer.invoke('content:announcements'),
    polls: () => ipcRenderer.invoke('content:polls'),
    clearCache: () => ipcRenderer.invoke('content:clear-cache')
  },
  prefs: {
    get: () => ipcRenderer.invoke('prefs:get'),
    patch: (patch: Record<string, unknown>) => ipcRenderer.invoke('prefs:patch', patch),
    reset: () => ipcRenderer.invoke('prefs:reset')
  },
  scripts: {
    runtimes: () => ipcRenderer.invoke('scripts:runtimes'),
    prepare: (card: unknown) => ipcRenderer.invoke('scripts:prepare', card),
    execute: (token: string, cardId: string) => ipcRenderer.invoke('scripts:execute', { token, cardId }),
    stop: (runId: string) => ipcRenderer.invoke('scripts:stop', runId),
    /** Abonne aux événements d'une exécution ; retourne la fonction de désabonnement. */
    onEvent: (listener: (event: unknown) => void): (() => void) => {
      const handler = (_e: unknown, payload: unknown) => listener(payload);
      ipcRenderer.on('scripts:event', handler);
      return () => ipcRenderer.removeListener('scripts:event', handler);
    }
  },
  polls: {
    results: (poll: unknown) => ipcRenderer.invoke('polls:results', poll),
    voteGithub: (poll: unknown, optionId: string) => ipcRenderer.invoke('polls:vote-github', { poll, optionId }),
    tokenStatus: () => ipcRenderer.invoke('polls:token-status'),
    storeToken: (token: string) => ipcRenderer.invoke('polls:store-token', token),
    clearToken: () => ipcRenderer.invoke('polls:clear-token')
  },
  music: {
    status: () => ipcRenderer.invoke('music:status'),
    defaultFolder: () => ipcRenderer.invoke('music:default-folder'),
    pickFolder: () => ipcRenderer.invoke('music:pick-folder'),
    openFolder: (folder: string) => ipcRenderer.invoke('music:open-folder', folder),
    install: () => ipcRenderer.invoke('music:install', { confirmed: true }),
    installFfmpeg: () => ipcRenderer.invoke('music:install-ffmpeg', { confirmed: true }),
    download: (url: string, folder: string) => ipcRenderer.invoke('music:download', { url, folder }),
    stop: (runId: string) => ipcRenderer.invoke('music:stop', runId),
    onEvent: (listener: (event: unknown) => void): (() => void) => {
      const handler = (_e: unknown, payload: unknown) => listener(payload);
      ipcRenderer.on('music:event', handler);
      return () => ipcRenderer.removeListener('music:event', handler);
    }
  },
  events: {
    /** Écoute les mises à jour (progression réelle, erreurs, téléchargement terminé). */
    onUpdates: (listener: (channel: string, payload: unknown) => void): (() => void) => {
      const handlers = ALLOWED_EVENT_CHANNELS.filter((c) => c.startsWith('updates:')).map((channel) => {
        const handler = (_e: unknown, payload: unknown) => listener(channel, payload);
        ipcRenderer.on(channel, handler);
        return { channel: channel as EventChannel, handler };
      });
      return () => handlers.forEach(({ channel, handler }) => ipcRenderer.removeListener(channel, handler));
    }
  }
};

export type TeralynkApi = typeof api;

contextBridge.exposeInMainWorld('teralynk', api);
