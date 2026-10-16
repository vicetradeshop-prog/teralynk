/**
 * Sondages centralisés via GitHub (Option A de la spécification).
 *
 * Mécanisme réel et documenté (docs/github.md §Sondages) :
 *  - Le panel admin crée une issue GitHub par option de sondage.
 *  - Voter = déposer une réaction « +1 » sur l'issue de l'option choisie.
 *  - Lire les résultats = GET public des issues (champ reactions), sans jeton.
 *  - Voter exige un jeton GitHub personnel de L'UTILISATEUR (scope public_repo),
 *    chiffré localement via safeStorage (DPAPI sur Windows). Jamais le jeton
 *    administrateur : l'application publique n'en contient aucun.
 *
 * Les sondages en mode `local` n'utilisent pas ce service : le vote est
 * enregistré dans les préférences locales et l'UI indique clairement qu'il
 * n'est pas centralisé.
 */
import { safeStorage } from 'electron';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { apiBase, REMOTE_CONFIG, type Poll } from '@teralynk/shared';
import { fetchJson, fetchWithRetry, NetworkError } from './net';
import { loadPrefs, savePrefs, addHistory } from './prefs';
import { log } from './logger';

export interface OptionResult {
  optionId: string;
  issueNumber: number;
  plusOne: number;
  totalReactions: number;
  url: string;
}

export interface PollResults {
  pollId: string;
  mode: 'github';
  fetchedAt: string;
  options: OptionResult[];
}

/* ------------------------------------------------------------------ */
/* Jeton GitHub de l'utilisateur (chiffré au repos)                     */
/* ------------------------------------------------------------------ */

function tokenFile(): string {
  return path.join(app.getPath('userData'), 'github-user-token.bin');
}

export function storeUserGithubToken(token: string): { ok: boolean; message?: string } {
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, message: 'Le stockage chiffré du système n’est pas disponible sur cette machine. Le vote centralisé est indisponible (le jeton n’est jamais stocké en clair).' };
  }
  try {
    writeFileSync(tokenFile(), safeStorage.encryptString(token));
    savePrefs({ userGithubTokenExists: true });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

export function readUserGithubToken(): string | null {
  try {
    if (!existsSync(tokenFile()) || !safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(readFileSync(tokenFile()));
  } catch {
    return null;
  }
}

export function clearUserGithubToken(): void {
  try {
    if (existsSync(tokenFile())) writeFileSync(tokenFile(), '');
    savePrefs({ userGithubTokenExists: false });
  } catch (error) {
    log('warn', 'Effacement du jeton utilisateur impossible', { reason: (error as Error).message });
  }
}

export function userTokenStatus(): { exists: boolean; encryptionAvailable: boolean } {
  return { exists: loadPrefs().userGithubTokenExists && existsSync(tokenFile()), encryptionAvailable: safeStorage.isEncryptionAvailable() };
}

/* ------------------------------------------------------------------ */
/* Lecture publique des résultats                                       */
/* ------------------------------------------------------------------ */

interface GithubIssue {
  number: number;
  html_url: string;
  reactions?: { total_count?: number; '+1'?: number };
}

/** Lit les compteurs de réactions des issues d'options — API publique, sans jeton. */
export async function fetchPollResults(poll: Poll): Promise<PollResults> {
  if (poll.mode !== 'github') {
    throw new Error('Ce sondage est en mode local : aucun résultat centralisé n’existe.');
  }
  const options = await Promise.all(
    poll.options.map(async (option) => {
      if (!option.issueNumber) {
        throw new NetworkError(`Option « ${option.label} » sans issue associée`, 'invalid');
      }
      const issue = await fetchJson<GithubIssue>(`${apiBase()}/issues/${option.issueNumber}`, {
        timeoutMs: 12000,
        retries: 1,
        headers: { Accept: 'application/vnd.github+json' }
      });
      return {
        optionId: option.id,
        issueNumber: option.issueNumber,
        plusOne: issue.reactions?.['+1'] ?? 0,
        totalReactions: issue.reactions?.['total_count'] ?? 0,
        url: issue.html_url
      } satisfies OptionResult;
    })
  );
  return { pollId: poll.id, mode: 'github', fetchedAt: new Date().toISOString(), options };
}

/* ------------------------------------------------------------------ */
/* Vote (authentifié par le jeton de l'utilisateur)                     */
/* ------------------------------------------------------------------ */

export async function castGithubVote(poll: Poll, optionId: string): Promise<{ ok: boolean; message: string }> {
  if (poll.mode !== 'github') {
    return { ok: false, message: 'Ce sondage est en mode local.' };
  }
  const option = poll.options.find((o) => o.id === optionId);
  if (!option?.issueNumber) return { ok: false, message: 'Option introuvable ou sans issue associée.' };

  const token = readUserGithubToken();
  if (!token) {
    return {
      ok: false,
      message: 'Aucun jeton GitHub personnel enregistré. Ajoutez-en un dans Paramètres → Sondages centralisés (scope public_repo) pour voter. Votre jeton reste chiffré sur cet ordinateur.'
    };
  }

  try {
    const result = await fetchWithRetry(`${apiBase()}/issues/${option.issueNumber}/reactions`, {
      timeoutMs: 15000,
      retries: 1,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    });
    if (result.status === 200 || result.status === 201) {
      addHistory({ type: 'poll-voted', pollId: poll.id, optionId, detail: 'via GitHub (réaction +1)' });
      return { ok: true, message: 'Vote enregistré sur GitHub (réaction +1 publique).' };
    }
    return { ok: false, message: `GitHub a refusé le vote (HTTP ${result.status}). Vérifiez les permissions du jeton (public_repo) ou si vous avez déjà réagi.` };
  } catch (error) {
    if (error instanceof NetworkError && error.status === 401) {
      return { ok: false, message: 'Jeton GitHub refusé (401) : régénérez un jeton avec le scope public_repo dans Paramètres.' };
    }
    return { ok: false, message: `Échec du vote : ${(error as Error).message}` };
  }
}

export { REMOTE_CONFIG };
