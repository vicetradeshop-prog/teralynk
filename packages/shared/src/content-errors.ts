/**
 * Classification uniforme des échecs de chargement du contenu distant.
 * 404 = « pas encore publié » (état vide propre), et non une erreur technique.
 */
export type RemoteContentIssue = 'offline' | 'invalid' | 'http' | 'not-published';

export function classifyContentFetchError(
  cause: 'offline' | 'timeout' | 'http' | 'invalid' | 'unknown',
  status?: number
): RemoteContentIssue {
  if (cause === 'http' && status === 404) return 'not-published';
  if (cause === 'offline' || cause === 'timeout') return 'offline';
  if (cause === 'invalid') return 'invalid';
  if (cause === 'http') return 'http';
  return 'http';
}

export function contentIssueMessage(issue: RemoteContentIssue, name: string): string {
  switch (issue) {
    case 'not-published':
      return `Aucun contenu « ${name} » n’est encore publié sur le dépôt officiel.`;
    case 'offline':
      return 'Le service de publication est inaccessible et aucune donnée locale valide n’est disponible.';
    case 'invalid':
      return `Le fichier « ${name} » publié est invalide ou sa signature ne correspond pas.`;
    default:
      return `Impossible de charger « ${name} » depuis le dépôt officiel.`;
  }
}
