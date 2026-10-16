/**
 * Coffre-fort de Teralynk Admin.
 *
 * - Jeton GitHub : chiffré via safeStorage (DPAPI sur Windows, Keychain sur
 *   macOS). Jamais en clair sur le disque, jamais dans les journaux, jamais
 *   transmis au renderer (le renderer ne reçoit que des statuts).
 * - Clé privée de signature : référencée par chemin (fichier hors du dépôt),
 *   lue uniquement au moment de signer. Jamais committée, jamais distribuée.
 * - Brouillons, configuration et journaux admin : JSON local (userData).
 */
import { app, safeStorage } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { redactSecrets, REMOTE_CONFIG } from '@teralynk/shared';

/* ---------------- Journal admin (sans secrets) ---------------- */

export interface AdminLogEntry {
  at: string;
  action: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  detail?: string;
}

export interface AdminConfig {
  repoOwner: string;
  repoName: string;
  contentBranch: string;
  /** Chemin local du fichier PEM de clé privée Ed25519 (signatures). */
  signingKeyPath: string | null;
}

interface AdminStoreShape {
  config: AdminConfig;
  logs: AdminLogEntry[];
  drafts: {
    cards: unknown[];
    announcements: unknown[];
    polls: unknown[];
  };
}

const configSchema = z.object({
  repoOwner: z.string().min(1).max(100),
  repoName: z.string().min(1).max(100),
  contentBranch: z.string().min(1).max(100),
  signingKeyPath: z.string().max(1000).nullable()
});

const storeSchema = z.object({
  config: configSchema,
  logs: z.array(z.object({ at: z.string(), action: z.string(), status: z.enum(['pending', 'running', 'success', 'failed']), detail: z.string().max(2000).optional() })).max(1000),
  drafts: z.object({ cards: z.array(z.unknown()), announcements: z.array(z.unknown()), polls: z.array(z.unknown()) })
});

function storeFile(): string {
  return path.join(app.getPath('userData'), 'admin-store.json');
}

function tokenFile(): string {
  return path.join(app.getPath('userData'), 'github-admin-token.bin');
}

let storeCache: AdminStoreShape | null = null;

function defaultStore(): AdminStoreShape {
  return {
    config: { repoOwner: REMOTE_CONFIG.owner, repoName: REMOTE_CONFIG.repo, contentBranch: REMOTE_CONFIG.contentBranch, signingKeyPath: null },
    logs: [],
    drafts: { cards: [], announcements: [], polls: [] }
  };
}

export function loadStore(): AdminStoreShape {
  if (storeCache) return storeCache;
  try {
    if (existsSync(storeFile())) {
      const parsed = storeSchema.safeParse(JSON.parse(readFileSync(storeFile(), 'utf8')));
      if (parsed.success) {
        storeCache = parsed.data as AdminStoreShape;
        return storeCache;
      }
    }
  } catch {
    /* fichier corrompu → valeurs par défaut, sans écraser silencieusement */
  }
  storeCache = defaultStore();
  return storeCache;
}

function persist(): void {
  if (!storeCache) return;
  mkdirSync(path.dirname(storeFile()), { recursive: true });
  writeFileSync(storeFile(), JSON.stringify(storeCache, null, 2), 'utf8');
}

export function getConfig(): AdminConfig {
  return loadStore().config;
}

export function saveConfig(patch: Partial<AdminConfig>): AdminConfig {
  const store = loadStore();
  const merged = configSchema.parse({ ...store.config, ...patch });
  store.config = merged;
  persist();
  return merged;
}

export function getDrafts(): AdminStoreShape['drafts'] {
  return loadStore().drafts;
}

export function saveDrafts(drafts: Partial<AdminStoreShape['drafts']>): AdminStoreShape['drafts'] {
  const store = loadStore();
  store.drafts = { ...store.drafts, ...drafts };
  persist();
  return store.drafts;
}

export function addLog(action: string, status: AdminLogEntry['status'], detail?: string): void {
  const store = loadStore();
  store.logs = [{ at: new Date().toISOString(), action, status, detail: detail ? redactSecrets(detail).slice(0, 2000) : undefined }, ...store.logs].slice(0, 1000);
  persist();
}

export function getLogs(): AdminLogEntry[] {
  return loadStore().logs;
}

export function clearLogs(): void {
  loadStore().logs = [];
  persist();
}

/* ---------------- Jeton GitHub administrateur ---------------- */

export function storeAdminToken(token: string): { ok: boolean; message?: string } {
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, message: 'Le stockage chiffré du système est indisponible : le jeton ne peut pas être enregistré en sécurité. Sur Windows, vérifiez que le profil utilisateur et DPAPI fonctionnent.' };
  }
  try {
    writeFileSync(tokenFile(), safeStorage.encryptString(token));
    addLog('Jeton administrateur enregistré (chiffré)', 'success');
    return { ok: true };
  } catch (error) {
    return { ok: false, message: redactSecrets((error as Error).message) };
  }
}

export function readAdminToken(): string | null {
  try {
    if (!existsSync(tokenFile()) || !safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(readFileSync(tokenFile()));
  } catch {
    return null;
  }
}

export function clearAdminToken(): void {
  try {
    if (existsSync(tokenFile())) writeFileSync(tokenFile(), '');
    addLog('Jeton administrateur effacé', 'success');
  } catch {
    /* l'échec d'effacement est signalé par le statut retourné ailleurs */
  }
}

export function adminTokenStatus(): { exists: boolean; encryptionAvailable: boolean } {
  return { exists: existsSync(tokenFile()) && readAdminToken() !== null, encryptionAvailable: safeStorage.isEncryptionAvailable() };
}

/* ---------------- Clé privée de signature ---------------- */

export function readSigningKey(): { ok: true; pem: string } | { ok: false; message: string } {
  const { signingKeyPath } = getConfig();
  if (!signingKeyPath) {
    return { ok: false, message: 'Aucune clé de signature configurée (Configuration → Clé de signature).' };
  }
  try {
    if (!existsSync(signingKeyPath)) return { ok: false, message: `Fichier de clé introuvable : ${signingKeyPath}` };
    const pem = readFileSync(signingKeyPath, 'utf8');
    if (!pem.includes('PRIVATE KEY')) return { ok: false, message: 'Le fichier fourni ne contient pas de clé privée PEM.' };
    return { ok: true, pem };
  } catch (error) {
    return { ok: false, message: redactSecrets((error as Error).message) };
  }
}
