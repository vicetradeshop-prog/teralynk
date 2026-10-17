/**
 * Fonctionnalité native « Téléchargeur de musique » (spotdl).
 *
 * Principes :
 *  - AUTONOME : détecte Python, installe spotdl (pip --user) et vérifie ffmpeg
 *    APRÈS consentement explicite de l'utilisateur dans l'interface dédiée.
 *  - DISCRET : tous les processus sont lancés avec windowsHide (aucune console
 *    ne s'ouvre), sans shell, arguments fixes + URL validée en argument unique.
 *  - TRANSPARENT : chaque étape (statut, installation, téléchargement,
 *    conversion, sortie brute, erreurs, code de sortie) est streamée vers l'UI
 *    via IPC 'music:event' — progression réelle, jamais simulée.
 *  - SÛR : seules les URLs https://*.spotify.com (track/album/playlist/artist)
 *    sont acceptées ; dossier de destination choisi par l'utilisateur via la
 *    vraie boîte de dialogue système ; environnement nettoyé.
 */
import { BrowserWindow, dialog } from 'electron';
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { validateSpotifyUrl } from '@teralynk/shared';
import { findRuntime, type RuntimeInfo } from '../scripts/runtimes';
import { log } from '../logger';

const execFileAsync = promisify(execFile);

export type MusicStep = 'link' | 'ready' | 'download' | 'convert' | 'done';

export interface MusicEvent {
  runId: string;
  type: 'step' | 'line' | 'stderr' | 'error' | 'exit';
  step?: MusicStep;
  text?: string;
  code?: number | null;
  at: string;
}

export interface MusicStatus {
  python: boolean;
  pythonVersion?: string;
  spotdl: boolean;
  ffmpeg: boolean;
  platform: string;
}

const sessions = new Map<string, ChildProcessWithoutNullStreams>();

function send(window: BrowserWindow, event: MusicEvent): void {
  if (!window.isDestroyed()) window.webContents.send('music:event', event);
}

function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'],
    SYSTEMROOT: process.env['SYSTEMROOT'],
    WINDIR: process.env['WINDIR'],
    TEMP: process.env['TEMP'],
    TMP: process.env['TMP'],
    HOME: process.env['HOME'],
    USERPROFILE: process.env['USERPROFILE'],
    APPDATA: process.env['APPDATA'],
    LOCALAPPDATA: process.env['LOCALAPPDATA'],
    PYTHONIOENCODING: 'utf-8'
  };
  for (const key of Object.keys(process.env)) {
    if (/TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL|AUTH/i.test(key)) delete env[key];
  }
  return env;
}

async function which(command: string): Promise<string | null> {
  try {
    const finder = os.platform() === 'win32' ? 'where.exe' : 'which';
    const { stdout } = await execFileAsync(finder, [command], { timeout: 5000, windowsHide: true });
    return stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0] ?? null;
  } catch {
    return null;
  }
}

function probe(exe: string, args: string[], timeoutMs = 20000): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(exe, args, { windowsHide: true, shell: false, env: cleanEnv() });
      const timer = setTimeout(() => {
        child.kill();
        resolve(false);
      }, timeoutMs);
      child.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
    } catch {
      resolve(false);
    }
  });
}

/** État réel de l'environnement (python / spotdl / ffmpeg). */
export async function musicStatus(): Promise<MusicStatus> {
  const python = await findRuntime('python');
  const status: MusicStatus = { python: Boolean(python), pythonVersion: python?.version, spotdl: false, ffmpeg: false, platform: os.platform() };
  if (python?.executablePath) {
    status.spotdl = await probe(python.executablePath, ['-I', '-m', 'spotdl', '--version']);
  }
  status.ffmpeg = (await which('ffmpeg')) !== null || (await which('ffmpeg.exe')) !== null;
  return status;
}

/** Dossier par défaut proposé : Musique/Teralynk. */
export function defaultMusicFolder(): string {
  return path.join(os.homedir(), 'Music', 'Teralynk');
}

/** Boîte de dialogue système de choix du dossier de destination. */
export async function pickFolder(window: BrowserWindow): Promise<{ ok: boolean; folder?: string; cancelled?: boolean }> {
  const result = await dialog.showOpenDialog(window, {
    title: 'Choisir le dossier de destination des musiques',
    defaultPath: defaultMusicFolder(),
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false, cancelled: true };
  return { ok: true, folder: result.filePaths[0] };
}

/**
 * Installe spotdl (pip --user) avec consentement explicite.
 * Fenêtre masquée, sortie streamée vers l'UI.
 */
export async function installSpotdl(window: BrowserWindow, confirmed: boolean): Promise<{ ok: boolean; message?: string }> {
  if (confirmed !== true) return { ok: false, message: 'Consentement explicite requis pour installer spotdl.' };
  const python: RuntimeInfo | null = await findRuntime('python');
  if (!python?.executablePath) return { ok: false, message: 'Python 3 est requis pour installer spotdl. Installez-le depuis python.org (cochez « Add to PATH »).' };

  const runId = randomUUID();
  send(window, { runId, type: 'step', step: 'ready', text: 'Installation de spotdl (pip install --user spotdl)…', at: new Date().toISOString() });
  log('info', 'Installation de spotdl demandée (consentement explicite)');

  return new Promise((resolve) => {
    const child = spawn(python.executablePath as string, ['-I', '-m', 'pip', 'install', '--user', '--upgrade', 'spotdl'], {
      windowsHide: true,
      shell: false,
      env: cleanEnv()
    }) as ChildProcessWithoutNullStreams;
    sessions.set(runId, child);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => send(window, { runId, type: 'line', text: String(chunk), at: new Date().toISOString() }));
    child.stderr.on('data', (chunk: string) => send(window, { runId, type: 'stderr', text: String(chunk), at: new Date().toISOString() }));
    child.on('error', (error) => {
      sessions.delete(runId);
      send(window, { runId, type: 'error', text: error.message, at: new Date().toISOString() });
      resolve({ ok: false, message: error.message });
    });
    child.on('close', (code) => {
      sessions.delete(runId);
      send(window, { runId, type: 'exit', code, at: new Date().toISOString() });
      if (code === 0) {
        log('info', 'spotdl installé avec succès');
        resolve({ ok: true });
      } else {
        log('error', `Échec de l'installation de spotdl (code ${code})`);
        resolve({ ok: false, message: `pip a quitté avec le code ${code}. Vérifiez la connexion Internet et la version de Python (3.8+).` });
      }
    });
  });
}

/**
 * Télécharge un lien Spotify via spotdl, dans le dossier choisi.
 * Étapes streamées : link → ready → download → convert → done.
 */
export async function downloadMusic(
  window: BrowserWindow,
  request: { url: string; folder: string }
): Promise<{ ok: true; runId: string } | { ok: false; message: string }> {
  const check = validateSpotifyUrl(request.url);
  if (!check.ok) return { ok: false, message: check.reason ?? 'Lien Spotify invalide.' };
  if (!request.folder || request.folder.length > 1000) return { ok: false, message: 'Dossier de destination invalide.' };

  const status = await musicStatus();
  if (!status.python) return { ok: false, message: 'Python 3 est absent : installez-le (python.org, cochez « Add to PATH »), puis réessayez.' };
  if (!status.spotdl) return { ok: false, message: 'spotdl n’est pas installé : utilisez le bouton d’installation automatique (consentement requis).' };
  if (!status.ffmpeg) {
    return { ok: false, message: 'ffmpeg est absent : spotdl en a besoin pour convertir en MP3. Voir la FAQ de la fonctionnalité (installation en 1 minute).' };
  }

  const python = await findRuntime('python');
  const runId = randomUUID();
  const at = () => new Date().toISOString();
  send(window, { runId, type: 'step', step: 'link', text: `Lien ${check.kind} validé (${request.url})`, at: at() });
  send(window, { runId, type: 'step', step: 'ready', text: 'spotdl et ffmpeg prêts', at: at() });
  send(window, { runId, type: 'step', step: 'download', text: 'Téléchargement du flux audio…', at: at() });
  log('info', 'Téléchargement spotdl démarré', { kind: check.kind, folder: request.folder });

  const child = spawn(
    python?.executablePath as string,
    ['-I', '-m', 'spotdl', request.url.trim(), '--output', request.folder],
    { windowsHide: true, shell: false, env: cleanEnv(), cwd: request.folder }
  ) as ChildProcessWithoutNullStreams;
  sessions.set(runId, child);

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  const onLine = (kind: 'line' | 'stderr') => (chunk: string) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (!line.trim()) continue;
      send(window, { runId, type: kind, text: line, at: at() });
      const lower = line.toLowerCase();
      if (kind === 'line' && (lower.includes('converting') || lower.includes('saving') || lower.includes('tagging'))) {
        send(window, { runId, type: 'step', step: 'convert', text: 'Conversion MP3 + tags & pochette…', at: at() });
      }
    }
  };
  child.stdout.on('data', onLine('line'));
  child.stderr.on('data', onLine('stderr'));

  child.on('error', (error) => {
    sessions.delete(runId);
    send(window, { runId, type: 'error', text: error.message, at: at() });
    log('error', 'Échec de lancement spotdl', { reason: error.message });
  });
  child.on('close', (code, signal) => {
    sessions.delete(runId);
    if (code === 0) {
      send(window, { runId, type: 'step', step: 'done', text: `Musique livrée dans ${request.folder}`, at: at() });
    }
    send(window, { runId, type: 'exit', code, at: at() });
    log('info', 'spotdl terminé', { code, signal });
  });

  return { ok: true, runId };
}

/** Arrête un téléchargement/installation en cours. */
export function stopMusic(runId: string): { ok: boolean; message?: string } {
  const child = sessions.get(runId);
  if (!child) return { ok: false, message: 'Processus introuvable ou déjà terminé.' };
  child.kill('SIGTERM');
  setTimeout(() => {
    try {
      child.kill('SIGKILL');
    } catch {
      /* déjà terminé */
    }
  }, 3000);
  return { ok: true };
}
