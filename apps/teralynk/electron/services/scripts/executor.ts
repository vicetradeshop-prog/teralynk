/**
 * Exécution sécurisée des scripts du catalogue.
 *
 * Cycle complet (rien n'est jamais exécuté automatiquement) :
 *  1. `prepare`  : revalider la carte contre le manifeste publié, télécharger
 *                  le script depuis un hôte GitHub autorisé, vérifier son
 *                  empreinte SHA-256, détecter le runtime, et produire un
 *                  jeton de préparation à usage unique + aperçu du contenu.
 *  2. L'UI affiche l'écran de préparation (objectif, permissions, risques,
 *     contenu) et exige une confirmation explicite de l'utilisateur.
 *  3. `execute`  : vérifier le jeton, lancer le processus AVEC une liste
 *     d'arguments fixe (jamais de shell, jamais d'entrée utilisateur
 *     concaténée), diffuser stdout/stderr horodatés, mesurer la durée,
 *     permettre l'arrêt (arbre de processus inclus).
 */
import { app, BrowserWindow } from 'electron';
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  featureCardSchema,
  type FeatureCard,
  type RuntimeId
} from '@teralynk/shared';
import { safeEqualHex } from '@teralynk/shared/node';
import { fetchWithRetry, NetworkError } from '../net';
import { findRuntime, type RuntimeInfo } from './runtimes';
import { addHistory, loadPrefs } from '../prefs';
import { log } from '../logger';

const MAX_SCRIPT_BYTES = 2 * 1024 * 1024; // 2 Mo — un script légitime est petit
const PREPARE_TTL_MS = 10 * 60 * 1000; // un jeton de préparation expire après 10 min

export interface PreparedScript {
  token: string;
  cardId: string;
  cardVersion?: string;
  scriptPath: string;
  sha256: string;
  sha256Matches: true;
  runtime: RuntimeInfo;
  contentPreview: string; // 64 Ko max, pour affichage avant confirmation
  contentTruncated: boolean;
  requiresAdmin: boolean;
  preparedAt: number;
}

export interface PrepareFailure {
  ok: false;
  stage: 'validation' | 'download' | 'integrity' | 'runtime' | 'io';
  message: string;
  detail?: string;
}

export type PrepareResult = { ok: true; prepared: PreparedScript } | PrepareFailure;

const pending = new Map<string, PreparedScript>();

function scriptsRoot(): string {
  const dir = path.join(app.getPath('userData'), 'scripts');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Construit l'invocation exacte (exécutable + args) pour un runtime. */
function buildInvocation(runtime: RuntimeId, scriptPath: string, extraArgs: string[]): string[] {
  const exe = runtime === 'info' ? null : (findRuntimeSyncCache(runtime)?.executablePath ?? null);
  switch (runtime) {
    case 'powershell':
      return [exe ?? (os.platform() === 'win32' ? 'powershell.exe' : 'powershell'), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, ...extraArgs];
    case 'pwsh':
      return [exe ?? 'pwsh', '-NoProfile', '-NonInteractive', '-File', scriptPath, ...extraArgs];
    case 'python':
      return [exe ?? (os.platform() === 'win32' ? 'python.exe' : 'python3'), '-I', scriptPath, ...extraArgs];
    case 'node':
      return [exe ?? 'node', scriptPath, ...extraArgs];
    case 'batch':
      return [exe ?? 'cmd.exe', '/d', '/s', '/c', `"${scriptPath}"`, ...extraArgs];
    default:
      throw new Error(`Runtime non exécutable : ${runtime}`);
  }
}

// Cache synchrone minimal alimenté par findRuntime (évite un await dans buildInvocation).
let runtimeCache: Map<RuntimeId, RuntimeInfo> = new Map();
function findRuntimeSyncCache(id: RuntimeId): RuntimeInfo | undefined {
  return runtimeCache.get(id);
}

/**
 * ÉTAPE 1 — Préparation. Télécharge, vérifie l'intégrité, prépare l'exécution.
 * `cardPayload` provient du manifeste de catalogue que l'UI affiche ; il est
 * REVALIDÉ ici (défense en profondeur : l'UI ne fait jamais autorité).
 */
export async function prepareScript(cardPayload: unknown): Promise<PrepareResult> {
  // 1. Revalidation complète de la carte.
  const parsed = featureCardSchema.safeParse(cardPayload);
  if (!parsed.success) {
    return { ok: false, stage: 'validation', message: 'La carte transmise est invalide et ne peut pas être exécutée.', detail: parsed.error.issues.map((i) => i.message).join('; ') };
  }
  const card: FeatureCard = parsed.data;
  if (!card.enabled || !card.script || card.script.runtime === 'info') {
    return { ok: false, stage: 'validation', message: 'Cette fonctionnalité n’est pas exécutable (carte informative ou désactivée).' };
  }
  if (card.status !== 'available' && card.status !== 'new' && card.status !== 'experimental') {
    return { ok: false, stage: 'validation', message: `Cette fonctionnalité n’est pas disponible actuellement (statut : ${card.status}).` };
  }
  if (!card.platforms.includes(os.platform() === 'win32' ? 'windows' : os.platform() === 'darwin' ? 'macos' : 'linux')) {
    return { ok: false, stage: 'validation', message: `Ce script n’est pas compatible avec votre système (${os.platform()}).` };
  }
  if (!card.script.sha256) {
    return { ok: false, stage: 'validation', message: 'Ce script ne peut pas être exécuté : son empreinte SHA-256 est absente du manifeste publié.' };
  }

  // 2. Runtime présent ?
  const runtime = await findRuntime(card.script.runtime);
  if (!runtime) {
    const all = await (await import('./runtimes')).detectRuntimes();
    runtimeCache = new Map(all.map((r) => [r.id, r]));
    const info = runtimeCache.get(card.script.runtime);
    return {
      ok: false,
      stage: 'runtime',
      message: `Le runtime « ${card.script.runtime} » n’est pas installé sur cet ordinateur.`,
      detail: info?.installHint
    };
  }
  runtimeCache.set(runtime.id, runtime);

  // 3. Téléchargement depuis l'URL validée (hôtes GitHub uniquement — voir schéma).
  let body: Uint8Array;
  try {
    const result = await fetchWithRetry(card.script.url, { timeoutMs: 30000, retries: 2 });
    body = result.body;
  } catch (error) {
    const detail = error instanceof NetworkError ? error.message : (error as Error).message;
    return { ok: false, stage: 'download', message: 'Le téléchargement du script a échoué.', detail };
  }
  if (body.length > MAX_SCRIPT_BYTES) {
    return { ok: false, stage: 'integrity', message: `Le script téléchargé dépasse la taille maximale autorisée (${MAX_SCRIPT_BYTES} octets).` };
  }

  // 4. Vérification SHA-256 contre le manifeste — non négociable.
  const actual = createHash('sha256').update(body).digest('hex');
  if (!safeEqualHex(actual, card.script.sha256)) {
    log('error', `Script ${card.id} : EMPREINTE INCOHÉRENTE — exécution refusée`, { expected: card.script.sha256, actual });
    return {
      ok: false,
      stage: 'integrity',
      message: 'L’empreinte SHA-256 du script téléchargé ne correspond pas au manifeste publié. Le fichier a été modifié ou corrompu : exécution refusée.',
      detail: `attendu ${card.script.sha256} — reçu ${actual}`
    };
  }

  // 5. Écriture dans un répertoire dédié et isolé par carte+version.
  try {
    const versionPart = card.version ?? '0.0.0';
    const dir = path.join(scriptsRoot(), `${card.slug}@${versionPart}`);
    mkdirSync(dir, { recursive: true });
    const ext = card.script.runtime === 'python' ? '.py' : card.script.runtime === 'node' ? '.js' : card.script.runtime === 'batch' ? '.cmd' : '.ps1';
    const scriptPath = path.join(dir, `script${ext}`);
    writeFileSync(scriptPath, Buffer.from(body));

    const previewBuffer = Buffer.from(body).subarray(0, 64 * 1024);
    const prepared: PreparedScript = {
      token: randomBytes(24).toString('hex'),
      cardId: card.id,
      cardVersion: card.version,
      scriptPath,
      sha256: actual,
      sha256Matches: true,
      runtime,
      contentPreview: previewBuffer.toString('utf8'),
      contentTruncated: body.length > previewBuffer.length,
      requiresAdmin: card.script.requiresAdmin,
      preparedAt: Date.now()
    };
    pending.set(prepared.token, prepared);
    // Nettoyage des jetons expirés.
    for (const [token, entry] of pending) {
      if (Date.now() - entry.preparedAt > PREPARE_TTL_MS) pending.delete(token);
    }
    return { ok: true, prepared };
  } catch (error) {
    return { ok: false, stage: 'io', message: 'Impossible d’enregistrer le script vérifié sur le disque.', detail: (error as Error).message };
  }
}

/* ------------------------------------------------------------------ */
/* ÉTAPE 2 — Exécution confirmée                                        */
/* ------------------------------------------------------------------ */

export interface RunSession {
  runId: string;
  cardId: string;
  startedAt: number;
  child: ChildProcessWithoutNullStreams;
  pid: number;
}

const sessions = new Map<string, RunSession>();

export type RunEvent =
  | { type: 'stdout'; text: string; at: string }
  | { type: 'stderr'; text: string; at: string }
  | { type: 'info'; text: string; at: string }
  | { type: 'exit'; code: number | null; signal: string | null; durationMs: number; at: string };

/**
 * Démarre l'exécution d'un script préparé ET confirmé par l'utilisateur.
 * Le jeton de préparation est à usage unique : une seconde exécution exige
 * une nouvelle préparation (et donc une nouvelle vérification d'intégrité).
 */
export function executePrepared(token: string, window: BrowserWindow, cardMeta: { cardId: string; confirmed: true }): { ok: true; runId: string } | { ok: false; message: string } {
  const prepared = pending.get(token);
  if (!prepared || prepared.cardId !== cardMeta.cardId) {
    return { ok: false, message: 'Session de préparation introuvable ou expirée. Relancez la préparation du script.' };
  }
  if (cardMeta.confirmed !== true) {
    return { ok: false, message: 'Confirmation utilisateur manquante.' };
  }
  if (!existsSync(prepared.scriptPath)) {
    pending.delete(token);
    return { ok: false, message: 'Le script vérifié n’est plus présent sur le disque. Relancez la préparation.' };
  }
  pending.delete(token); // usage unique

  const runId = randomUUID();
  const send = (event: RunEvent) => {
    if (!window.isDestroyed()) window.webContents.send('scripts:event', { runId, ...event });
  };

  let invocation: string[];
  try {
    invocation = buildInvocation(prepared.runtime.id, prepared.scriptPath, []);
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
  const [executable, ...args] = invocation;

  send({ type: 'info', text: `Exécution : ${prepared.runtime.label} — empreinte vérifiée ${prepared.sha256.slice(0, 12)}…`, at: new Date().toISOString() });

  const child = spawn(executable as string, args, {
    cwd: path.dirname(prepared.scriptPath),
    // Pas de shell : les arguments sont passés directement au processus.
    shell: false,
    windowsHide: true,
    detached: os.platform() !== 'win32', // permet de tuer le groupe sur POSIX
    env: sanitizedEnv()
  }) as ChildProcessWithoutNullStreams;

  const startedAt = Date.now();
  sessions.set(runId, { runId, cardId: prepared.cardId, startedAt, child, pid: child.pid ?? -1 });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => send({ type: 'stdout', text: String(chunk), at: new Date().toISOString() }));
  child.stderr.on('data', (chunk: string) => send({ type: 'stderr', text: String(chunk), at: new Date().toISOString() }));

  child.on('error', (error) => {
    send({ type: 'stderr', text: `Erreur de lancement du processus : ${error.message}`, at: new Date().toISOString() });
    send({ type: 'exit', code: null, signal: null, durationMs: Date.now() - startedAt, at: new Date().toISOString() });
    sessions.delete(runId);
    addHistory({ type: 'script-failed', cardId: prepared.cardId, detail: error.message.slice(0, 400), exitCode: null });
    log('error', `Échec de lancement du script ${prepared.cardId}`, { reason: error.message });
  });

  child.on('close', (code, signal) => {
    const durationMs = Date.now() - startedAt;
    send({ type: 'exit', code, signal: signal ?? null, durationMs, at: new Date().toISOString() });
    sessions.delete(runId);
    addHistory({
      type: code === 0 ? 'script-run' : signal ? 'script-cancelled' : 'script-failed',
      cardId: prepared.cardId,
      detail: `${prepared.runtime.label} ${prepared.runtime.version ?? ''}`.trim(),
      exitCode: code
    });
    log('info', `Script ${prepared.cardId} terminé`, { code, signal, durationMs });
  });

  log('info', `Script ${prepared.cardId} démarré`, { runtime: prepared.runtime.id, pid: child.pid });
  return { ok: true, runId };
}

/** Environnement nettoyé : aucun jeton, aucune variable sensible transmise au script. */
function sanitizedEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env['PATH'],
    SYSTEMROOT: process.env['SYSTEMROOT'],
    WINDIR: process.env['WINDIR'],
    TEMP: process.env['TEMP'],
    TMP: process.env['TMP'],
    HOME: process.env['HOME'],
    LANG: process.env['LANG'],
    TERM: process.env['TERM'],
    USERPROFILE: process.env['USERPROFILE'],
    APPDATA: process.env['APPDATA'],
    LOCALAPPDATA: process.env['LOCALAPPDATA'],
    COMSPEC: process.env['COMSPEC'],
    PATHEXT: process.env['PATHEXT']
  };
  // Supprime explicitement toute variable ressemblant à un secret.
  for (const key of Object.keys(process.env)) {
    if (/TOKEN|SECRET|KEY|PASSWORD|CREDENTIAL|AUTH/i.test(key)) delete env[key];
  }
  env['TERALYNK_HISTORY_RETENTION_DAYS'] = String(loadPrefs().historyRetentionDays);
  return env;
}

/** Arrête une exécution en cours (arbre de processus inclus). */
export function stopRun(runId: string): { ok: boolean; message?: string } {
  const session = sessions.get(runId);
  if (!session) return { ok: false, message: 'Exécution introuvable ou déjà terminée.' };
  try {
    if (os.platform() === 'win32') {
      execFile('taskkill.exe', ['/pid', String(session.pid), '/T', '/F'], { windowsHide: true }, () => {
        /* le résultat arrive via l'événement close */
      });
    } else {
      process.kill(-session.pid, 'SIGTERM');
      setTimeout(() => {
        try {
          process.kill(-session.pid, 'SIGKILL');
        } catch {
          /* déjà terminé */
        }
      }, 3000);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

/** Relit un script vérifié déjà téléchargé (aperçu pour l'écran de préparation). */
export function readPreparedContent(token: string): string | null {
  const prepared = pending.get(token);
  if (!prepared || !existsSync(prepared.scriptPath)) return null;
  try {
    return readFileSync(prepared.scriptPath, 'utf8').slice(0, 256 * 1024);
  } catch {
    return null;
  }
}
