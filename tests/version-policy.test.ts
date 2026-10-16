/**
 * Tests de la politique de versionnement et de mise à jour obligatoire.
 * (Exigence §4 : mise à jour obligatoire non contournable, facultative proposée.)
 */
import { describe, expect, it } from 'vitest';
import { compareSemver, decideUpdate, type VersionManifest } from '@teralynk/shared';

function manifest(latest: string, minSupported: string): VersionManifest {
  return {
    schemaVersion: 1,
    channel: 'stable',
    latest: {
      version: latest,
      channel: 'stable',
      title: `Teralynk ${latest}`,
      notes: 'notes',
      publishedAt: '2025-01-01T00:00:00.000Z',
      tag: `v${latest}`,
      minSupportedVersion: minSupported,
      files: []
    },
    history: []
  };
}

describe('compareSemver', () => {
  it('ordonne les versions numériques', () => {
    expect(compareSemver('1.0.0', '1.0.1')).toBe(-1);
    expect(compareSemver('1.2.0', '1.1.9')).toBe(1);
    expect(compareSemver('2.0.0', '1.9.9')).toBe(1);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
  });

  it('traite les pré-versions comme inférieures à la version finale', () => {
    expect(compareSemver('1.0.0-beta.1', '1.0.0')).toBe(-1);
    expect(compareSemver('1.0.0', '1.0.0-beta.1')).toBe(1);
    expect(compareSemver('1.0.0-alpha', '1.0.0-beta')).toBe(-1);
  });

  it('rejette les versions invalides', () => {
    expect(() => compareSemver('abc', '1.0.0')).toThrow();
    expect(() => compareSemver('1.0', '1.0.0')).toThrow();
  });
});

describe('decideUpdate — politique obligatoire', () => {
  it('retourne up-to-date si la version installée est la dernière', () => {
    expect(decideUpdate('1.2.0', manifest('1.2.0', '1.0.0')).kind).toBe('up-to-date');
  });

  it('retourne up-to-date si la version installée dépasse la publiée (dev du canal)', () => {
    expect(decideUpdate('1.3.0', manifest('1.2.0', '1.0.0')).kind).toBe('up-to-date');
  });

  it('retourne optional-update si installée < publiée mais >= minimale', () => {
    const decision = decideUpdate('1.1.0', manifest('1.2.0', '1.0.0'));
    expect(decision.kind).toBe('optional-update');
    if (decision.kind === 'optional-update') expect(decision.latest.version).toBe('1.2.0');
  });

  it('retourne mandatory-update si installée < minimale autorisée', () => {
    const decision = decideUpdate('0.9.0', manifest('1.2.0', '1.0.0'));
    expect(decision.kind).toBe('mandatory-update');
    if (decision.kind === 'mandatory-update') expect(decision.minSupportedVersion).toBe('1.0.0');
  });

  it('une version exactement égale à la minimale reste autorisée (facultative)', () => {
    const decision = decideUpdate('1.0.0', manifest('1.2.0', '1.0.0'));
    expect(decision.kind).toBe('optional-update');
  });

  it('n’autorise JAMAIS une mise à jour obligatoire à passer pour "à jour"', () => {
    const decision = decideUpdate('0.5.0', manifest('1.2.0', '1.0.0'));
    expect(decision.kind).not.toBe('up-to-date');
    expect(decision.kind).not.toBe('optional-update');
  });
});
