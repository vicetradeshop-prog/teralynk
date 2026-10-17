/**
 * Couche IPC de Teralynk — frontière sécurisée renderer ↔ main.
 *
 * Règles :
 *  - CHAQUE payload entrant est validé par zod avant traitement.
 *  - Aucune fonction système arbitraire n'est exposée : uniquement les
 *    opérations listées ici, avec des paramètres contraints.
 *  - Les jetons ne transitent JAMAIS vers le renderer (sauf statut booléen).
 */
import { ipcMain, shell, app, type BrowserWindow } from 'electron';
import { z } from 'zod';
import os from 'node:os';
import { loadCatalog, loadAnnouncements, loadPolls, clearContentCache } from './services/content';
import { runUpdateGate, downloadAndInstallUpdate, installDownloadedUpdate } from './services/updates';
import { detectRuntimes } from './services/scripts/runtimes';
import { prepareScript, executePrepared, stopRun } from './services/scripts/executor';
import { fetchPollResults, castGithubVote, storeUserGithubToken, clearUserGithubToken, userTokenStatus } from './services/polls';
import {
  musicStatus,
  installSpotdl,
  installFfmpeg,
  pickFolder,
  openFolder,
  downloadMusic,
  stopMusic,
  defaultMusicFolder
} from './services/music/spotdl';
import { loadPrefs, savePrefs, resetPrefs, type Prefs } from './services/prefs';
import { checkGitHubReachable } from './services/net';
import { logsDirectory, log } from './services/logger';
import { pollSchema, REMOTE_CONFIG, repoWebUrl, releasesWebUrl, type Poll } from '@teralynk/shared';

const cardIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,63}$/);
const prefsPatchSchema = z
  .object({
    theme: z.enum(['dark']),
    accent: z.enum(['violet', 'blue', 'iridescent']),
    reduceMotion: z.enum(['system', 'on', 'off']),
    visualIntensity: z.enum(['subtle', 'balanced', 'rich']),
    skipIntro: z.boolean(),
    updateChannel: z.enum(['stable', 'beta']),
    windowStart: z.enum(['default', 'maximized']),
    historyRetentionDays: z.number().int().min(1).max(365),
    favorites: z.array(cardIdSchema).max(500),
    lastFilters: z
      .object({
        query: z.string().max(200),
        category: z.string().max(60).nullable(),
        status: z.string().max(30).nullable(),
        platform: z.string().max(20).nullable(),
        sort: z.enum(['featured', 'name', 'created', 'updated'])
      })
      .partial(),
    localPollVotes: z.record(z.string().max(64), z.string().max(64)),
    seenCardVersions: z.record(z.string().max(64), z.string().max(30))
  })
  .partial();

const prepareTokenSchema = z.string().regex(/^[a-f0-9]{48}$/);
const externalUrlSchema = z.string().url().refine((u) => u.startsWith('https://'));

export function registerIpcHandlers(getWindow: () => BrowserWindow | null): void {
  /* ---------------- Système / diagnostic ---------------- */

  ipcMain.handle('system:info', () => ({
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    platform: os.platform(),
    arch: os.arch(),
    osRelease: os.release(),
    locale: app.getLocale(),
    packaged: app.isPackaged,
    repoUrl: repoWebUrl(),
    releasesUrl: releasesWebUrl(),
    remote: { owner: REMOTE_CONFIG.owner, repo: REMOTE_CONFIG.repo, branch: REMOTE_CONFIG.contentBranch }
  }));

  ipcMain.handle('system:github-status', () => checkGitHubReachable());

  ipcMain.handle('system:open-logs', async () => {
    const dir = logsDirectory();
    await shell.openPath(dir);
    return { ok: true, dir };
  });

  ipcMain.handle('system:open-external', (_event, url: unknown) => {
    const parsed = externalUrlSchema.safeParse(url);
    if (!parsed.success) return { ok: false, message: 'URL refusée (https uniquement).' };
    const host = new URL(parsed.data).hostname;
    const allowed = ['github.com', 'raw.githubusercontent.com', 'www.python.org', 'nodejs.org', 'teralynk.app'];
    if (!allowed.includes(host)) return { ok: false, message: `Hôte externe non autorisé : ${host}` };
    void shell.openExternal(parsed.data);
    return { ok: true };
  });

  /* ---------------- Mises à jour (obligatoires) ---------------- */

  ipcMain.handle('updates:check', (_event, channel: unknown) => {
    const parsed = z.enum(['stable', 'beta']).optional().safeParse(channel);
    if (!parsed.success) return { error: 'Canal invalide' };
    return runUpdateGate(parsed.data);
  });

  ipcMain.handle('updates:download', async () => {
    const window = getWindow();
    if (!window) return { started: false, error: 'Fenêtre indisponible' };
    return downloadAndInstallUpdate(window);
  });

  ipcMain.handle('updates:install-now', () => {
    const window = getWindow();
    if (!window) return { ok: false, error: 'Fenêtre indisponible.' };
    return installDownloadedUpdate(window);
  });

  /* ---------------- Contenu distant ---------------- */

  ipcMain.handle('content:catalog', async () => {
    try {
      return { ok: true, ...(await loadCatalog()) };
    } catch (error) {
      return { ok: false, error: toContentError(error) };
    }
  });

  ipcMain.handle('content:announcements', async () => {
    try {
      return { ok: true, ...(await loadAnnouncements()) };
    } catch (error) {
      return { ok: false, error: toContentError(error) };
    }
  });

  ipcMain.handle('content:polls', async () => {
    try {
      return { ok: true, ...(await loadPolls()) };
    } catch (error) {
      return { ok: false, error: toContentError(error) };
    }
  });

  ipcMain.handle('content:clear-cache', () => {
    clearContentCache();
    return { ok: true };
  });

  /* ---------------- Préférences locales ---------------- */

  ipcMain.handle('prefs:get', (): Prefs => loadPrefs());

  ipcMain.handle('prefs:patch', (_event, patch: unknown): Prefs => {
    const parsed = prefsPatchSchema.safeParse(patch);
    if (!parsed.success) throw new Error(`Préférences invalides : ${parsed.error.issues.map((i) => i.message).join('; ')}`);
    const current = loadPrefs();
    const { lastFilters, ...rest } = parsed.data;
    const merged: Partial<Prefs> = { ...rest };
    if (lastFilters) merged.lastFilters = { ...current.lastFilters, ...lastFilters };
    return savePrefs(merged);
  });

  ipcMain.handle('prefs:reset', (): Prefs => resetPrefs());

  /* ---------------- Scripts ---------------- */

  ipcMain.handle('scripts:runtimes', () => detectRuntimes());

  // La carte est revalidée côté main : l'UI ne fait jamais autorité.
  ipcMain.handle('scripts:prepare', (_event, card: unknown) => prepareScript(card));

  ipcMain.handle(
    'scripts:execute',
    (_event, payload: unknown) => {
      const schema = z.object({ token: prepareTokenSchema, cardId: cardIdSchema });
      const parsed = schema.safeParse(payload);
      if (!parsed.success) return { ok: false, message: 'Requête d’exécution invalide.' };
      const window = getWindow();
      if (!window) return { ok: false, message: 'Fenêtre indisponible.' };
      // L'exécution n'est possible qu'avec un jeton de préparation valide,
      // donc APRÈS téléchargement + vérification SHA-256 + confirmation UI.
      return executePrepared(parsed.data.token, window, { cardId: parsed.data.cardId, confirmed: true });
    }
  );

  ipcMain.handle('scripts:stop', (_event, runId: unknown) => {
    const parsed = z.string().uuid().safeParse(runId);
    if (!parsed.success) return { ok: false, message: 'Identifiant d’exécution invalide.' };
    return stopRun(parsed.data);
  });

  /* ---------------- Musique (spotdl) — CORRECTION v1.5.0 ----------------
   * Ces handlers ÉTAIENT ABSENTS : le preload exposait music.* mais aucun
   * canal n'était enregistré côté main → « Installer spotdl », « Dossier… »
   * et le téléchargement échouaient silencieusement (No handler registered).
   * Chaque payload est validé par zod, comme le reste de la surface IPC.
   */

  ipcMain.handle('music:status', () => musicStatus());

  ipcMain.handle('music:default-folder', () => ({ ok: true, folder: defaultMusicFolder() }));

  ipcMain.handle('music:pick-folder', async () => {
    const window = getWindow();
    if (!window) return { ok: false, message: 'Fenêtre indisponible.' };
    return pickFolder(window);
  });

  ipcMain.handle('music:open-folder', async (_event, folder: unknown) => {
    const parsed = z.string().min(3).max(260).safeParse(folder);
    if (!parsed.success) return { ok: false, message: 'Chemin de dossier invalide.' };
    return openFolder(parsed.data);
  });

  ipcMain.handle('music:install', async (_event, payload: unknown) => {
    const parsed = z.object({ confirmed: z.literal(true) }).safeParse(payload);
    if (!parsed.success) return { ok: false, message: 'Consentement explicite requis pour installer spotdl.' };
    const window = getWindow();
    if (!window) return { ok: false, message: 'Fenêtre indisponible.' };
    return installSpotdl(window, true);
  });

  ipcMain.handle('music:install-ffmpeg', async (_event, payload: unknown) => {
    const parsed = z.object({ confirmed: z.literal(true) }).safeParse(payload);
    if (!parsed.success) return { ok: false, message: 'Consentement explicite requis pour installer ffmpeg.' };
    const window = getWindow();
    if (!window) return { ok: false, message: 'Fenêtre indisponible.' };
    return installFfmpeg(window, true);
  });

  ipcMain.handle('music:download', async (_event, payload: unknown) => {
    const parsed = z.object({ url: z.string().min(1).max(2048), folder: z.string().min(3).max(260) }).safeParse(payload);
    if (!parsed.success) return { ok: false, message: 'Requête de téléchargement invalide.' };
    const window = getWindow();
    if (!window) return { ok: false, message: 'Fenêtre indisponible.' };
    return downloadMusic(window, { url: parsed.data.url, folder: parsed.data.folder });
  });

  ipcMain.handle('music:stop', (_event, runId: unknown) => {
    const parsed = z.string().uuid().safeParse(runId);
    if (!parsed.success) return { ok: false, message: 'Identifiant d’exécution invalide.' };
    return stopMusic(parsed.data);
  });

  /* ---------------- Sondages ---------------- */

  ipcMain.handle('polls:results', (_event, pollPayload: unknown) => {
    const parsed = pollSchema.safeParse(pollPayload);
    if (!parsed.success) return { ok: false, message: 'Sondage invalide.' };
    return fetchPollResults(parsed.data as Poll)
      .then((results) => ({ ok: true, results }))
      .catch((error: Error) => ({ ok: false, message: error.message }));
  });

  ipcMain.handle('polls:vote-github', (_event, payload: unknown) => {
    const parsed = z.object({ poll: pollSchema, optionId: z.string().min(1).max(64) }).safeParse(payload);
    if (!parsed.success) return { ok: false, message: 'Requête de vote invalide.' };
    return castGithubVote(parsed.data.poll as Poll, parsed.data.optionId);
  });

  ipcMain.handle('polls:token-status', () => userTokenStatus());

  ipcMain.handle('polls:store-token', (_event, token: unknown) => {
    const parsed = z.string().min(20).max(300).safeParse(token);
    if (!parsed.success) return { ok: false, message: 'Jeton invalide.' };
    const result = storeUserGithubToken(parsed.data);
    log('info', result.ok ? 'Jeton GitHub utilisateur enregistré (chiffré)' : 'Échec enregistrement jeton utilisateur');
    return result;
  });

  ipcMain.handle('polls:clear-token', () => {
    clearUserGithubToken();
    return { ok: true };
  });
}

function toContentError(error: unknown): { kind: string; message: string; detail?: string } {
  if (error instanceof Error && 'kind' in error) {
    const e = error as Error & { kind: string; detail?: string };
    return { kind: e.kind, message: e.message, detail: e.detail };
  }
  return { kind: 'unknown', message: (error as Error)?.message ?? 'Erreur inconnue' };
}
