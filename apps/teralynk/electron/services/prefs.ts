/**
 * Préférences et données strictement locales de l'installation.
 * Stockées dans userData/teralynk.json — jamais envoyées vers un serveur.
 * Aucune synchronisation entre appareils (pas de compte Teralynk).
 */
import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { log } from './logger';

const historyEntrySchema = z.object({
  id: z.string(),
  at: z.string(),
  type: z.enum(['script-run', 'script-cancelled', 'script-failed', 'card-viewed', 'poll-voted', 'update-check']),
  cardId: z.string().optional(),
  pollId: z.string().optional(),
  optionId: z.string().optional(),
  detail: z.string().max(500).optional(),
  exitCode: z.number().int().nullable().optional()
});
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

const prefsSchema = z.object({
  theme: z.enum(['dark']).default('dark'),
  accent: z.enum(['violet', 'blue', 'iridescent']).default('violet'),
  reduceMotion: z.enum(['system', 'on', 'off']).default('system'),
  visualIntensity: z.enum(['subtle', 'balanced', 'rich']).default('balanced'),
  skipIntro: z.boolean().default(false),
  updateChannel: z.enum(['stable', 'beta']).default('stable'),
  windowStart: z.enum(['default', 'maximized']).default('default'),
  historyRetentionDays: z.number().int().min(1).max(365).default(90),
  favorites: z.array(z.string()).max(500).default([]),
  lastFilters: z
    .object({
      query: z.string().max(200).default(''),
      category: z.string().max(60).nullable().default(null),
      status: z.string().max(30).nullable().default(null),
      platform: z.string().max(20).nullable().default(null),
      sort: z.enum(['featured', 'name', 'created', 'updated']).default('featured')
    })
    .default({ query: '', category: null, status: null, platform: null, sort: 'featured' }),
  /** Votes locaux (mode `local` uniquement — non centralisés, assumé). */
  localPollVotes: z.record(z.string(), z.string()).default({}),
  /** Jeton GitHub personnel de l'utilisateur (mode sondage centralisé). Chiffré via safeStorage. */
  userGithubTokenExists: z.boolean().default(false),
  history: z.array(historyEntrySchema).max(2000).default([]),
  lastUpdateCheck: z
    .object({
      at: z.string(),
      result: z.string().max(120),
      installedVersion: z.string(),
      latestVersion: z.string().nullable().default(null)
    })
    .nullable()
    .default(null),
  /** Versions de catalogue déjà consultées (badge "nouveau"). */
  seenCardVersions: z.record(z.string(), z.string()).default({})
});
export type Prefs = z.infer<typeof prefsSchema>;

let cache: Prefs | null = null;

function prefsFile(): string {
  return path.join(app.getPath('userData'), 'teralynk.json');
}

export function loadPrefs(): Prefs {
  if (cache) return cache;
  try {
    if (existsSync(prefsFile())) {
      const parsed = prefsSchema.safeParse(JSON.parse(readFileSync(prefsFile(), 'utf8')));
      if (parsed.success) {
        cache = pruneHistory(parsed.data);
        return cache;
      }
      log('warn', 'Fichier de préférences invalide — réinitialisé aux valeurs par défaut');
    }
  } catch (error) {
    log('warn', 'Lecture des préférences impossible', { reason: (error as Error).message });
  }
  cache = prefsSchema.parse({});
  return cache;
}

function pruneHistory(prefs: Prefs): Prefs {
  const cutoff = Date.now() - prefs.historyRetentionDays * 24 * 60 * 60 * 1000;
  return { ...prefs, history: prefs.history.filter((entry) => new Date(entry.at).getTime() >= cutoff) };
}

export function savePrefs(patch: Partial<Prefs>): Prefs {
  const current = loadPrefs();
  const merged = prefsSchema.parse({ ...current, ...patch });
  cache = merged;
  try {
    mkdirSync(path.dirname(prefsFile()), { recursive: true });
    writeFileSync(prefsFile(), JSON.stringify(merged, null, 2), 'utf8');
  } catch (error) {
    log('error', 'Écriture des préférences impossible', { reason: (error as Error).message });
  }
  return merged;
}

export function addHistory(entry: Omit<HistoryEntry, 'id' | 'at'>): void {
  const prefs = loadPrefs();
  const next: HistoryEntry = { ...entry, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, at: new Date().toISOString() };
  savePrefs({ history: [next, ...prefs.history].slice(0, 2000) });
}

export function resetPrefs(): Prefs {
  cache = null;
  try {
    if (existsSync(prefsFile())) writeFileSync(prefsFile(), JSON.stringify(prefsSchema.parse({}), null, 2), 'utf8');
  } catch {
    /* la réinitialisation mémoire suffit si le disque échoue */
  }
  log('info', 'Préférences réinitialisées');
  return loadPrefs();
}
