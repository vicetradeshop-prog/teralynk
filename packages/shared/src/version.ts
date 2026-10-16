import type { ReleaseChannel } from './config';
import type { VersionManifest } from './schemas';

/** Résultat de comparaison sémantique : -1, 0 ou 1. */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string) => {
    const [core, pre] = v.split('-', 2);
    const parts = (core ?? '').split('.');
    if (parts.length !== 3 || parts.some((part) => !/^\d+$/.test(part))) {
      throw new Error(`Version invalide (X.Y.Z attendu) : ${v}`);
    }
    const nums = parts.map((n) => Number.parseInt(n, 10));
    return { nums: [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0], pre: pre ?? null };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const x = pa.nums[i] ?? 0;
    const y = pb.nums[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  // Une pré-version (1.0.0-beta.1) est inférieure à la version finale (1.0.0).
  if (pa.pre && !pb.pre) return -1;
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && pb.pre) {
    if (pa.pre < pb.pre) return -1;
    if (pa.pre > pb.pre) return 1;
  }
  return 0;
}

export type UpdateDecision =
  | { kind: 'up-to-date' }
  | { kind: 'optional-update'; latest: VersionManifest['latest'] }
  | { kind: 'mandatory-update'; latest: VersionManifest['latest']; minSupportedVersion: string };

/**
 * Politique de mise à jour — utilisée par l'écran de vérification obligatoire.
 *
 * Règles :
 *  - installée >  dernière publiée       → à jour (dev du canal)
 *  - installée >= minSupportedVersion    → à jour, ou mise à jour facultative
 *  - installée <  minSupportedVersion    → mise à jour OBLIGATOIRE (accès bloqué)
 *
 * Cette fonction est pure : elle ne décide jamais de contourner un contrôle.
 */
export function decideUpdate(installedVersion: string, manifest: VersionManifest): UpdateDecision {
  const latest = manifest.latest;
  const cmp = compareSemver(installedVersion, latest.version);
  if (cmp >= 0) return { kind: 'up-to-date' };
  if (compareSemver(installedVersion, latest.minSupportedVersion) < 0) {
    return { kind: 'mandatory-update', latest, minSupportedVersion: latest.minSupportedVersion };
  }
  return { kind: 'optional-update', latest };
}

export function channelOf(manifest: VersionManifest): ReleaseChannel {
  return manifest.channel;
}
