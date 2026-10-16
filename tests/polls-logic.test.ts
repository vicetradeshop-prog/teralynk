/**
 * Tests de la logique des sondages : fenêtre temporelle, participabilité,
 * et surtout l'HONNÊTETÉ des modes (local ≠ centralisé).
 * (Exigence §11 : ne jamais prétendre qu'un vote local est centralisé.)
 */
import { describe, expect, it } from 'vitest';
import { pollWindowState, isPollParticipable, describePollParticipation, type Poll } from '@teralynk/shared';

const PAST = '2025-01-01T00:00:00.000Z';
const NOW = '2025-06-15T12:00:00.000Z';
const FUTURE = '2025-12-31T23:59:59.000Z';

function poll(overrides: Partial<Poll> = {}): Poll {
  return {
    id: 'p1',
    title: 'Quelle fonctionnalité ?',
    description: '',
    options: [
      { id: 'o1', label: 'A' },
      { id: 'o2', label: 'B' }
    ],
    mode: 'local',
    startsAt: PAST,
    endsAt: FUTURE,
    status: 'open',
    createdAt: PAST,
    ...overrides
  };
}

const NOW_DATE = new Date(NOW);

describe('pollWindowState', () => {
  it('détecte un sondage programmé', () => {
    expect(pollWindowState(poll({ startsAt: FUTURE }), NOW_DATE)).toBe('scheduled');
  });
  it('détecte un sondage ouvert dans sa fenêtre', () => {
    expect(pollWindowState(poll(), NOW_DATE)).toBe('open');
  });
  it('détecte un sondage terminé', () => {
    expect(pollWindowState(poll({ endsAt: PAST }), NOW_DATE)).toBe('ended');
  });
});

describe('isPollParticipable', () => {
  it('exige statut open ET fenêtre ouverte', () => {
    expect(isPollParticipable(poll(), NOW_DATE)).toBe(true);
    expect(isPollParticipable(poll({ status: 'closed' }), NOW_DATE)).toBe(false);
    expect(isPollParticipable(poll({ status: 'draft' }), NOW_DATE)).toBe(false);
    expect(isPollParticipable(poll({ startsAt: FUTURE }), NOW_DATE)).toBe(false);
    expect(isPollParticipable(poll({ endsAt: PAST }), NOW_DATE)).toBe(false);
  });
});

describe('describePollParticipation — honnêteté des modes', () => {
  it('mode local : annonce clairement l’absence de résultat global', () => {
    const info = describePollParticipation(poll({ mode: 'local' }));
    expect(info.resultsCapability).toBe('local-only');
    expect(info.modeExplanation).toContain('PAS comptabilisé');
    expect(info.modeExplanation.toLowerCase()).not.toContain('centralis');
  });

  it('mode github : résultats centralisés réels, vote authentifié', () => {
    const info = describePollParticipation(
      poll({ mode: 'github', options: [{ id: 'o1', label: 'A', issueNumber: 1 }, { id: 'o2', label: 'B', issueNumber: 2 }] })
    );
    expect(info.resultsCapability).toBe('centralized-counts');
    expect(info.modeExplanation).toContain('GitHub');
    expect(info.modeExplanation).toContain('jeton');
  });

  it('un sondage fermé n’est pas participable quel que soit le mode', () => {
    expect(describePollParticipation(poll({ mode: 'github', status: 'closed' })).participable).toBe(false);
  });
});
