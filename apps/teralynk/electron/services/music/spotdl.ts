/**
 * Fonctionnalité native « Téléchargeur de musique » (spotdl).
 *
 * Principes :
 *  - AUTONOME : détecte Python, installe spotdl (pip --user) et ffmpeg
 *    (build statique téléchargé depuis les releases GitHub officielles
 *    BtbN/FFmpeg-Builds, décompressé dans un dossier local géré) APRÈS
 *    consentement explicite de l'utilisateur dans l'interface dédiée.
 *    Chaque dépendance possède SON bouton d'installation : rien n'est
 *    jamais installé sans un clic volontaire.
 *  - DISCRET : tous les processus sont lancés avec windowsHide (aucune console
 *    ne s'ouvre), sans shell, arguments fixes + URL validée en argument unique.
 *  - TRANSPARENT : chaque étape (statut, installation, téléchargement,
 *    conversion, sortie brute, erreurs, code de sortie, progression) est
 *    streamée vers l'UI via IPC 'music:event' — progression réelle, jamais simulée.
 *  - SÛR : seules les URLs https://*.spotify.com (track/album/playlist/artist)
 *    sont acceptées ; dossier de destination choisi par l'utilisateur via la
 *    vraie boîte de dialogue système ; environnement nettoyé.
 */
import { BrowserWindow, dialog, shell } from 'electron';
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateSpotifyUrl } from '@teralynk/shared';
import { findRuntime, type RuntimeInfo } from '../scripts/runtimes';
import { log } from '../logger';

const execFileAsync = promisify(execFile);

export type MusicStep = 'link' | 'ready' | 'download' | 'convert' | 'done';

export interface MusicEvent {
  runId: string;
  type: 'step' | 'line' | 'stderr' | 'error' | 'exit' | 'progress';
  step?: MusicStep;
  text?: string;
  code?: number | null;
  /** Progression réelle (0-100) d'un téléchargement de dépendance. */
  percent?: number;
  at: string;
}

export interface MusicStatus {
  python: boolean;
  pythonVersion?: string;
  /** Chemin de l'exécutable Python réellement utilisé (transparence multi-Python). */
  pythonPath?: string;
  spotdl: boolean;
  /** Version du module spotdl installé (métadonnées pip, lecture rapide). */
  spotdlVersion?: string;
  ffmpeg: boolean;
  /** Provenance de ffmpeg : PATH système ou build local géré par Teralynk. */
  ffmpegSource?: 'system' | 'managed';
  ffmpegPath?: string;
  platform: string;
}

/**
 * Détection de présence d'un module Python SANS l'importer (rapide et fiable).
 *
 * CORRECTION v1.5.1 : les sondages utilisaient `python -I -m spotdl …`.
 * Or `-I` (mode isolé) EXCLUT le site-packages utilisateur de sys.path —
 * exactement l'endroit où `pip install --user` installe spotdl. Résultat :
 * pip annonçait « Successfully installed » et Teralynk continuait de voir
 * spotdl comme absent (et l'exécution aurait échoué pareillement).
 * On sonde donc le module via importlib.util.find_spec, sans `-I`.
 */
const FIND_SPOTDL_CMD = 'import importlib.util as u; raise SystemExit(0 if u.find_spec("spotdl") else 1)';
const SPOTDL_VERSION_CMD = "import importlib.metadata as m; print(m.version('spotdl'))";

/** Build statique Windows officiel (releases GitHub BtbN/FFmpeg-Builds, LGPL : inclut libmp3lame). */
const FFMPEG_BUILD_URL = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl.zip';

const sessions = new Map<string, ChildProcessWithoutNullStreams>();

function send(window: BrowserWindow, event: MusicEvent): void {
  if (!window.isDestroyed()) window.webContents.send('music:event', event);
}

/* ------------------------------------------------------------------ */
/* ffmpeg géré par Teralynk (installation locale, sans toucher au système) */
/* ------------------------------------------------------------------ */

function managedToolsDir(): string {
  const base = process.env['LOCALAPPDATA'] || process.env['APPDATA'] || os.homedir();
  return path.join(base, 'Teralynk', 'tools');
}

function managedFfmpegConfigFile(): string {
  return path.join(managedToolsDir(), 'ffmpeg.json');
}

/** Répertoire bin/ du ffmpeg géré, s'il est installé et intact. */
export function managedFfmpegBinDir(): string | null {
  try {
    if (!existsSync(managedFfmpegConfigFile())) return null;
    const config = JSON.parse(readFileSync(managedFfmpegConfigFile(), 'utf8')) as { binDir?: string };
    if (!config.binDir) return null;
    const exe = path.join(config.binDir, 'ffmpeg.exe');
    return existsSync(exe) ? config.binDir : null;
  } catch {
    return null;
  }
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
  // Le ffmpeg géré par Teralynk passe DEVANT le PATH : spotdl le trouve
  // même si l'utilisateur n'a rien installé lui-même.
  const managed = managedFfmpegBinDir();
  if (managed) env.PATH = `${managed}${path.delimiter}${env.PATH ?? ''}`;
  return env;
}

async function which(command: string): Promise<string | null> {
  try {
    const finder = os.platform() === 'win32' ? 'where.exe' : 'which';
    const { stdout } = await execFileAsync(finder, [command], { timeout: 5000, windowsHide: true, env: cleanEnv() });
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
  // force=true : un Python installé APRÈS le lancement de l'app doit être vu
  // dès le prochain « Revérifier » (le cache de détection est rafraîchi).
  const python = await findRuntime('python', true);
  const status: MusicStatus = {
    python: Boolean(python),
    pythonVersion: python?.version,
    pythonPath: python?.executablePath,
    spotdl: false,
    ffmpeg: false,
    platform: os.platform()
  };
  if (python?.executablePath) {
    status.spotdl = await probe(python.executablePath, ['-c', FIND_SPOTDL_CMD], 15000);
    if (status.spotdl) {
      try {
        const { stdout } = await execFileAsync(python.executablePath, ['-c', SPOTDL_VERSION_CMD], {
          timeout: 15000,
          windowsHide: true,
          env: cleanEnv()
        });
        const version = stdout.trim().split(/\r?\n/)[0];
        if (version) status.spotdlVersion = version.slice(0, 40);
      } catch {
        /* version illisible : non bloquant */
      }
    }
  }
  const systemFfmpeg = (await which('ffmpeg')) ?? (await which('ffmpeg.exe'));
  if (systemFfmpeg) {
    status.ffmpeg = true;
    status.ffmpegSource = 'system';
    status.ffmpegPath = systemFfmpeg;
  } else {
    const managed = managedFfmpegBinDir();
    if (managed) {
      status.ffmpeg = true;
      status.ffmpegSource = 'managed';
      status.ffmpegPath = path.join(managed, 'ffmpeg.exe');
    }
  }
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

/** Ouvre le dossier de destination dans l'Explorateur (bouton « Ouvrir le dossier »). */
export async function openFolder(folder: string): Promise<{ ok: boolean; message?: string }> {
  try {
    const target = path.resolve(folder);
    if (!existsSync(target) || !statSync(target).isDirectory()) {
      return { ok: false, message: 'Ce dossier n’existe pas (ou plus). Choisissez-en un autre avec « Dossier… ».' };
    }
    const outcome = await shell.openPath(target);
    if (outcome) return { ok: false, message: outcome };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

/**
 * Installe spotdl (pip --user) avec consentement explicite — v1.5.1 « intelligent » :
 *  1. pré-vérification : si le module est déjà présent pour CE Python, rien n'est
 *     réinstallé (retour immédiat « déjà installé », statut mis à jour) ;
 *  2. installation SANS mode isolé (`-I` exclus le site user : c'était le bug
 *     1.5.0) et sans shell, fenêtre masquée, sortie streamée vers l'UI ;
 *  3. post-vérification par importlib : si pip sort 0 mais que le module reste
 *     introuvable pour cet exécutable, le message explique la cause probable
 *     (plusieurs Python installés) au lieu de laisser croire à un succès.
 */
export async function installSpotdl(window: BrowserWindow, confirmed: boolean): Promise<{ ok: boolean; message?: string }> {
  if (confirmed !== true) return { ok: false, message: 'Consentement explicite requis pour installer spotdl.' };
  const python: RuntimeInfo | null = await findRuntime('python', true);
  if (!python?.executablePath) return { ok: false, message: 'Python 3 est requis pour installer spotdl. Installez-le depuis python.org (cochez « Add to PATH »).' };

  const runId = randomUUID();
  const at = () => new Date().toISOString();

  // 1. Pré-vérification : déjà installé ?
  if (await probe(python.executablePath, ['-c', FIND_SPOTDL_CMD], 15000)) {
    send(window, { runId, type: 'step', step: 'done', text: 'spotdl est déjà installé pour ce Python : rien à réinstaller.', at: at() });
    send(window, { runId, type: 'exit', code: 0, at: at() });
    return { ok: true, message: 'spotdl était déjà installé : le statut a été mis à jour.' };
  }

  send(window, { runId, type: 'step', step: 'ready', text: 'Installation de spotdl (pip install --user spotdl)…', at: at() });
  log('info', 'Installation de spotdl demandée (consentement explicite)', { python: python.executablePath });

  return new Promise((resolve) => {
    const child = spawn(python.executablePath as string, ['-m', 'pip', 'install', '--user', '--upgrade', 'spotdl'], {
      windowsHide: true,
      shell: false,
      env: cleanEnv()
    }) as ChildProcessWithoutNullStreams;
    sessions.set(runId, child);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => send(window, { runId, type: 'line', text: String(chunk), at: at() }));
    child.stderr.on('data', (chunk: string) => send(window, { runId, type: 'stderr', text: String(chunk), at: at() }));
    child.on('error', (error) => {
      sessions.delete(runId);
      send(window, { runId, type: 'error', text: error.message, at: at() });
      resolve({ ok: false, message: error.message });
    });
    child.on('close', async (code) => {
      sessions.delete(runId);
      send(window, { runId, type: 'exit', code, at: at() });
      if (code !== 0) {
        log('error', `Échec de l'installation de spotdl (code ${code})`);
        resolve({ ok: false, message: `pip a quitté avec le code ${code}. Vérifiez la connexion Internet et la version de Python (3.8+). Si pip est absent : « python -m ensurepip ».` });
        return;
      }
      // 3. Post-vérification sur le MÊME exécutable que celui utilisé ici.
      const present = await probe(python.executablePath as string, ['-c', FIND_SPOTDL_CMD], 15000);
      if (present) {
        send(window, { runId, type: 'step', step: 'done', text: 'spotdl installé et vérifié pour ce Python.', at: at() });
        log('info', 'spotdl installé avec succès (module vérifié)');
        resolve({ ok: true });
      } else {
        const message = `pip a terminé sans erreur mais le module spotdl reste introuvable pour ${python.executablePath}. Cause probable : plusieurs installations Python coexistent et pip a installé ailleurs. Désinstallez les Python superflus ou réouvrez Teralynk après avoir laissé celui-ci premier dans le PATH.`;
        send(window, { runId, type: 'error', text: message, at: at() });
        log('error', 'spotdl installé mais module introuvable pour le Python courant', { python: python.executablePath });
        resolve({ ok: false, message });
      }
    });
  });
}

/**
 * Installe ffmpeg SANS toucher au système : téléchargement du build statique
 * officiel (releases GitHub BtbN/FFmpeg-Builds) dans %LOCALAPPDATA%\Teralynk\tools,
 * décompression, puis enregistrement du chemin dans ffmpeg.json.
 * Progression RÉELLE streamée vers l'UI (événements 'progress').
 * Consentement explicite requis — comme pour spotdl.
 */
export async function installFfmpeg(window: BrowserWindow, confirmed: boolean): Promise<{ ok: boolean; message?: string }> {
  if (confirmed !== true) return { ok: false, message: 'Consentement explicite requis pour installer ffmpeg.' };
  if (os.platform() !== 'win32') {
    return { ok: false, message: 'L’installation automatique de ffmpeg est réservée à Windows. Sur ce système, installez ffmpeg via votre gestionnaire de paquets.' };
  }
  const runId = randomUUID();
  const at = () => new Date().toISOString();
  const toolsDir = managedToolsDir();
  const zipPath = path.join(toolsDir, 'ffmpeg-download.zip');
  const extractDir = path.join(toolsDir, 'ffmpeg-extract');

  send(window, { runId, type: 'step', step: 'ready', text: 'Téléchargement du build officiel de ffmpeg (GitHub, ~90 Mo)…', at: at() });
  log('info', 'Installation de ffmpeg demandée (build statique géré)');

  try {
    mkdirSync(toolsDir, { recursive: true });
    if (existsSync(extractDir)) rmSync(extractDir, { recursive: true, force: true });

    /* ---- Téléchargement avec progression réelle ---- */
    const response = await fetch(FFMPEG_BUILD_URL, { redirect: 'follow' });
    if (!response.ok || !response.body) {
      const message = `Téléchargement impossible (HTTP ${response.status}). Vérifiez la connexion Internet, puis réessayez.`;
      send(window, { runId, type: 'error', text: message, at: at() });
      return { ok: false, message };
    }
    const total = Number(response.headers.get('content-length') ?? 0);
    const reader = response.body.getReader();
    const out = createWriteStream(zipPath);
    let received = 0;
    let lastSent = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.length;
        out.write(Buffer.from(value));
        const now = Date.now();
        if (now - lastSent > 400) {
          lastSent = now;
          send(window, {
            runId,
            type: 'progress',
            percent: total > 0 ? Math.min(99, (received / total) * 100) : undefined,
            text: `${(received / 1048576).toFixed(1)} Mo téléchargés${total > 0 ? ` / ${(total / 1048576).toFixed(1)} Mo` : ''}`,
            at: at()
          });
        }
      }
    }
    await new Promise<void>((resolve, reject) => {
      out.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
    send(window, { runId, type: 'progress', percent: 100, text: 'Téléchargement terminé — décompression…', at: at() });

    /* ---- Décompression (tar.exe natif Windows 10+, repli PowerShell) ---- */
    send(window, { runId, type: 'step', step: 'convert', text: 'Décompression de l’archive ffmpeg…', at: at() });
    mkdirSync(extractDir, { recursive: true });
    const tarOk = await probe('tar.exe', ['-xf', zipPath, '-C', extractDir], 120000);
    if (!tarOk) {
      log('warn', 'tar.exe a échoué — repli sur Expand-Archive (PowerShell)');
      await execFileAsync(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${extractDir}' -Force`],
        { timeout: 180000, windowsHide: true }
      );
    }

    /* ---- Localisation de bin/ffmpeg.exe ---- */
    let binDir: string | null = null;
    const walkFind = (dir: string, depth: number): void => {
      if (binDir || depth > 3) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (binDir) return;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walkFind(full, depth + 1);
        else if (entry.name === 'ffmpeg.exe') binDir = dir;
      }
    };
    walkFind(extractDir, 0);
    if (!binDir) {
      const message = 'Archive ffmpeg décompressée mais ffmpeg.exe introuvable. Réessayez ; si le problème persiste, installez ffmpeg manuellement (FAQ).';
      send(window, { runId, type: 'error', text: message, at: at() });
      return { ok: false, message };
    }

    writeFileSync(managedFfmpegConfigFile(), JSON.stringify({ binDir, installedAt: new Date().toISOString(), source: FFMPEG_BUILD_URL }, null, 2), 'utf8');
    try {
      rmSync(zipPath, { force: true });
      rmSync(extractDir, { recursive: true, force: true });
    } catch {
      /* nettoyage best-effort */
    }

    send(window, { runId, type: 'step', step: 'done', text: 'ffmpeg installé : Teralynk l’utilisera automatiquement (dossier local géré).', at: at() });
    send(window, { runId, type: 'exit', code: 0, at: at() });
    log('info', 'ffmpeg géré installé', { binDir });
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    send(window, { runId, type: 'error', text: message, at: at() });
    send(window, { runId, type: 'exit', code: 1, at: at() });
    log('error', 'Échec de l’installation de ffmpeg', { reason: message });
    try {
      rmSync(zipPath, { force: true });
    } catch {
      /* ignore */
    }
    return { ok: false, message: `Échec de l’installation automatique de ffmpeg : ${message}. Solution manuelle en 1 minute dans la FAQ ci-dessous.` };
  }
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
    // SANS `-I` : le mode isolé exclurait le site-packages utilisateur où
    // pip --user a installé spotdl (bug corrigé en v1.5.1).
    ['-m', 'spotdl', request.url.trim(), '--output', request.folder],
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
