/**
 * Tests du moteur de recherche et des filtres du catalogue.
 * (Exigence §13 : recherche réelle sur les données du catalogue,
 *  aucun résultat inventé.)
 */
import { describe, expect, it } from 'vitest';
import { filterCatalog, relevanceScore, suggestQueries, categoriesOf, type SortMode } from '@/lib/search';
import type { FeatureCard } from '@teralynk/shared';

const NOW = '2025-06-01T10:00:00.000Z';
const SHA = 'b'.repeat(64);

function card(overrides: Partial<FeatureCard> = {}): FeatureCard {
  return {
    id: 'c',
    slug: 'c',
    name: 'Carte',
    description: 'Description générique',
    category: 'Divers',
    icon: 'sparkles',
    tags: [],
    status: 'soon',
    platforms: ['windows'],
    requirements: [],
    permissions: [],
    capabilities: [],
    knownRisks: [],
    riskLevel: 'low',
    featured: false,
    enabled: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides
  } as FeatureCard;
}

const CARDS: FeatureCard[] = [
  card({ id: 'net-clean', slug: 'net-clean', name: 'Nettoyage réseau', description: 'Réinitialise les adaptateurs réseau.', category: 'Réseau', tags: ['réseau', 'winsock'], status: 'available', script: { runtime: 'powershell', url: 'https://raw.githubusercontent.com/o/r/main/a.ps1', sha256: SHA, args: [], requiresAdmin: false }, featured: true, updatedAt: '2025-05-01T00:00:00.000Z' }),
  card({ id: 'disk-report', slug: 'disk-report', name: 'Rapport disque', description: 'Génère un rapport d’espace disque.', category: 'Système', tags: ['disque'], platforms: ['windows', 'linux'], updatedAt: '2025-06-02T00:00:00.000Z' }),
  card({ id: 'backup-docs', slug: 'backup-docs', name: 'Sauvegarde documents', description: 'Copie les documents vers un dossier.', category: 'Système', tags: ['sauvegarde'], createdAt: '2025-06-03T00:00:00.000Z', updatedAt: '2025-06-03T00:00:00.000Z' }),
  card({ id: 'hidden-card', slug: 'hidden-card', name: 'Carte dépubliée', description: 'Ne doit jamais apparaître.', category: 'Divers', enabled: false })
];

const baseFilters = { query: '', category: null, status: null, platform: null, sort: 'featured' as SortMode };

describe('relevanceScore', () => {
  it('privilégie une correspondance exacte du nom', () => {
    expect(relevanceScore(CARDS[0]!, 'nettoyage réseau')).toBeGreaterThan(relevanceScore(CARDS[1]!, 'nettoyage réseau'));
  });
  it('score les tags', () => {
    expect(relevanceScore(CARDS[0]!, 'winsock')).toBeGreaterThan(0);
  });
  it('score la description', () => {
    expect(relevanceScore(CARDS[1]!, 'espace disque')).toBeGreaterThan(0);
  });
  it('retourne 0 pour une requête vide', () => {
    expect(relevanceScore(CARDS[0]!, '   ')).toBe(0);
  });
});

describe('filterCatalog', () => {
  it('exclut les cartes dépubliées', () => {
    const result = filterCatalog(CARDS, baseFilters);
    expect(result.map((c) => c.id)).not.toContain('hidden-card');
  });

  it('filtre par requête sans inventer de résultats', () => {
    const result = filterCatalog(CARDS, { ...baseFilters, query: 'zzz-introuvable' });
    expect(result).toHaveLength(0);
  });

  it('trouve par nom, tag et description', () => {
    expect(filterCatalog(CARDS, { ...baseFilters, query: 'rapport' }).map((c) => c.id)).toContain('disk-report');
    expect(filterCatalog(CARDS, { ...baseFilters, query: 'sauvegarde' }).map((c) => c.id)).toContain('backup-docs');
    expect(filterCatalog(CARDS, { ...baseFilters, query: 'adaptateurs' }).map((c) => c.id)).toContain('net-clean');
  });

  it('filtre par catégorie', () => {
    const result = filterCatalog(CARDS, { ...baseFilters, category: 'Système' });
    expect(result.map((c) => c.category)).toEqual(['Système', 'Système']);
  });

  it('filtre par statut', () => {
    const result = filterCatalog(CARDS, { ...baseFilters, status: 'available' });
    expect(result.map((c) => c.id)).toEqual(['net-clean']);
  });

  it('filtre par plateforme', () => {
    const result = filterCatalog(CARDS, { ...baseFilters, platform: 'linux' });
    expect(result.map((c) => c.id)).toEqual(['disk-report']);
  });

  it('trie par nom', () => {
    const result = filterCatalog(CARDS, { ...baseFilters, sort: 'name' });
    expect(result.map((c) => c.name)).toEqual([...result.map((c) => c.name)].sort((a, b) => a.localeCompare(b, 'fr')));
  });

  it('trie par date d’ajout (plus récent d’abord)', () => {
    const result = filterCatalog(CARDS, { ...baseFilters, sort: 'created' });
    expect(result[0]!.id).toBe('backup-docs');
  });

  it('trie par date de mise à jour', () => {
    const result = filterCatalog(CARDS, { ...baseFilters, sort: 'updated' });
    expect(result[0]!.id).toBe('backup-docs');
  });

  it('met les cartes en avant d’abord en tri featured', () => {
    const result = filterCatalog(CARDS, { ...baseFilters, sort: 'featured' });
    expect(result[0]!.featured).toBe(true);
  });

  it('mode favoris uniquement', () => {
    const result = filterCatalog(CARDS, { ...baseFilters, favoritesOnly: true, favorites: ['disk-report'] });
    expect(result.map((c) => c.id)).toEqual(['disk-report']);
  });
});

describe('suggestQueries', () => {
  it('propose des suggestions issues du catalogue réel (noms)', () => {
    const suggestions = suggestQueries(CARDS, 'net');
    expect(suggestions).toContain('Nettoyage réseau');
  });
  it('propose des suggestions issues du catalogue réel (tags)', () => {
    const suggestions = suggestQueries(CARDS, 'wins');
    expect(suggestions).toContain('winsock');
  });
  it('ne propose rien sans préfixe commun', () => {
    expect(suggestQueries(CARDS, 'qqqq')).toHaveLength(0);
  });
  it('limite le nombre de suggestions', () => {
    expect(suggestQueries(CARDS, 'a', 3).length).toBeLessThanOrEqual(3);
  });
});

describe('categoriesOf', () => {
  it('liste les catégories réellement présentes (hors cartes dépubliées)', () => {
    expect(categoriesOf(CARDS)).toEqual(['Réseau', 'Système']);
  });
});
