/**
 * Moteur de recherche et de filtrage du catalogue.
 * Logique pure (testable sans UI) — fonctionne uniquement sur les données
 * réellement reçues du catalogue distant, jamais sur des données inventées.
 */
import type { CardStatus, FeatureCard, Platform } from '@teralynk/shared';

export type SortMode = 'featured' | 'name' | 'created' | 'updated';

export interface CatalogFilters {
  query: string;
  category: string | null;
  status: CardStatus | null;
  platform: Platform | null;
  sort: SortMode;
  favoritesOnly?: boolean;
  favorites?: string[];
}

/** Score de pertinence simple et déterministe : nom > tags > catégorie > description. */
export function relevanceScore(card: FeatureCard, query: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  let score = 0;
  const name = card.name.toLowerCase();
  const desc = card.description.toLowerCase();
  const category = card.category.toLowerCase();

  if (name === q) score += 120;
  else if (name.startsWith(q)) score += 80;
  else if (name.includes(q)) score += 55;

  for (const tag of card.tags) {
    const t = tag.toLowerCase();
    if (t === q) score += 45;
    else if (t.startsWith(q)) score += 30;
    else if (t.includes(q)) score += 18;
  }

  if (category.includes(q)) score += 25;
  if (desc.includes(q)) score += 12;
  if (card.longDescription?.toLowerCase().includes(q)) score += 4;
  if (card.script?.runtime && card.script.runtime.includes(q)) score += 20;
  return score;
}

export function filterCatalog(cards: FeatureCard[], filters: CatalogFilters): FeatureCard[] {
  const q = filters.query.trim().toLowerCase();

  let result = cards.filter((card) => card.enabled);

  if (filters.favoritesOnly) {
    const favs = new Set(filters.favorites ?? []);
    result = result.filter((card) => favs.has(card.id));
  }
  if (filters.category) result = result.filter((card) => card.category === filters.category);
  if (filters.status) result = result.filter((card) => card.status === filters.status);
  if (filters.platform) result = result.filter((card) => card.platforms.includes(filters.platform as Platform));

  if (q) {
    result = result
      .map((card) => ({ card, score: relevanceScore(card, q) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.card);
    return result; // en mode recherche, la pertinence prime sur le tri choisi
  }

  const sorted = [...result];
  switch (filters.sort) {
    case 'name':
      sorted.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      break;
    case 'created':
      sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      break;
    case 'updated':
      sorted.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      break;
    case 'featured':
    default:
      sorted.sort((a, b) => {
        if (a.featured !== b.featured) return a.featured ? -1 : 1;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      });
  }
  return sorted;
}

/** Suggestions de recherche (noms + tags correspondant au début de saisie). */
export function suggestQueries(cards: FeatureCard[], query: string, limit = 6): string[] {
  const q = query.trim().toLowerCase();
  if (q.length < 1) return [];
  const suggestions = new Set<string>();
  for (const card of cards) {
    if (card.name.toLowerCase().includes(q)) suggestions.add(card.name);
    for (const tag of card.tags) {
      if (tag.toLowerCase().includes(q)) suggestions.add(tag);
    }
    if (suggestions.size >= limit) break;
  }
  return [...suggestions].slice(0, limit);
}

/** Liste triée des catégories réellement présentes dans le catalogue. */
export function categoriesOf(cards: FeatureCard[]): string[] {
  return [...new Set(cards.filter((c) => c.enabled).map((c) => c.category))].sort((a, b) => a.localeCompare(b, 'fr'));
}
