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

interface ElectronAutoUpdater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on<T>(event: string, listener: (arg: T) => void): unknown;
  setFeedURL(url: unknown): void;
  checkForUpdates(): Promise<{ updateInfo?: unknown; cancellationToken?: unknown } | null>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface DownloadProgress {
  percent: number;
  bytesPerSecond: number;
  transferred: number;
  total: number;
}

/**
 * Instance UNIQUE d'electron-updater pour toute la session.
 *
 * CORRECTION v1.5.0 : auparavant, `quitAndInstall()` ré-importait le module et
 * pouvait toucher une instance différente de celle qui avait téléchargé la
 * mise à jour (voire une instance jamais initialisée) : le clic sur
 * « Installer et redémarrer » ne produisait alors STRICTEMENT RIEN.
 * L'instance est désormais créée une seule fois, mémorisée ici, et réutilisée
 * pour le téléchargement ET pour l'installation.
 */
let cachedUpdater: ElectronAutoUpdater | null = null;
let updaterWired = false;
/** Version téléchargée et vérifiée dans cette session (sinon null). */
let downloadedVersion: string | null = null;
/** Un quitAndInstall est en cours (évite les doubles déclenchements). */
let installInProgress = false;
/** Passé à true dès que electron-updater confirme qu'il quitte pour installer. */
let quitConfirmed = false;

async function resolveUpdater(): Promise<ElectronAutoUpdater | null> {
  if (cachedUpdater) return cachedUpdater;
  const mod = (await import('electron-updater')) as unknown as {
    autoUpdater?: ElectronAutoUpdater;
    default?: { autoUpdater?: ElectronAutoUpdater };
    AppUpdater?: new () => ElectronAutoUpdater;
  };
  const updater = mod.autoUpdater ?? mod.default?.autoUpdater ?? (mod.AppUpdater ? new mod.AppUpdater() : undefined);
  if (updater) cachedUpdater = updater;
  return updater ?? null;
}

function wireUpdater(autoUpdater: ElectronAutoUpdater, window: BrowserWindow): void {
  if (updaterWired) return;
  updaterWired = true;
  const send = (channel: string, payload: unknown) => {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  };
  autoUpdater.on('download-progress', (progress: DownloadProgress) => send('updates:progress', progress));
  autoUpdater.on('error', (error: Error) => {
    log('error', 'electron-updater : erreur', { reason: error.message });
    installInProgress = false;
    send('updates:error', { message: error.message });
  });
  autoUpdater.on('update-downloaded', (info: { version: string }) => {
    downloadedVersion = info.version;
    log('info', `Mise à jour téléchargée et vérifiée : ${info.version}`);
    send('updates:downloaded', { version: info.version });
  });
  // Émis par electron-updater juste avant de quitter pour lancer l'installateur :
  // c'est NOTRE confirmation que le redémarrage est réellement engagé.
  autoUpdater.on('before-quit-for-update', () => {
    quitConfirmed = true;
    send('updates:installing', { version: downloadedVersion });
  });
}

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
    const autoUpdater = await resolveUpdater();
    if (!autoUpdater) {
      return {
        started: false,
        error: 'Le module de mise à jour automatique est introuvable dans cette installation. Téléchargez manuellement la dernière version depuis la page officielle des versions (bouton ci-dessous), puis relancez l’application installée.'
      };
    }
    autoUpdater.autoDownload = false;
    // Filet de sécurité : si l'utilisateur ferme la fenêtre après un
    // téléchargement vérifié, l'installation se fait à la fermeture.
    autoUpdater.autoInstallOnAppQuit = true;
    // Source unique de vérité : le flux de téléchargement est forcé depuis le
    // module de configuration central (le bloc publish d'electron-builder.yml
    // ne sert que d'échafaudage à app-update.yml lors du packaging).
    autoUpdater.setFeedURL({ provider: 'github', owner: REMOTE_CONFIG.owner, repo: REMOTE_CONFIG.repo });
    wireUpdater(autoUpdater, window);

    // electron-updater exige un checkForUpdates() préalable : sans lui,
    // downloadUpdate() rejette « Check for updates first ». Le gate a déjà
    // décidé via le manifeste signé ; ce check aligne le provider GitHub.
    const checkResult = await autoUpdater.checkForUpdates();
    if (!checkResult || !checkResult.updateInfo) {
      return {
        started: false,
        error: 'Le mécanisme d’installation ne trouve pas de mise à jour correspondant au manifeste signé vérifié. Utilisez la page officielle des versions.'
      };
    }
    await autoUpdater.downloadUpdate();
    return { started: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('error', 'Échec du téléchargement de la mise à jour', { reason: message });
    return { started: false, error: message };
  }
}

/**
 * Installe la mise à jour téléchargée puis redémarre — CORRECTION v1.5.0.
 *
 * Ancien comportement défectueux : `quitAndInstall()` fire-and-forget sur une
 * instance potentiellement différente, aucun retour vers l'UI, aucun filet de
 * sécurité : l'écran annonçait un redémarrage qui n'arrivait jamais.
 *
 * Nouveau comportement :
 *  1. refuse s'il n'y a RIEN de téléchargé/vérifié dans la session (message clair) ;
 *  2. prévient l'UI (`updates:installing`) qui affiche l'écran de redémarrage ;
 *  3. appelle quitAndInstall() sur l'instance qui a téléchargé, après un court
 *     délai pour laisser l'UI se peindre ;
 *  4. WATCHDOG : si electron-updater n'a pas confirmé le départ après 12 s,
 *     seconde tentative silencieuse ; après 20 s sans départ, l'UI revient à
 *     un état d'erreur ACTIONNABLE (réessayer / fermer pour installer à la
 *     fermeture / page des versions) au lieu d'un écran figé.
 */
export function installDownloadedUpdate(window: BrowserWindow): { ok: boolean; error?: string } {
  if (!app.isPackaged) {
    return {
      ok: false,
      error: 'L’installation automatique n’est disponible que dans la version empaquetée de Teralynk. En développement, téléchargez la version depuis la page des releases GitHub.'
    };
  }
  const updater = cachedUpdater;
  if (!updater || !downloadedVersion) {
    return {
      ok: false,
      error: 'Aucune mise à jour téléchargée et vérifiée dans cette session. Relancez le téléchargement depuis cet écran, puis cliquez à nouveau sur « Installer et redémarrer ».'
    };
  }
  if (installInProgress) return { ok: true };
  installInProgress = true;
  quitConfirmed = false;
  const version = downloadedVersion;
  log('info', `Installation de la mise à jour ${version} demandée (quitAndInstall sur l'instance active)`);
  if (!window.isDestroyed()) window.webContents.send('updates:installing', { version });

  const attempt = (silent: boolean) => {
    try {
      updater.quitAndInstall(silent, true);
    } catch (error) {
      log('error', 'quitAndInstall a levé une exception', { reason: (error as Error).message });
    }
  };

  // Laisse l'UI peindre l'écran « Redémarrage… » avant que le processus quitte.
  setTimeout(() => attempt(false), 450);

  // Watchdog 1 : seconde tentative silencieuse si aucun départ confirmé.
  setTimeout(() => {
    if (!quitConfirmed && installInProgress) {
      log('warn', 'quitAndInstall sans effet après 12 s — seconde tentative silencieuse');
      attempt(true);
    }
  }, 12000);

  // Watchdog 2 : retour à un état actionnable si toujours vivant après 20 s.
  setTimeout(() => {
    if (!quitConfirmed && installInProgress) {
      installInProgress = false;
      log('error', 'Redémarrage bloqué : l’installateur n’a pas pris la main après 20 s');
      if (!window.isDestroyed()) {
        window.webContents.send('updates:error', {
          message:
            'Le redémarrage automatique a été bloqué (antivirus, Smart App Control ou droits insuffisants). ' +
            'Deux solutions : fermez Teralynk — l’installation vérifiée se lancera automatiquement à la fermeture — ' +
            'ou réessayez depuis cet écran / installez manuellement depuis la page des versions.'
        });
      }
    }
  }, 20000);

  return { ok: true };
}

/** Compatibilité : nom historique utilisé par d'éventuels appels internes. */
export function quitAndInstall(window: BrowserWindow | null): { ok: boolean; error?: string } {
  if (!window || window.isDestroyed()) return { ok: false, error: 'Fenêtre indisponible.' };
  return installDownloadedUpdate(window);
}
