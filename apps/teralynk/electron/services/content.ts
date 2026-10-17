/**
 * Récupération et validation du contenu distant publié sur GitHub :
 * catalogue de cartes, annonces, sondages.
 *
 * Principes :
 *  - Toute donnée distante est validée par les schémas zod partagés AVANT usage.
 *    Un manifeste mal formé est rejeté sans faire planter l'application.
 *  - Un cache local (userData/cache) accélère l'ouverture ; l'origine des
 *    données affichées ('network' | 'cache') est toujours rapportée à l'UI.
 *  - Aucune donnée de démonstration : si le dépôt est inaccessible et sans
 *    cache valide, l'UI affiche un état d'erreur explicite.
 */
import { app } from 'electron';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  REMOTE_CONFIG,
  rawContentUrl,
  catalogManifestSchema,
  announcementsManifestSchema,
  pollsManifestSchema,
  type CatalogManifest,
  type AnnouncementsManifest,
  type PollsManifest
} from '@teralynk/shared';
import { classifyContentFetchError, contentIssueMessage } from '@teralynk/shared';
import { verifyManifestSignature } from '@teralynk/shared/node';
import { fetchText, fetchWithRetry, NetworkError } from './net';
import { embeddedPublicKey } from './signing';
import { log } from './logger';

export type ContentSource = 'network' | 'cache';

export interface ContentResult<T> {
  data: T;
  source: ContentSource;
  fetchedAt: string; // ISO — date de la récupération réseau OU de la mise en cache
  stale: boolean; // true si servi depuis un cache périmé (politique TTL dépassée)
}

export class ContentError extends Error {
  constructor(
    message: string,
    readonly kind: 'offline' | 'invalid' | 'http' | 'not-published',
    readonly detail?: string
  ) {
    super(message);
    this.name = 'ContentError';
  }
}

/** Politique de fraîcheur du cache : 15 minutes pour le catalogue/annonces/sondages. */
const CACHE_TTL_MS = 15 * 60 * 1000;

function cacheDir(): string {
  const dir = path.join(app.getPath('userData'), 'cache');
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface CacheEnvelope<T> {
  savedAt: string;
  payload: T;
}

function readCache<T>(name: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): { payload: T; savedAt: Date } | null {
  const file = path.join(cacheDir(), `${name}.json`);
  try {
    if (!existsSync(file)) return null;
    const envelope = JSON.parse(readFileSync(file, 'utf8')) as CacheEnvelope<unknown>;
    const parsed = schema.safeParse(envelope.payload);
    if (!parsed.success) {
      log('warn', `Cache ${name} invalide — ignoré`, { issues: parsed.error.issues.slice(0, 3) });
      return null;
    }
    return { payload: parsed.data, savedAt: new Date(envelope.savedAt) };
  } catch (error) {
    log('warn', `Lecture du cache ${name} impossible`, { reason: (error as Error).message });
    return null;
  }
}

function writeCache(name: string, payload: unknown): void {
  try {
    const envelope: CacheEnvelope<unknown> = { savedAt: new Date().toISOString(), payload };
    writeFileSync(path.join(cacheDir(), `${name}.json`), JSON.stringify(envelope), 'utf8');
  } catch (error) {
    log('warn', `Écriture du cache ${name} impossible`, { reason: (error as Error).message });
  }
}

/**
 * Charge un manifeste distant SIGNÉ et validé, avec repli sur cache.
 *
 * Chaîne de confiance : le fichier `.sig` (signature Ed25519 detached publiée
 * par Teralynk Admin) est vérifié avec la clé publique embarquée AVANT tout
 * usage du contenu. Un contenu non signé ou dont la signature est invalide
 * est rejeté (repli sur cache valide le cas échéant, sinon erreur explicite).
 *
 * Lève ContentError si ni le réseau ni un cache valide ne peuvent fournir la donnée.
 */
async function loadManifest<T>(name: string, url: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<ContentResult<T>> {
  const cached = readCache(name, schema);
  try {
    // Récupération du contenu brut + de sa signature en parallèle.
    const [contentResult, signatureText] = await Promise.all([
      fetchWithRetry(url, { timeoutMs: 15000, retries: 2 }),
      fetchText(`${url}.sig`, { timeoutMs: 15000, retries: 2 })
    ]);

    // 1. Vérification de signature AVANT tout usage du contenu.
    const publicKey = embeddedPublicKey();
    if (!verifyManifestSignature(contentResult.body, signatureText, publicKey)) {
      log('error', `Manifeste ${name} : SIGNATURE INVALIDE — contenu rejeté`);
      if (cached) {
        const stale = Date.now() - cached.savedAt.getTime() > CACHE_TTL_MS;
        return { data: cached.payload, source: 'cache', fetchedAt: cached.savedAt.toISOString(), stale };
      }
      throw new ContentError(
        `La signature du fichier ${name} publié est invalide. Par sécurité, ce contenu est rejeté.`,
        'invalid',
        'verifyManifestSignature → false'
      );
    }

    // 2. Parsing + validation du schéma.
    let payload: unknown;
    try {
      payload = JSON.parse(new TextDecoder().decode(contentResult.body));
    } catch {
      throw new ContentError(`Le fichier ${name} publié n’est pas un JSON valide.`, 'invalid');
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      // Données réseau mal formées : on ne les utilise JAMAIS telles quelles.
      log('error', `Manifeste distant ${name} invalide — rejeté`, { issues: parsed.error.issues.slice(0, 5) });
      if (cached) {
        const stale = Date.now() - cached.savedAt.getTime() > CACHE_TTL_MS;
        return { data: cached.payload, source: 'cache', fetchedAt: cached.savedAt.toISOString(), stale };
      }
      throw new ContentError(
        `Le fichier ${name} publié est mal formé et ne peut pas être affiché.`,
        'invalid',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      );
    }
    writeCache(name, parsed.data);
    return { data: parsed.data, source: 'network', fetchedAt: new Date().toISOString(), stale: false };
  } catch (error) {
    if (cached) {
      const stale = Date.now() - cached.savedAt.getTime() > CACHE_TTL_MS;
      log('warn', `${name} servi depuis le cache`, { stale, reason: (error as Error).message });
      return { data: cached.payload, source: 'cache', fetchedAt: cached.savedAt.toISOString(), stale };
    }
    if (error instanceof ContentError) throw error;
    if (error instanceof NetworkError) {
      const issue = classifyContentFetchError(error.cause, error.status);
      throw new ContentError(contentIssueMessage(issue, name), issue, error.message);
    }
    throw error;
  }
}

export function loadCatalog(): Promise<ContentResult<CatalogManifest>> {
  return loadManifest('catalog', rawContentUrl(REMOTE_CONFIG.paths.catalog), catalogManifestSchema);
}

export function loadAnnouncements(): Promise<ContentResult<AnnouncementsManifest>> {
  return loadManifest('announcements', rawContentUrl(REMOTE_CONFIG.paths.announcements), announcementsManifestSchema);
}

export function loadPolls(): Promise<ContentResult<PollsManifest>> {
  return loadManifest('polls', rawContentUrl(REMOTE_CONFIG.paths.polls), pollsManifestSchema);
}

/** Vide le cache de contenu (Paramètres → Réinitialiser). */
export function clearContentCache(): void {
  for (const name of ['catalog', 'announcements', 'polls']) {
    const file = path.join(cacheDir(), `${name}.json`);
    try {
      if (existsSync(file)) writeFileSync(file, '');
    } catch {
      /* ignoré volontairement : opération de nettoyage non critique */
    }
  }
  log('info', 'Cache de contenu vidé');
}
