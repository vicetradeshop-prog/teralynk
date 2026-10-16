/**
 * Preload de Teralynk Admin — surface API figée.
 * Le jeton GitHub administrateur ne repasse JAMAIS vers le renderer :
 * seules les opérations et leurs résultats (sans secret) sont exposés.
 */
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  admin: {
    tokenStatus: () => ipcRenderer.invoke('admin:token-status'),
    storeToken: (token: string) => ipcRenderer.invoke('admin:store-token', token),
    validateToken: () => ipcRenderer.invoke('admin:validate-token'),
    clearToken: () => ipcRenderer.invoke('admin:clear-token')
  },
  config: {
    get: () => ipcRenderer.invoke('admin:config-get'),
    save: (patch: Record<string, unknown>) => ipcRenderer.invoke('admin:config-save', patch),
    selectSigningKey: () => ipcRenderer.invoke('admin:select-signing-key'),
    signingKeyStatus: () => ipcRenderer.invoke('admin:signing-key-status')
  },
  logs: {
    get: () => ipcRenderer.invoke('admin:logs-get'),
    clear: () => ipcRenderer.invoke('admin:logs-clear')
  },
  content: {
    read: (kind: 'catalog' | 'announcements' | 'polls' | 'versions') => ipcRenderer.invoke('content:read', kind),
    publish: (kind: 'catalog' | 'announcements' | 'polls', payload: unknown, message: string) =>
      ipcRenderer.invoke('content:publish', kind, payload, message)
  },
  polls: {
    createIssues: (poll: unknown) => ipcRenderer.invoke('polls:create-issues', poll)
  },
  releases: {
    list: () => ipcRenderer.invoke('releases:list'),
    selectZip: () => ipcRenderer.invoke('releases:select-zip'),
    inspectZip: (zipPath: string) => ipcRenderer.invoke('releases:inspect-zip', zipPath),
    publishSteps: () => ipcRenderer.invoke('releases:publish-steps'),
    publish: (request: unknown) => ipcRenderer.invoke('releases:publish', request),
    deleteDraft: (releaseId: number) => ipcRenderer.invoke('releases:delete-draft', releaseId),
    byTag: (tag: string) => ipcRenderer.invoke('releases:by-tag', tag),
    onProgress: (listener: (progress: unknown) => void): (() => void) => {
      const handler = (_e: unknown, payload: unknown) => listener(payload);
      ipcRenderer.on('publish:progress', handler);
      return () => ipcRenderer.removeListener('publish:progress', handler);
    }
  },
  versions: {
    validate: (payload: unknown) => ipcRenderer.invoke('versions:validate', payload)
  },
  system: {
    info: () => ipcRenderer.invoke('system:info'),
    openExternal: (url: string) => ipcRenderer.invoke('system:open-external', url),
    openUserData: () => ipcRenderer.invoke('system:open-user-data')
  }
};

contextBridge.exposeInMainWorld('teralynkAdmin', api);
