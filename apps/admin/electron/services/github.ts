/**
 * Client GitHub REST de Teralynk Admin.
 *
 * - Utilisé UNIQUEMENT dans le processus principal : le jeton ne traverse
 *   jamais l'IPC vers le renderer.
 * - Permissions minimales documentées (docs/admin.md) : `public_repo`
 *   (dépôt public) ou `repo` (dépôt privé) — Contents R/W, Releases, Issues.
 * - Chaque opération rapporte un résultat explicite ; aucune erreur avalée.
 */
import { request as httpsRequest } from 'node:https';
import { createReadStream, statSync } from 'node:fs';
import { redactSecrets } from '@teralynk/shared';
import { addLog, getConfig } from './vault';

const API = 'https://api.github.com';

export class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly githubMessage?: string
  ) {
    super(message);
    this.name = 'GitHubApiError';
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

async function request<T>(url: string, token: string | null, options: RequestOptions = {}): Promise<{ status: number; headers: Record<string, string>; data: T | null }> {
  const { method = 'GET', body, headers = {}, timeoutMs = 30000 } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Teralynk-Admin',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers
      },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });
    const text = await response.text();
    let data: T | null = null;
    if (text) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = null;
      }
    }
    return { status: response.status, headers: responseHeaders, data };
  } catch (error) {
    const message = redactSecrets((error as Error).message);
    throw new GitHubApiError(controller.signal.aborted ? `Délai dépassé pour ${url}` : `Échec réseau : ${message}`, 0);
  } finally {
    clearTimeout(timer);
  }
}

async function expectOk<T>(url: string, token: string | null, options: RequestOptions = {}): Promise<T> {
  const { status, data, headers } = await request<T>(url, token, options);
  if (status < 200 || status >= 300) {
    const ghMessage = (data as { message?: string } | null)?.message;
    const scopes = headers['x-oauth-scopes'] ?? '';
    let hint = '';
    if (status === 401) hint = ' Jeton invalide ou expiré.';
    else if (status === 403) hint = scopes ? ` Permissions du jeton : ${scopes}.` : ' Permissions insuffisantes ou rate-limit.';
    else if (status === 404) hint = ' Dépôt/ressource introuvable ou jeton sans accès.';
    throw new GitHubApiError(`GitHub a répondu HTTP ${status}.${hint}`, status, ghMessage);
  }
  return data as T;
}

/* ---------------- Types GitHub (extraits utiles) ---------------- */

export interface GitHubUser {
  login: string;
  id: number;
}

export interface GitHubRepoInfo {
  full_name: string;
  private: boolean;
  permissions?: { admin: boolean; push: boolean; pull: boolean };
  default_branch: string;
}

export interface GitHubContentFile {
  name: string;
  path: string;
  sha: string;
  content?: string;
  encoding?: string;
  size: number;
}

export interface GitHubRelease {
  id: number;
  tag_name: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  html_url: string;
  assets: Array<{ id: number; name: string; size: number; state: string; browser_download_url: string }>;
}

export interface GitHubIssue {
  number: number;
  html_url: string;
  title: string;
  state: string;
}

/* ---------------- Opérations ---------------- */

/** Valide le jeton : identité + accès au dépôt configuré + scopes disponibles. */
export async function validateToken(token: string, owner: string, repo: string): Promise<{ login: string; scopes: string[]; repoAccess: { pull: boolean; push: boolean; admin: boolean }; privateRepo: boolean }> {
  const userResponse = await request<GitHubUser>(`${API}/user`, token);
  if (userResponse.status !== 200 || !userResponse.data) {
    throw new GitHubApiError(`Jeton refusé par GitHub (HTTP ${userResponse.status}). Vérifiez sa validité et son expiration.`, userResponse.status);
  }
  const scopes = (userResponse.headers['x-oauth-scopes'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const repoInfo = await expectOk<GitHubRepoInfo>(`${API}/repos/${owner}/${repo}`, token);
  if (!repoInfo.permissions?.push) {
    throw new GitHubApiError(`Le jeton de « ${userResponse.data.login} » n’a pas les droits d’écriture sur ${owner}/${repo}. Permissions requises : ${repoInfo.private ? 'repo' : 'public_repo'} (Contents R/W, Releases, Issues).`, 403);
  }
  addLog(`Jeton validé pour ${userResponse.data.login} sur ${owner}/${repo}`, 'success', `scopes: ${scopes.join(', ')}`);
  return {
    login: userResponse.data.login,
    scopes,
    repoAccess: { pull: Boolean(repoInfo.permissions.pull), push: Boolean(repoInfo.permissions.push), admin: Boolean(repoInfo.permissions.admin) },
    privateRepo: repoInfo.private
  };
}

/** Lit un fichier du dépôt (contenu + sha pour mise à jour). Retourne null si absent (404). */
export async function readFile(token: string, filePath: string, ref?: string): Promise<{ content: string; sha: string } | null> {
  const { repoOwner, repoName, contentBranch } = getConfig();
  const url = `${API}/repos/${repoOwner}/${repoName}/contents/${filePath}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`;
  const { status, data } = await request<GitHubContentFile>(url, token);
  if (status === 404) return null;
  if (status !== 200 || !data) throw new GitHubApiError(`Lecture de ${filePath} impossible (HTTP ${status}).`, status);
  if (data.encoding !== 'base64' || data.content === undefined) {
    throw new GitHubApiError(`${filePath} n’est pas un fichier lisible (trop volumineux ou type inattendu).`, status);
  }
  return { content: Buffer.from(data.content, 'base64').toString('utf8'), sha: data.sha };
}

/** Crée ou met à jour un fichier du dépôt (commit unitaire sur la branche de contenu). */
export async function writeFile(token: string, filePath: string, content: string, message: string, existingSha?: string | null): Promise<{ commitSha: string }> {
  const { repoOwner, repoName, contentBranch } = getConfig();
  const body: Record<string, unknown> = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: contentBranch
  };
  if (existingSha) body['sha'] = existingSha;
  const result = await expectOk<{ commit: { sha: string } }>(
    `${API}/repos/${repoOwner}/${repoName}/contents/${filePath}`,
    token,
    { method: 'PUT', body }
  );
  addLog(`Fichier publié : ${filePath}`, 'success', message);
  return { commitSha: result.commit.sha };
}

export async function listReleases(token: string): Promise<GitHubRelease[]> {
  const { repoOwner, repoName } = getConfig();
  return expectOk<GitHubRelease[]>(`${API}/repos/${repoOwner}/${repoName}/releases?per_page=30`, token);
}

export async function getReleaseById(token: string, releaseId: number): Promise<GitHubRelease | null> {
  const { repoOwner, repoName } = getConfig();
  const { status, data } = await request<GitHubRelease>(`${API}/repos/${repoOwner}/${repoName}/releases/${releaseId}`, token);
  if (status === 404) return null;
  if (status !== 200 || !data) throw new GitHubApiError(`Lecture de la release ${releaseId} impossible (HTTP ${status}).`, status);
  return data;
}

export async function getReleaseByTag(token: string, tag: string): Promise<GitHubRelease | null> {
  const { repoOwner, repoName } = getConfig();
  const { status, data } = await request<GitHubRelease>(`${API}/repos/${repoOwner}/${repoName}/releases/tags/${encodeURIComponent(tag)}`, token);
  if (status === 404) return null;
  if (status !== 200 || !data) throw new GitHubApiError(`Lecture de la release ${tag} impossible (HTTP ${status}).`, status);
  return data;
}

export async function createRelease(token: string, payload: { tag_name: string; name: string; body: string; draft: boolean; prerelease: boolean; target_commitish?: string }): Promise<GitHubRelease> {
  const { repoOwner, repoName } = getConfig();
  return expectOk<GitHubRelease>(`${API}/repos/${repoOwner}/${repoName}/releases`, token, { method: 'POST', body: payload, timeoutMs: 60000 });
}

export async function updateRelease(token: string, releaseId: number, patch: { draft?: boolean; prerelease?: boolean; name?: string; body?: string }): Promise<GitHubRelease> {
  const { repoOwner, repoName } = getConfig();
  return expectOk<GitHubRelease>(`${API}/repos/${repoOwner}/${repoName}/releases/${releaseId}`, token, { method: 'PATCH', body: patch });
}

export async function deleteRelease(token: string, releaseId: number): Promise<void> {
  const { repoOwner, repoName } = getConfig();
  await expectOk<unknown>(`${API}/repos/${repoOwner}/${repoName}/releases/${releaseId}`, token, { method: 'DELETE' });
  addLog(`Release supprimée (nettoyage) : id ${releaseId}`, 'success');
}

/**
 * Envoie un asset binaire avec PROGRESSION RÉELLE (octets écrits sur le socket).
 * Utilise node:https — fetch/undici n'expose pas la progression d'upload.
 */
export function uploadAsset(
  token: string,
  releaseId: number,
  filePath: string,
  assetName: string,
  onProgress: (percent: number, transferred: number, total: number) => void
): Promise<{ id: number; name: string; size: number }> {
  const { repoOwner, repoName } = getConfig();
  const total = statSync(filePath).size;
  const url = new URL(`https://uploads.github.com/repos/${repoOwner}/${repoName}/releases/${releaseId}/assets`);
  url.searchParams.set('name', assetName);

  return new Promise((resolve, reject) => {
    let transferred = 0;
    const req = httpsRequest(
      {
        hostname: url.hostname,
        path: `${url.pathname}${url.search}`,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(total),
          'User-Agent': 'Teralynk-Admin'
        }
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          if ((res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300) {
            try {
              const parsed = JSON.parse(body) as { id: number; name: string; size: number };
              resolve({ id: parsed.id, name: parsed.name, size: parsed.size });
            } catch {
              reject(new GitHubApiError('Réponse d’upload illisible.', res.statusCode ?? 0));
            }
          } else {
            reject(new GitHubApiError(`Upload de ${assetName} refusé (HTTP ${res.statusCode}).`, res.statusCode ?? 0, redactSecrets(body).slice(0, 300)));
          }
        });
      }
    );
    req.on('error', (error) => reject(new GitHubApiError(`Échec réseau pendant l’upload : ${redactSecrets(error.message)}`, 0)));
    const stream = createReadStream(filePath);
    stream.on('data', (chunk: string | Buffer) => {
      transferred += typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length;
      onProgress(Math.round((transferred / total) * 100), transferred, total);
    });
    stream.on('error', (error) => {
      req.destroy();
      reject(new GitHubApiError(`Lecture du fichier impossible : ${error.message}`, 0));
    });
    stream.pipe(req);
  });
}

/* ---------------- Issues (sondages centralisés) ---------------- */

export async function createIssue(token: string, title: string, body: string, labels: string[]): Promise<GitHubIssue> {
  const { repoOwner, repoName } = getConfig();
  return expectOk<GitHubIssue>(`${API}/repos/${repoOwner}/${repoName}/issues`, token, {
    method: 'POST',
    body: { title, body, labels }
  });
}

export async function closeIssue(token: string, issueNumber: number): Promise<void> {
  const { repoOwner, repoName } = getConfig();
  await expectOk<unknown>(`${API}/repos/${repoOwner}/${repoName}/issues/${issueNumber}`, token, {
    method: 'PATCH',
    body: { state: 'closed', state_reason: 'completed' }
  });
}
