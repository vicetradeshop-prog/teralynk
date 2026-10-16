/**
 * Couche IPC de Teralynk Admin — le jeton GitHub ne traverse JAMAIS cette
 * frontière vers le renderer : les opérations authentifiées s'exécutent ici,
 * le renderer ne reçoit que des statuts et des résultats.
 */
import { ipcMain, dialog, shell, BrowserWindow, app } from 'electron';
import { z } from 'zod';
import path from 'node:path';
import { statSync, existsSync } from 'node:fs';
import {
  catalogManifestSchema,
  announcementsManifestSchema,
  pollsManifestSchema,
  versionManifestSchema,
  semverSchema,
  type Poll
} from '@teralynk/shared';
import { signManifest } from '@teralynk/shared/node';
import {
  adminTokenStatus, clearAdminToken, getLogs, clearLogs, addLog,
  getConfig, saveConfig, readAdminToken, storeAdminToken, readSigningKey
} from './services/vault';
import {
  validateToken, readFile, writeFile, listReleases, getReleaseByTag,
  createIssue, deleteRelease, GitHubApiError
} from './services/github';
import { inspectZip } from './services/zip-inspect';
import { publishRelease, publishSteps, type PublishRequest, type PublishProgress } from './services/publish';

type ContentKind = 'catalog' | 'announcements' | 'polls' | 'versions';

const CONTENT_PATHS: Record<Exclude<ContentKind, 'versions'>, string> = {
  catalog: 'content/catalog.json',
  announcements: 'content/announcements.json',
  polls: 'content/polls.json'
};

const contentSchemas = {
  catalog: catalogManifestSchema,
  announcements: announcementsManifestSchema,
  polls: pollsManifestSchema
} as const;

function requireToken(): string {
  const token = readAdminToken();
  if (!token) {
    throw new Error('Aucun jeton administrateur enregistré. Connectez-vous d’abord (écran de connexion).');
  }
  return token;
}

function apiErrorMessage(error: unknown): { message: string; status?: number; hint?: string } {
  if (error instanceof GitHubApiError) {
    return { message: error.message, status: error.status, hint: error.githubMessage };
  }
  return { message: (error as Error)?.message ?? 'Erreur inconnue' };
}

export function registerAdminIpc(getWindow: () => BrowserWindow | null): void {
  /* ---------------- Jeton / connexion ---------------- */

  ipcMain.handle('admin:token-status', () => adminTokenStatus());

  ipcMain.handle('admin:store-token', (_e, token: unknown) => {
    const parsed = z.string().min(20).max(400).safeParse(token);
    if (!parsed.success) return { ok: false, message: 'Jeton invalide (chaîne trop courte ou trop longue).' };
    return storeAdminToken(parsed.data);
  });

  ipcMain.handle('admin:validate-token', async () => {
    try {
      const token = requireToken();
      const config = getConfig();
      const result = await validateToken(token, config.repoOwner, config.repoName);
      return { ok: true, ...result, repo: `${config.repoOwner}/${config.repoName}`, branch: config.contentBranch };
    } catch (error) {
      addLog('Validation du jeton échouée', 'failed', apiErrorMessage(error).message);
      return { ok: false, ...apiErrorMessage(error) };
    }
  });

  ipcMain.handle('admin:clear-token', () => {
    clearAdminToken();
    return { ok: true };
  });

  /* ---------------- Configuration ---------------- */

  ipcMain.handle('admin:config-get', () => getConfig());

  ipcMain.handle('admin:config-save', (_e, patch: unknown) => {
    const schema = z
      .object({
        repoOwner: z.string().regex(/^[A-Za-z0-9-]{1,100}$/, 'Propriétaire invalide'),
        repoName: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/, 'Nom de dépôt invalide'),
        contentBranch: z.string().regex(/^[A-Za-z0-9/_.-]{1,100}$/, 'Branche invalide'),
        signingKeyPath: z.string().max(1000).nullable()
      })
      .partial();
    const parsed = schema.safeParse(patch);
    if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => i.message).join('; ') };
    return { ok: true, config: saveConfig(parsed.data) };
  });

  ipcMain.handle('admin:select-signing-key', async () => {
    const window = getWindow();
    if (!window) return { ok: false, message: 'Fenêtre indisponible' };
    const result = await dialog.showOpenDialog(window, {
      title: 'Sélectionner la clé privée de signature (Ed25519 PEM)',
      filters: [{ name: 'Clé PEM', extensions: ['pem', 'key'] }, { name: 'Tous les fichiers', extensions: ['*'] }],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, cancelled: true };
    const filePath = result.filePaths[0]!;
    const saved = saveConfig({ signingKeyPath: filePath });
    // Test immédiat : la clé doit être lisible et utilisable.
    const key = readSigningKey();
    if (!key.ok) return { ok: false, message: key.message };
    addLog('Clé de signature configurée', 'success', path.basename(filePath));
    return { ok: true, config: saved, fileName: path.basename(filePath) };
  });

  ipcMain.handle('admin:signing-key-status', () => {
    const { signingKeyPath } = getConfig();
    if (!signingKeyPath) return { configured: false, exists: false };
    return { configured: true, exists: existsSync(signingKeyPath), fileName: path.basename(signingKeyPath) };
  });

  /* ---------------- Journaux ---------------- */

  ipcMain.handle('admin:logs-get', () => getLogs());
  ipcMain.handle('admin:logs-clear', () => {
    clearLogs();
    return { ok: true };
  });

  /* ---------------- Contenu distant (lecture) ---------------- */

  ipcMain.handle('content:read', async (_e, kind: unknown) => {
    const parsedKind = z.enum(['catalog', 'announcements', 'polls', 'versions']).safeParse(kind);
    if (!parsedKind.success) return { ok: false, message: 'Type de contenu invalide.' };
    try {
      const token = requireToken();
      const config = getConfig();
      if (parsedKind.data === 'versions') {
        const out: Record<string, unknown> = {};
        for (const channel of ['stable', 'beta']) {
          const raw = await readFile(token, `versions/${channel}.json`);
          out[channel] = raw ? { content: JSON.parse(raw.content), sha: raw.sha } : null;
        }
        return { ok: true, versions: out, repo: `${config.repoOwner}/${config.repoName}` };
      }
      const filePath = CONTENT_PATHS[parsedKind.data];
      const raw = await readFile(token, filePath);
      if (!raw) return { ok: true, content: null, path: filePath, exists: false };
      let validation: { ok: boolean; issues?: string } = { ok: true };
      const schemaParsed = contentSchemas[parsedKind.data].safeParse(JSON.parse(raw.content));
      if (!schemaParsed.success) {
        validation = { ok: false, issues: schemaParsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
      }
      return { ok: true, content: schemaParsed.success ? schemaParsed.data : JSON.parse(raw.content), path: filePath, exists: true, sha: raw.sha, validation };
    } catch (error) {
      return { ok: false, ...apiErrorMessage(error) };
    }
  });

  /* ---------------- Contenu distant (publication signée) ---------------- */

  ipcMain.handle('content:publish', async (_e, kind: unknown, payload: unknown, message: unknown) => {
    const parsedKind = z.enum(['catalog', 'announcements', 'polls']).safeParse(kind);
    const parsedMessage = z.string().min(3).max(200).safeParse(message);
    if (!parsedKind.success || !parsedMessage.success) return { ok: false, message: 'Paramètres de publication invalides.' };
    try {
      const token = requireToken();
      // 1. Validation stricte du contenu AVANT publication.
      const schemaParsed = contentSchemas[parsedKind.data].safeParse(payload);
      if (!schemaParsed.success) {
        return {
          ok: false,
          message: `Contenu refusé par le schéma de validation : ${schemaParsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
        };
      }
      // 2. Signature obligatoire (l'application utilisateur vérifie les signatures).
      const key = readSigningKey();
      if (!key.ok) {
        return { ok: false, message: `Signature impossible : ${key.message} — configurez la clé privée avant toute publication.` };
      }
      const body = JSON.stringify({ ...schemaParsed.data, generatedAt: new Date().toISOString() }, null, 2);
      const signature = signManifest(new TextEncoder().encode(body), key.pem);

      // 3. Commits : contenu puis signature.
      const filePath = CONTENT_PATHS[parsedKind.data];
      const existing = await readFile(token, filePath);
      await writeFile(token, filePath, body, parsedMessage.data, existing?.sha ?? null);
      const existingSig = await readFile(token, `${filePath}.sig`);
      await writeFile(token, `${filePath}.sig`, `${signature}\n`, `chore: signature de ${filePath}`, existingSig?.sha ?? null);

      addLog(`Contenu publié : ${parsedKind.data}`, 'success', parsedMessage.data);
      return { ok: true, path: filePath, signed: true };
    } catch (error) {
      addLog(`Échec de publication : ${parsedKind.data}`, 'failed', apiErrorMessage(error).message);
      return { ok: false, ...apiErrorMessage(error), recovery: 'Si le fichier principal a été committé mais pas la signature, relancez la publication : l’application rejette un contenu dont la signature est absente ou incohérente (échec sûr).' };
    }
  });

  /* ---------------- Sondages centralisés : création des issues ---------------- */

  ipcMain.handle('polls:create-issues', async (_e, pollPayload: unknown) => {
    const parsed = pollsManifestSchema.shape.polls.element.safeParse(pollPayload);
    if (!parsed.success) return { ok: false, message: `Sondage invalide : ${parsed.error.issues.map((i) => i.message).join('; ')}` };
    const poll = parsed.data as Poll;
    if (poll.mode !== 'github') return { ok: false, message: 'Ce sondage est en mode local : aucune issue à créer.' };
    try {
      const token = requireToken();
      const options = [];
      for (const option of poll.options) {
        if (option.issueNumber) {
          options.push(option); // déjà créée (publication partielle antérieure)
          continue;
        }
        const issue = await createIssue(
          token,
          `[Sondage] ${poll.title} — ${option.label}`,
          [
            `Option du sondage « ${poll.title} ».`,
            '',
            `**Pour voter : ajoutez une réaction 👍 (+1) sur cette issue.**`,
            '',
            poll.description || '',
            '',
            `Période : du ${poll.startsAt} au ${poll.endsAt}.`,
            '',
            '_Issue générée par Teralynk Admin — ne pas modifier le titre._'
          ].join('\n'),
          ['sondage']
        );
        options.push({ ...option, issueNumber: issue.number });
        addLog(`Issue de sondage créée : #${issue.number} (${option.label})`, 'success', issue.html_url);
      }
      return { ok: true, poll: { ...poll, options } };
    } catch (error) {
      return { ok: false, ...apiErrorMessage(error), recovery: 'Les issues déjà créées sont conservées dans le sondage retourné le cas échéant ; relancez pour compléter.' };
    }
  });

  /* ---------------- Releases ---------------- */

  ipcMain.handle('releases:list', async () => {
    try {
      const token = requireToken();
      return { ok: true, releases: await listReleases(token) };
    } catch (error) {
      return { ok: false, ...apiErrorMessage(error) };
    }
  });

  ipcMain.handle('releases:select-zip', async () => {
    const window = getWindow();
    if (!window) return { ok: false, message: 'Fenêtre indisponible' };
    const result = await dialog.showOpenDialog(window, {
      title: 'Sélectionner le paquet de publication (.zip)',
      filters: [{ name: 'Paquet ZIP', extensions: ['zip'] }],
      properties: ['openFile']
    });
    if (result.canceled || result.filePaths.length === 0) return { ok: false, cancelled: true };
    const filePath = result.filePaths[0]!;
    const stat = statSync(filePath);
    return {
      ok: true,
      file: { path: filePath, name: path.basename(filePath), size: stat.size, modifiedAt: stat.mtime.toISOString() }
    };
  });

  ipcMain.handle('releases:inspect-zip', async (_e, zipPath: unknown) => {
    const parsed = z.string().max(2000).safeParse(zipPath);
    if (!parsed.success) return { ok: false, message: 'Chemin invalide.' };
    try {
      const inspection = await inspectZip(parsed.data);
      addLog(`ZIP analysé : ${path.basename(parsed.data)}`, inspection.ok ? 'success' : 'failed', inspection.verdict);
      return { ok: true, inspection };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  });

  ipcMain.handle('releases:publish-steps', () => publishSteps());

  ipcMain.handle('releases:publish', async (_e, request: unknown) => {
    const schema = z.object({
      zipPath: z.string().max(2000),
      overrides: z
        .object({
          version: semverSchema.optional(),
          title: z.string().min(1).max(160).optional(),
          notes: z.string().max(20000).optional(),
          channel: z.enum(['stable', 'beta']).optional(),
          minSupportedVersion: semverSchema.optional(),
          prerelease: z.boolean().optional()
        })
        .default({})
    });
    const parsed = schema.safeParse(request);
    if (!parsed.success) return { ok: false, message: `Requête invalide : ${parsed.error.issues.map((i) => i.message).join('; ')}` };
    const token = readAdminToken();
    if (!token) return { ok: false, message: 'Aucun jeton enregistré.' };
    const window = getWindow();
    if (!window) return { ok: false, message: 'Fenêtre indisponible.' };

    addLog(`Publication de version lancée : ${path.basename(parsed.data.zipPath)}`, 'running');
    const emit = (progress: PublishProgress) => {
      if (!window.isDestroyed()) window.webContents.send('publish:progress', progress);
    };
    const result = await publishRelease(token, parsed.data as PublishRequest, emit);
    return result;
  });

  ipcMain.handle('releases:delete-draft', async (_e, releaseId: unknown) => {
    const parsed = z.number().int().positive().safeParse(releaseId);
    if (!parsed.success) return { ok: false, message: 'Identifiant invalide.' };
    try {
      const token = requireToken();
      const release = await listReleases(token);
      const target = release.find((r) => r.id === parsed.data);
      if (!target) return { ok: false, message: 'Release introuvable.' };
      if (!target.draft) return { ok: false, message: 'Seules les releases en brouillon créées par une tentative échouée peuvent être supprimées ici.' };
      await deleteRelease(token, parsed.data);
      return { ok: true };
    } catch (error) {
      return { ok: false, ...apiErrorMessage(error) };
    }
  });

  ipcMain.handle('releases:by-tag', async (_e, tag: unknown) => {
    const parsed = z.string().max(100).safeParse(tag);
    if (!parsed.success) return { ok: false, message: 'Tag invalide.' };
    try {
      const token = requireToken();
      return { ok: true, release: await getReleaseByTag(token, parsed.data) };
    } catch (error) {
      return { ok: false, ...apiErrorMessage(error) };
    }
  });

  /* ---------------- Système ---------------- */

  ipcMain.handle('system:info', () => ({
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    userData: app.getPath('userData')
  }));

  ipcMain.handle('system:open-external', (_e, url: unknown) => {
    const parsed = z.string().url().safeParse(url);
    if (!parsed.success) return { ok: false, message: 'URL invalide.' };
    const host = new URL(parsed.data).hostname;
    if (!['github.com', 'raw.githubusercontent.com', 'docs.github.com'].includes(host)) {
      return { ok: false, message: `Hôte externe non autorisé : ${host}` };
    }
    void shell.openExternal(parsed.data);
    return { ok: true };
  });

  ipcMain.handle('system:open-user-data', async () => {
    const dir = app.getPath('userData');
    await shell.openPath(dir);
    return { ok: true, dir };
  });

  /* ---------------- Manifeste de version (lecture seule, pour Overview) ---------------- */

  ipcMain.handle('versions:validate', (_e, payload: unknown) => {
    const parsed = versionManifestSchema.safeParse(payload);
    return parsed.success ? { ok: true } : { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  });
}
