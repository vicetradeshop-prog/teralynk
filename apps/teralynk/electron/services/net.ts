/**
 * Couche réseau de Teralynk : toutes les requêtes distantes passent par ici.
 * - Délais d'attente explicites (AbortController).
 * - Retries limitées avec backoff.
 * - Aucune requête vers un hôte non autorisé.
 */
import { net } from 'electron';
import { log } from './logger';

export interface FetchResult {
  ok: boolean;
  status: number;
  body: Uint8Array;
  etag?: string;
  lastModified?: string;
}

export class NetworkError extends Error {
  constructor(
    message: string,
    readonly cause: 'offline' | 'timeout' | 'http' | 'invalid' | 'unknown',
    readonly status?: number
  ) {
    super(message);
    this.name = 'NetworkError';
  }
}

const ALLOWED_HOSTS = new Set([
  'raw.githubusercontent.com',
  'api.github.com',
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com'
]);

export function assertAllowedUrl(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new NetworkError(`Hôte non autorisé : ${parsed.hostname}`, 'invalid');
  }
  return parsed;
}

/**
 * Télécharge une ressource avec délai et retries. Utilise `net.fetch` d'Electron
 * (respecte la pile réseau Chromium, fonctionne dans le processus principal).
 */
export async function fetchWithRetry(
  url: string,
  options: { timeoutMs?: number; retries?: number; headers?: Record<string, string> } = {}
): Promise<FetchResult> {
  const { timeoutMs = 15000, retries = 2, headers = {} } = options;
  assertAllowedUrl(url);
  let lastError: NetworkError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 500 * 2 ** (attempt - 1)));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await net.fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Teralynk-Desktop', ...headers }
      });
      if (!response.ok) {
        lastError = new NetworkError(`HTTP ${response.status} pour ${url}`, 'http', response.status);
        if (response.status === 404 || (response.status >= 400 && response.status < 500)) {
          // Une erreur client ne se résout pas en réessayant.
          throw lastError;
        }
        continue;
      }
      const buffer = new Uint8Array(await response.arrayBuffer());
      return {
        ok: true,
        status: response.status,
        body: buffer,
        etag: response.headers.get('etag') ?? undefined,
        lastModified: response.headers.get('last-modified') ?? undefined
      };
    } catch (error) {
      if (error instanceof NetworkError) throw error;
      const aborted = controller.signal.aborted;
      lastError = new NetworkError(
        aborted ? `Délai dépassé (${timeoutMs} ms) pour ${url}` : `Échec réseau pour ${url}`,
        aborted ? 'timeout' : 'offline'
      );
      log('warn', lastError.message, { attempt, reason: (error as Error).message });
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new NetworkError('Échec réseau inconnu', 'unknown');
}

/** Télécharge et décode un JSON distant. Lève NetworkError en cas d'échec. */
export async function fetchJson<T = unknown>(url: string, options?: Parameters<typeof fetchWithRetry>[1]): Promise<T> {
  const result = await fetchWithRetry(url, options);
  try {
    return JSON.parse(new TextDecoder().decode(result.body)) as T;
  } catch {
    throw new NetworkError(`Réponse JSON invalide depuis ${url}`, 'invalid');
  }
}

/** Télécharge un fichier texte (ex. signature detached). */
export async function fetchText(url: string, options?: Parameters<typeof fetchWithRetry>[1]): Promise<string> {
  const result = await fetchWithRetry(url, options);
  return new TextDecoder().decode(result.body);
}

/** Vérifie rapidement la connectivité vers GitHub (diagnostic + écran de mise à jour). */
export async function checkGitHubReachable(): Promise<{ reachable: boolean; latencyMs: number | null; detail?: string }> {
  const started = Date.now();
  try {
    const result = await fetchWithRetry('https://api.github.com', { timeoutMs: 8000, retries: 0 });
    return { reachable: result.ok, latencyMs: Date.now() - started };
  } catch (error) {
    return { reachable: false, latencyMs: null, detail: (error as Error).message };
  }
}
