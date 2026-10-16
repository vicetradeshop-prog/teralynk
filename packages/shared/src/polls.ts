import type { Poll } from './schemas';

/**
 * Logique pure de résolution de l'état d'un sondage et de la participation.
 * Partagée par l'application et le panel admin — garantit que les deux
 * présentent exactement la même sémantique.
 */

export type PollWindowState = 'scheduled' | 'open' | 'ended';

/** État temporel réel d'un sondage, indépendamment de son statut éditorial. */
export function pollWindowState(poll: Poll, now: Date = new Date()): PollWindowState {
  if (now.getTime() < new Date(poll.startsAt).getTime()) return 'scheduled';
  if (now.getTime() > new Date(poll.endsAt).getTime()) return 'ended';
  return 'open';
}

/** Un sondage est participable si publié, ouvert statutairement et dans sa fenêtre temporelle. */
export function isPollParticipable(poll: Poll, now: Date = new Date()): boolean {
  return poll.status === 'open' && pollWindowState(poll, now) === 'open';
}

export interface PollParticipationInfo {
  participable: boolean;
  windowState: PollWindowState;
  /** Texte explicite sur la nature du vote — jamais trompeur. */
  modeExplanation: string;
  /** Ce que l'application peut réellement afficher comme résultats. */
  resultsCapability: 'none' | 'centralized-counts' | 'local-only';
}

export function describePollParticipation(poll: Poll): PollParticipationInfo {
  const windowState = pollWindowState(poll);
  const participable = isPollParticipable(poll);
  if (poll.mode === 'github') {
    return {
      participable,
      windowState,
      modeExplanation:
        'Sondage centralisé via GitHub : votre vote est une réaction "+1" publique sur l’issue dédiée à chaque option. Un jeton GitHub personnel (scope public_repo) est requis pour voter ; les résultats sont lus publiquement depuis GitHub.',
      resultsCapability: 'centralized-counts'
    };
  }
  return {
    participable,
    windowState,
    modeExplanation:
      'Sondage local : votre choix est enregistré uniquement sur cet ordinateur. Il n’est PAS comptabilisé dans un résultat global — aucun serveur n’agrège les votes pour ce sondage.',
    resultsCapability: 'local-only'
  };
}
