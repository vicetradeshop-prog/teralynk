/**
 * Test de régression v1.5.0 — surface IPC complète.
 *
 * Bug d'origine : le preload de Teralynk exposait music.* (status, install,
 * pick-folder, download, stop…) mais AUCUN canal correspondant n'était
 * enregistré côté processus principal : chaque appel échouait en
 * « No handler registered », donc spotdl ne s'installait pas et le bouton
 * « Dossier… » était inerte — sans aucune erreur visible.
 *
 * Ce test analyse statiquement le preload (ipcRenderer.invoke) et le
 * processus principal (ipcMain.handle) et exige que CHAQUE canal invoqué
 * possède un enregistrement. Toute nouvelle API oubliée cassera la livraison.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const preload = readFileSync(path.join(root, 'apps/teralynk/electron/preload.ts'), 'utf8');
const ipc = readFileSync(path.join(root, 'apps/teralynk/electron/ipc.ts'), 'utf8');

function invokedChannels(source: string): string[] {
  const channels = new Set<string>();
  const re = /ipcRenderer\.invoke\(\s*'([^']+)'/g;
  for (let m = re.exec(source); m; m = re.exec(source)) channels.add(m[1]);
  return [...channels];
}

function handledChannels(source: string): Set<string> {
  const channels = new Set<string>();
  const re = /ipcMain\.handle\(\s*'([^']+)'/g;
  for (let m = re.exec(source); m; m = re.exec(source)) channels.add(m[1]);
  return channels;
}

describe('surface IPC du renderer', () => {
  const invoked = invokedChannels(preload);
  const handled = handledChannels(ipc);

  it('expose des canaux (sanité)', () => {
    expect(invoked.length).toBeGreaterThan(15);
  });

  it('chaque canal invoqué par le preload est enregistré côté main', () => {
    const missing = invoked.filter((channel) => !handled.has(channel));
    expect(missing).toEqual([]);
  });

  it('les canaux musique (spotdl) sont bien enregistrés — régression v1.4.1', () => {
    for (const channel of [
      'music:status',
      'music:default-folder',
      'music:pick-folder',
      'music:open-folder',
      'music:install',
      'music:install-ffmpeg',
      'music:download',
      'music:stop'
    ]) {
      expect(handled.has(channel), `canal manquant : ${channel}`).toBe(true);
    }
  });

  it('le canal updates:install-now existe (redémarrage fiable v1.5.0)', () => {
    expect(handled.has('updates:install-now')).toBe(true);
    expect(invoked.includes('updates:install-now')).toBe(true);
  });
});
