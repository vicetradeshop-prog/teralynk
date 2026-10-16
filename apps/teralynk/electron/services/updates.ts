/**
 * Vérification OBLIGATOIRE des mises à jour au démarrage.
 *
 * Chaîne de confiance :
 *  1. Télécharger `versions/{channel}.json` et `versions/{channel}.json.sig` depuis GitHub.
 *  2. Vérifier la signature Ed25519 avec la clé publique EMBARQUÉE dans l'application.
 *     (Une empreinte fournie par un manifeste compromis n'est pas une preuve :
 *      seul le manifeste signé fait foi.)
 *  3. Valider le manifeste avec le schéma zod partagé.
 *  4. Décider : à jour / mise à jour facultative / mise à jour obligatoire.
 *
 * Politique de secours EXPLICITE (aucun contournement silencieux) :
 *  - GitHub inaccessible ET cache signé valide ET installée >= minSupportedVersion
 *    → accès autorisé en « mode dégradé hors-ligne », bannière permanente dans l'UI.
 *  - GitHub inaccessible ET installée < minSupportedVersion (d'après le cache)
 *    → ACCÈS BLOQUÉ, seule la mise à jour est proposée.
 *  - Aucun cache signé valide → ACCÈS BLOQUÉ avec bouton Réessayer.
 *
 * L'installation elle-même est déléguée à electron-updater (mécanisme reconnu,
 * releases GitHub) lorsque l'application est empaquetée. En développement,
 * l'installation est indisponible et l'UI le dit honnêtement.
 */
import { app, BrowserWindow } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  REMOTE_CONFIG,
  versionManifestSchema,
  versionManifestUrl,
  versionSignatureUrl,
  releasesWebUrl,
  decideUpdate,
  compareSemver,
  type VersionManifest,
  type ReleaseChannel
} from '@teralynk/shared';
import { verifyManifestSignature } from '@teralynk/shared/node';
import { fetchWithRetry, fetchText, NetworkError } from './net';
import { embeddedPublicKey } from './signing';
import { loadPrefs, savePrefs } from './prefs';
import { log } from './logger';

export type UpdateGateOutcome =
  | { state: 'up-to-date'; manifest: VersionManifest; offline: boolean }
  | { state: 'optional-update'; manifest: VersionManifest; offline: boolean }
  | { state: 'mandatory-update'; manifest: VersionManifest; offline: boolean }
  | { state: 'blocked-offline'; reason: string; detail?: string }
  | { state: 'blocked-invalid'; reason: string; detail?: string };

export interface UpdateGateResult {
  outcome: UpdateGateOutcome;
  installedVersion: string;
  channel: ReleaseChannel;
  checkedAt: string;
  canAutoInstall: boolean; // true uniquement si empaqueté (electron-updater opérationnel)
  releasesUrl: string;
}

interface SignedCache {
  savedAt: string;
  payload: unknown;
  signature: string;
}

function cacheFile(): string {
  const dir = path.join(app.getPath('userData'), 'cache');
  mkdirSync(dir, { recursive: true });
  return path.join(dir, 'version-manifest.json');
}

function readSignedCache(publicKey: string): { manifest: VersionManifest; savedAt: Date } | null {
  try {
    if (!existsSync(cacheFile())) return null;
    const envelope = JSON.parse(readFileSync(cacheFile(), 'utf8')) as SignedCache;
    const raw = JSON.stringify(envelope.payload);
    if (!verifyManifestSignature(new TextEncoder().encode(raw), envelope.signature, publicKey)) {
      log('warn', 'Cache du manifeste de version : signature invalide — ignoré');
      return null;
    }
    const parsed = versionManifestSchema.safeParse(envelope.payload);
    if (!parsed.success) return null;
    return { manifest: parsed.data, savedAt: new Date(envelope.savedAt) };
  } catch (error) {
    log('warn', 'Cache de version illisible', { reason: (error as Error).message });
    return null;
  }
}

function writeSignedCache(manifest: VersionManifest, signature: string): void {
  try {
    const envelope: SignedCache = { savedAt: new Date().toISOString(), payload: manifest, signature };
    writeFileSync(cacheFile(), JSON.stringify(envelope), 'utf8');
  } catch (error) {
    log('warn', 'Écriture du cache de version impossible', { reason: (error as Error).message });
  }
}

/**
 * Exécute la vérification obligatoire complète. Cette fonction ne retourne
 * JAMAIS un état « à jour » en cas d'erreur réseau : elle retourne un état bloqué.
 */
export async function runUpdateGate(channelOverride?: ReleaseChannel): Promise<UpdateGateResult> {
  const installedVersion = app.getVersion();
  const channel: ReleaseChannel = channelOverride ?? loadPrefs().updateChannel;
  const checkedAt = new Date().toISOString();
  const base = { installedVersion, channel, checkedAt, canAutoInstall: app.isPackaged, releasesUrl: releasesWebUrl() };

  let publicKey: string;
  try {
    publicKey = embeddedPublicKey();
  } catch (error) {
    log('error', 'Clé publique de signature manquante', { reason: (error as Error).message });
    return {
      ...base,
      outcome: {
        state: 'blocked-invalid',
        reason: 'L’installation de Teralynk est incomplète (clé de vérification absente). Réinstallez l’application.',
        detail: (error as Error).message
      }
    };
  }

  try {
    const [manifestResult, signatureText] = await Promise.all([
      fetchWithRetry(versionManifestUrl(channel), { timeoutMs: 15000, retries: 2 }),
      fetchText(versionSignatureUrl(channel), { timeoutMs: 15000, retries: 2 })
    ]);

    // 1. Vérification de signature AVANT tout usage du contenu.
    if (!verifyManifestSignature(manifestResult.body, signatureText, publicKey)) {
      log('error', 'Manifeste de version : SIGNATURE INVALIDE — accès bloqué');
      return {
        ...base,
        outcome: {
          state: 'blocked-invalid',
          reason: 'La signature du manifeste de version est invalide. Par sécurité, Teralynk refuse de continuer. Cela peut indiquer une publication corrompue ou une attaque du canal de distribution.',
          detail: 'verifyManifestSignature → false'
        }
      };
    }

    // 2. Validation du schéma.
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder().decode(manifestResult.body));
    } catch {
      return { ...base, outcome: { state: 'blocked-invalid', reason: 'Le manifeste de version n’est pas un JSON valide.' } };
    }
    const parsed = versionManifestSchema.safeParse(json);
    if (!parsed.success) {
      return {
        ...base,
        outcome: {
          state: 'blocked-invalid',
          reason: 'Le manifeste de version publié est mal formé.',
          detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        }
      };
    }
    if (parsed.data.channel !== channel) {
      return { ...base, outcome: { state: 'blocked-invalid', reason: `Le manifeste reçu ne correspond pas au canal « ${channel} ».` } };
    }

    // 3. Cache signé pour la politique de secours.
    writeSignedCache(parsed.data, signatureText.trim());

    const decision = decideUpdate(installedVersion, parsed.data);
    const resultLabel =
      decision.kind === 'up-to-date' ? 'up-to-date' : decision.kind === 'optional-update' ? 'optional-update' : 'mandatory-update';
    savePrefs({ lastUpdateCheck: { at: checkedAt, result: resultLabel, installedVersion, latestVersion: parsed.data.latest.version } });
    log('info', `Contrôle de mise à jour (${channel}) : ${resultLabel}`, {
      installed: installedVersion,
      latest: parsed.data.latest.version
    });

    if (decision.kind === 'up-to-date') return { ...base, outcome: { state: 'up-to-date', manifest: parsed.data, offline: false } };
    if (decision.kind === 'optional-update') return { ...base, outcome: { state: 'optional-update', manifest: parsed.data, offline: false } };
    return { ...base, outcome: { state: 'mandatory-update', manifest: parsed.data, offline: false } };
  } catch (error) {
    // Politique de secours explicite — jamais de succès silencieux.
    const detail = error instanceof Error ? error.message : String(error);
    const netCause = error instanceof NetworkError ? error.cause : 'unknown';
    log('warn', `Échec du contrôle de mise à jour (${netCause})`, { detail });

    const cached = readSignedCache(publicKey);
    if (cached) {
      const stillSupported = compareSemver(installedVersion, cached.manifest.latest.minSupportedVersion) >= 0;
      if (stillSupported) {
        return {
          ...base,
          outcome: { state: 'up-to-date', manifest: cached.manifest, offline: true }
        };
      }
      return {
        ...base,
        outcome: {
          state: 'mandatory-update',
          manifest: cached.manifest,
          offline: true
        }
      };
    }
    return {
      ...base,
      outcome: {
        state: 'blocked-offline',
        reason:
          netCause === 'offline' || netCause === 'timeout'
            ? 'Teralynk ne peut pas joindre GitHub et aucune vérification précédente valide n’est disponible. La vérification des mises à jour est obligatoire : reconnectez-vous puis réessayez.'
            : 'La vérification des mises à jour a échoué et aucune donnée locale valide ne permet de la remplacer.',
        detail
      }
    };
  }
}

/* ------------------------------------------------------------------ */
/* Téléchargement et installation (electron-updater)                    */
/* ------------------------------------------------------------------ */

export interface DownloadProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

let updaterWired = false;

/**
 * Branche electron-updater sur le provider GitHub officiel et lance le
 * téléchargement. La progression relayée à l'UI est la progression RÉELLE
 * fournie par electron-updater — jamais simulée.
 */
export async function downloadAndInstallUpdate(window: BrowserWindow): Promise<{ started: boolean; error?: string }> {
  if (!app.isPackaged) {
    return {
      started: false,
      error: 'L’installation automatique n’est disponible que dans la version empaquetée de Teralynk. En développement, téléchargez la version depuis la page des releases GitHub.'
    };
  }
  try {
    // Import dynamique : electron-updater n'est utile qu'en mode empaqueté.
    const { autoUpdater } = await import('electron-updater');
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    // Source unique de vérité : le flux de téléchargement est forcé depuis le
    // module de configuration central (le bloc publish d'electron-builder.yml
    // ne sert que d'échafaudage à app-update.yml lors du packaging).
    autoUpdater.setFeedURL({ provider: 'github', owner: REMOTE_CONFIG.owner, repo: REMOTE_CONFIG.repo });

    if (!updaterWired) {
      updaterWired = true;
      autoUpdater.on('download-progress', (progress: DownloadProgress) => {
        if (!window.isDestroyed()) window.webContents.send('updates:progress', progress);
      });
      autoUpdater.on('error', (error: Error) => {
        log('error', 'electron-updater : erreur', { reason: error.message });
        if (!window.isDestroyed()) window.webContents.send('updates:error', { message: error.message });
      });
      autoUpdater.on('update-downloaded', (info: { version: string }) => {
        log('info', `Mise à jour téléchargée et vérifiée : ${info.version}`);
        if (!window.isDestroyed()) window.webContents.send('updates:downloaded', { version: info.version });
      });
    }

    await autoUpdater.downloadUpdate();
    return { started: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', 'Échec du téléchargement de la mise à jour', { reason: message });
    return { started: false, error: message };
  }
}

export function quitAndInstall(): void {
  if (!app.isPackaged) return;
  import('electron-updater').then(({ autoUpdater }) => autoUpdater.quitAndInstall());
}
