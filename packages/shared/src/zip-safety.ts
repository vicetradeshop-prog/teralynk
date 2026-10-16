/**
 * Validation des chemins d'entrées d'une archive ZIP.
 * Utilisée par Teralynk Admin AVANT toute extraction : refuse les chemins
 * qui chercheraient à écrire en dehors du répertoire cible (Zip Slip),
 * les chemins absolus, les lecteurs Windows et les liens.
 */
export interface ZipPathIssue {
  entry: string;
  reason: 'absolute' | 'traversal' | 'drive' | 'unc' | 'empty' | 'backslash';
}

export function inspectZipEntryPath(entry: string): ZipPathIssue | null {
  if (!entry || entry.trim().length === 0) return { entry, reason: 'empty' };
  if (entry.startsWith('\\\\')) return { entry, reason: 'unc' };
  if (entry.startsWith('/') || entry.startsWith('\\')) return { entry, reason: 'absolute' };
  if (/^[A-Za-z]:/.test(entry)) return { entry, reason: 'drive' };
  if (entry.includes('\\')) return { entry, reason: 'backslash' };
  const segments = entry.split('/');
  let depth = 0;
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      depth--;
      if (depth < 0) return { entry, reason: 'traversal' };
    } else {
      depth++;
    }
  }
  // NUL ou caractères de contrôle
  if (/[\x00-\x1f]/.test(entry)) return { entry, reason: 'traversal' };
  return null;
}

/** Vérifie une liste complète d'entrées ; retourne tous les problèmes détectés. */
export function inspectZipEntries(entries: string[]): ZipPathIssue[] {
  const issues: ZipPathIssue[] = [];
  for (const entry of entries) {
    const issue = inspectZipEntryPath(entry);
    if (issue) issues.push(issue);
  }
  return issues;
}

/**
 * Résout un chemin d'extraction de manière sûre : le résultat reste
 * strictement dans `targetDir`, sinon une erreur est levée.
 */
export function safeJoinForExtraction(targetDir: string, entry: string, separator: '/' | '\\' = '/'): string {
  const normalizedTarget = targetDir.endsWith(separator) ? targetDir.slice(0, -1) : targetDir;
  if (inspectZipEntryPath(entry)) {
    throw new Error(`Chemin d'archive refusé : ${entry}`);
  }
  const cleaned = entry
    .split('/')
    .filter((s) => s !== '' && s !== '.')
    .join(separator);
  return `${normalizedTarget}${separator}${cleaned}`;
}
