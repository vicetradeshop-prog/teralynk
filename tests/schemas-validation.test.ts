/**
 * Tests de validation des données distantes (schémas zod partagés).
 * (Exigence §8 : un manifeste mal formé ne doit pas faire planter l'app ;
 *  exigence §25 : données distantes mal formées rejetées.)
 */
import { describe, expect, it } from 'vitest';
import {
  featureCardSchema,
  catalogManifestSchema,
  announcementSchema,
  pollSchema,
  versionManifestSchema,
  packageMetadataSchema,
  trustedHttpsUrlSchema
} from '@teralynk/shared';

const NOW = '2025-06-01T10:00:00.000Z';
const SHA = 'a'.repeat(64);

function validCard(overrides: Record<string, unknown> = {}) {
  return {
    id: 'net-clean',
    slug: 'net-clean',
    name: 'Nettoyage réseau',
    description: 'Affiche l’état des adaptateurs réseau.',
    category: 'Système',
    status: 'available',
    createdAt: NOW,
    updatedAt: NOW,
    script: {
      runtime: 'powershell',
      url: 'https://raw.githubusercontent.com/teralynk/teralynk/main/scripts/net-clean.ps1',
      sha256: SHA
    },
    ...overrides
  };
}

describe('featureCardSchema', () => {
  it('accepte une carte exécutable complète', () => {
    expect(featureCardSchema.safeParse(validCard()).success).toBe(true);
  });

  it('rejette une carte exécutable sans empreinte SHA-256', () => {
    const card = validCard();
    delete (card.script as Record<string, unknown>).sha256;
    const parsed = featureCardSchema.safeParse(card);
    expect(parsed.success).toBe(false);
  });

  it('rejette un statut "available" sans script exécutable', () => {
    const parsed = featureCardSchema.safeParse(validCard({ script: undefined }));
    expect(parsed.success).toBe(false);
  });

  it('accepte une carte purement informative (runtime info, sans script obligatoire)', () => {
    const parsed = featureCardSchema.safeParse(validCard({ status: 'soon', script: { runtime: 'info', url: 'https://raw.githubusercontent.com/o/r/main/x' } }));
    expect(parsed.success).toBe(true);
  });

  it('rejette une carte indisponible sans explication', () => {
    const parsed = featureCardSchema.safeParse(validCard({ status: 'unavailable', script: undefined }));
    expect(parsed.success).toBe(false);
  });

  it('accepte une carte indisponible AVEC explication', () => {
    const parsed = featureCardSchema.safeParse(
      validCard({ status: 'unavailable', script: undefined, unavailableReason: 'API distante retirée par le fournisseur.' })
    );
    expect(parsed.success).toBe(true);
  });

  it('rejette une URL de script hors des hôtes GitHub autorisés', () => {
    const parsed = featureCardSchema.safeParse(
      validCard({ script: { runtime: 'powershell', url: 'https://evil.example.com/x.ps1', sha256: SHA } })
    );
    expect(parsed.success).toBe(false);
  });

  it('rejette une URL de script en http (non chiffré)', () => {
    expect(trustedHttpsUrlSchema.safeParse('http://raw.githubusercontent.com/o/r/main/x').success).toBe(false);
  });

  it('rejette les identifiants mal formés', () => {
    expect(featureCardSchema.safeParse(validCard({ id: 'Bad Id!' })).success).toBe(false);
  });

  it('rejette une version de carte non sémantique', () => {
    expect(featureCardSchema.safeParse(validCard({ version: '1.0' })).success).toBe(false);
  });
});

describe('catalogManifestSchema', () => {
  it('accepte un manifeste complet', () => {
    const parsed = catalogManifestSchema.safeParse({ schemaVersion: 1, generatedAt: NOW, cards: [validCard()] });
    expect(parsed.success).toBe(true);
  });

  it('rejette un manifeste dont UNE carte est invalide (le tout est rejeté, pas partiellement utilisé)', () => {
    const parsed = catalogManifestSchema.safeParse({
      schemaVersion: 1,
      generatedAt: NOW,
      cards: [validCard(), validCard({ id: 'x'.repeat(200) })]
    });
    expect(parsed.success).toBe(false);
  });

  it('rejette un schemaVersion inconnu', () => {
    expect(catalogManifestSchema.safeParse({ schemaVersion: 2, generatedAt: NOW, cards: [] }).success).toBe(false);
  });

  it('rejette un manifeste sans generatedAt', () => {
    expect(catalogManifestSchema.safeParse({ schemaVersion: 1, cards: [] }).success).toBe(false);
  });
});

describe('announcementSchema', () => {
  it('accepte une annonce minimale complète', () => {
    expect(announcementSchema.safeParse({ id: 'a1', title: 'T', summary: 'S', body: 'B', publishedAt: NOW }).success).toBe(true);
  });
  it('rejette une annonce sans contenu', () => {
    expect(announcementSchema.safeParse({ id: 'a1', title: 'T', summary: 'S', publishedAt: NOW }).success).toBe(false);
  });
  it('rejette une illustration sur hôte non autorisé', () => {
    expect(announcementSchema.safeParse({ id: 'a1', title: 'T', summary: 'S', body: 'B', publishedAt: NOW, illustration: 'https://cdn.evil.com/i.png' }).success).toBe(false);
  });
});

describe('pollSchema', () => {
  const base = {
    id: 'p1',
    title: 'Quelle fonctionnalité ?',
    options: [
      { id: 'o1', label: 'A' },
      { id: 'o2', label: 'B' }
    ],
    startsAt: NOW,
    endsAt: NOW,
    createdAt: NOW
  };

  it('accepte un sondage local sans issues', () => {
    expect(pollSchema.safeParse({ ...base, mode: 'local' }).success).toBe(true);
  });

  it('rejette un sondage centralisé (github) sans issue par option', () => {
    expect(pollSchema.safeParse({ ...base, mode: 'github' }).success).toBe(false);
  });

  it('accepte un sondage centralisé avec une issue par option', () => {
    const parsed = pollSchema.safeParse({
      ...base,
      mode: 'github',
      options: [
        { id: 'o1', label: 'A', issueNumber: 12 },
        { id: 'o2', label: 'B', issueNumber: 13 }
      ]
    });
    expect(parsed.success).toBe(true);
  });

  it('rejette un sondage à une seule option', () => {
    expect(pollSchema.safeParse({ ...base, mode: 'local', options: [base.options[0]] }).success).toBe(false);
  });

  it('rejette des identifiants d’option dupliqués', () => {
    expect(
      pollSchema.safeParse({ ...base, mode: 'local', options: [{ id: 'o1', label: 'A' }, { id: 'o1', label: 'B' }] }).success
    ).toBe(false);
  });
});

describe('versionManifestSchema', () => {
  it('accepte un manifeste de version complet', () => {
    const parsed = versionManifestSchema.safeParse({
      schemaVersion: 1,
      channel: 'stable',
      latest: {
        version: '1.0.0',
        channel: 'stable',
        title: 'Première version',
        publishedAt: NOW,
        tag: 'v1.0.0',
        minSupportedVersion: '1.0.0',
        files: [{ name: 'Teralynk-Setup-1.0.0.exe', sha256: SHA, size: 1024 }]
      },
      history: []
    });
    expect(parsed.success).toBe(true);
  });

  it('rejette une empreinte de fichier mal formée', () => {
    const parsed = versionManifestSchema.safeParse({
      schemaVersion: 1,
      channel: 'stable',
      latest: {
        version: '1.0.0',
        channel: 'stable',
        title: 'T',
        publishedAt: NOW,
        tag: 'v1.0.0',
        minSupportedVersion: '1.0.0',
        files: [{ name: 'a.exe', sha256: 'pas-une-empreinte', size: 1 }]
      }
    });
    expect(parsed.success).toBe(false);
  });

  it('rejette un nom de fichier avec traversée de chemin', () => {
    const parsed = versionManifestSchema.safeParse({
      schemaVersion: 1,
      channel: 'stable',
      latest: {
        version: '1.0.0',
        channel: 'stable',
        title: 'T',
        publishedAt: NOW,
        tag: 'v1.0.0',
        minSupportedVersion: '1.0.0',
        files: [{ name: '../../etc/passwd', sha256: SHA, size: 1 }]
      }
    });
    expect(parsed.success).toBe(false);
  });
});

describe('packageMetadataSchema (paquet ZIP de publication)', () => {
  it('accepte des métadonnées de paquet conformes', () => {
    expect(
      packageMetadataSchema.safeParse({
        packageFormat: 1,
        app: 'teralynk',
        version: '1.2.0',
        channel: 'stable',
        files: ['Teralynk-Setup-1.2.0.exe', 'latest.yml'],
        minSupportedVersion: '1.0.0',
        title: 'Teralynk 1.2.0',
        builtAt: NOW
      }).success
    ).toBe(true);
  });

  it('rejette un paquet sans fichier de distribution', () => {
    expect(
      packageMetadataSchema.safeParse({
        packageFormat: 1, app: 'teralynk', version: '1.2.0', files: [], minSupportedVersion: '1.0.0', title: 'T', builtAt: NOW
      }).success
    ).toBe(false);
  });

  it('rejette un chemin dangereux dans la liste des fichiers', () => {
    expect(
      packageMetadataSchema.safeParse({
        packageFormat: 1, app: 'teralynk', version: '1.2.0', files: ['../evil.exe'], minSupportedVersion: '1.0.0', title: 'T', builtAt: NOW
      }).success
    ).toBe(false);
  });
});
