/**
 * Configuration centrale du dépôt GitHub officiel de Teralynk.
 *
 * C'est le SEUL endroit du projet où le dépôt distant est défini.
 * L'application utilisateur et Teralynk Admin importent ce module :
 * aucune autre référence au dépôt ne doit être codée en dur.
 */
export interface TeralynkRemoteConfig {
  /** Propriétaire du dépôt GitHub officiel. */
  owner: string;
  /** Nom du dépôt GitHub officiel. */
  repo: string;
  /** Branche contenant les fichiers JSON de contenu (catalogue, annonces, sondages, versions). */
  contentBranch: string;
  /** Chemins des ressources distantes, relatifs à la racine du dépôt. */
  paths: {
    /** Manifeste de version par canal (`stable.json`, `beta.json`). */
    versionsDir: string;
    /** Manifeste du catalogue de cartes. */
    catalog: string;
    /** Annonces publiées. */
    announcements: string;
    /** Sondages publiés. */
    polls: string;
  };
}

export const REMOTE_CONFIG: TeralynkRemoteConfig = {
  // Dépôt officiel configuré pour la production (propriétaire : vicetradeshop-prog).
  owner: 'vicetradeshop-prog',
  repo: 'teralynk',
  contentBranch: 'main',
  paths: {
    versionsDir: 'versions',
    catalog: 'content/catalog.json',
    announcements: 'content/announcements.json',
    polls: 'content/polls.json'
  }
};

export type ReleaseChannel = 'stable' | 'beta';
export const RELEASE_CHANNELS: readonly ReleaseChannel[] = ['stable', 'beta'] as const;

/** URL raw d'un fichier de contenu du dépôt (distribution publique, sans API). */
export function rawContentUrl(path: string, branch: string = REMOTE_CONFIG.contentBranch): string {
  return `https://raw.githubusercontent.com/${REMOTE_CONFIG.owner}/${REMOTE_CONFIG.repo}/${branch}/${path.replace(/^\/+/, '')}`;
}

/** URL du manifeste de version d'un canal. */
export function versionManifestUrl(channel: ReleaseChannel): string {
  return rawContentUrl(`${REMOTE_CONFIG.paths.versionsDir}/${channel}.json`);
}

/** URL de la signature detached (Ed25519) d'un manifeste de version. */
export function versionSignatureUrl(channel: ReleaseChannel): string {
  return `${versionManifestUrl(channel)}.sig`;
}

/** URL de la signature detached du catalogue. */
export function catalogSignatureUrl(): string {
  return `${rawContentUrl(REMOTE_CONFIG.paths.catalog)}.sig`;
}

/** Page web du dépôt (liens officiels, page releases). */
export function repoWebUrl(): string {
  return `https://github.com/${REMOTE_CONFIG.owner}/${REMOTE_CONFIG.repo}`;
}

export function releasesWebUrl(): string {
  return `${repoWebUrl()}/releases`;
}

/** Base de l'API REST GitHub pour le dépôt officiel. */
export function apiBase(): string {
  return `https://api.github.com/repos/${REMOTE_CONFIG.owner}/${REMOTE_CONFIG.repo}`;
}
