/**
 * Page Explorer — catalogue complet, filtres, tri, résultats de recherche.
 * Fonctionne exclusivement sur les données réellement reçues du catalogue.
 */
import { useMemo } from 'react';
import type { CardStatus, CatalogManifest, FeatureCard, Platform } from '@teralynk/shared';
import { FeatureCard as FeatureCardView } from '@/components/FeatureCard';
import { Button, EmptyState, ErrorState } from '@/components/ui';
import { IconCompass, IconRefresh, IconSearch } from '@/components/Icons';
import { categoriesOf, filterCatalog, type SortMode } from '@/lib/search';
import type { ContentState } from '@/hooks/useData';

export interface ExploreFilters {
  category: string | null;
  status: CardStatus | null;
  platform: Platform | null;
  sort: SortMode;
}

interface Props {
  catalog: ContentState<CatalogManifest>;
  query: string;
  filters: ExploreFilters;
  onFiltersChange: (filters: ExploreFilters) => void;
  favorites: string[];
  onOpenCard: (card: FeatureCard) => void;
  onToggleFavorite: (card: FeatureCard) => void;
}

const STATUS_OPTIONS: Array<{ value: CardStatus | null; label: string }> = [
  { value: null, label: 'Tous états' },
  { value: 'available', label: 'Disponible' },
  { value: 'new', label: 'Nouveauté' },
  { value: 'experimental', label: 'Expérimental' },
  { value: 'soon', label: 'Prochainement' },
  { value: 'unavailable', label: 'Indisponible' }
];

const PLATFORM_OPTIONS: Array<{ value: Platform | null; label: string }> = [
  { value: null, label: 'Toutes plateformes' },
  { value: 'windows', label: 'Windows' },
  { value: 'macos', label: 'macOS' },
  { value: 'linux', label: 'Linux' }
];

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: 'featured', label: 'Mises en avant' },
  { value: 'name', label: 'Nom (A→Z)' },
  { value: 'created', label: 'Date d’ajout' },
  { value: 'updated', label: 'Dernière mise à jour' }
];

export function ExplorePage({ catalog, query, filters, onFiltersChange, favorites, onOpenCard, onToggleFavorite }: Props) {
  const cards = catalog.data?.cards ?? [];
  const categories = useMemo(() => categoriesOf(cards), [cards]);

  const results = useMemo(
    () => filterCatalog(cards, { query, favorites, ...filters }),
    [cards, query, filters, favorites]
  );

  const activeFilterCount = [filters.category, filters.status, filters.platform].filter(Boolean).length + (query.trim() ? 1 : 0);

  return (
    <>
      <div className="tl-page-head">
        <h1 className="tl-page-title">Explorer</h1>
        <p className="tl-page-sub">
          {catalog.loading
            ? 'Chargement du catalogue…'
            : catalog.error
              ? 'Catalogue indisponible.'
              : `${results.length} résultat${results.length > 1 ? 's' : ''}${activeFilterCount ? ` · ${activeFilterCount} filtre${activeFilterCount > 1 ? 's' : ''} actif${activeFilterCount > 1 ? 's' : ''}` : ''}`}
          {catalog.source === 'cache' && !catalog.loading && !catalog.error && (
            <span style={{ color: 'var(--tl-warning)' }}> · données en cache local{catalog.stale ? ' (périmées)' : ''}</span>
          )}
        </p>
      </div>

      {catalog.error && catalog.error.kind === 'not-published' && (
        <EmptyState
          icon={<IconCompass size={30} />}
          title="Catalogue pas encore publié"
          message="Le dépôt officiel ne contient aucun catalogue pour l’instant. Dès sa première publication depuis Teralynk Admin, les cartes apparaîtront ici automatiquement — sans réinstallation."
          action={<Button variant="secondary" icon={<IconRefresh size={14} />} onClick={catalog.reload}>Rechercher maintenant</Button>}
        />
      )}
      {catalog.error && catalog.error.kind !== 'not-published' && (
        <ErrorState title="Catalogue inaccessible" message={catalog.error.message} detail={catalog.error.detail} onRetry={catalog.reload} />
      )}

      {!catalog.error && (
        <>
          <div className="tl-filterbar" style={{ marginBottom: 20 }}>
            <button className={`tl-chip ${!filters.category ? 'is-active' : ''}`} onClick={() => onFiltersChange({ ...filters, category: null })}>
              Toutes catégories
            </button>
            {categories.map((category) => (
              <button
                key={category}
                className={`tl-chip ${filters.category === category ? 'is-active' : ''}`}
                onClick={() => onFiltersChange({ ...filters, category: filters.category === category ? null : category })}
              >
                {category}
              </button>
            ))}
            <span style={{ flex: 1 }} />
            <select
              className="tl-select"
              style={{ width: 'auto', padding: '6px 10px', fontSize: 'var(--tl-text-sm)' }}
              value={filters.status ?? ''}
              aria-label="Filtrer par disponibilité"
              onChange={(event) => onFiltersChange({ ...filters, status: (event.target.value || null) as CardStatus | null })}
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.label} value={option.value ?? ''}>{option.label}</option>
              ))}
            </select>
            <select
              className="tl-select"
              style={{ width: 'auto', padding: '6px 10px', fontSize: 'var(--tl-text-sm)' }}
              value={filters.platform ?? ''}
              aria-label="Filtrer par plateforme"
              onChange={(event) => onFiltersChange({ ...filters, platform: (event.target.value || null) as Platform | null })}
            >
              {PLATFORM_OPTIONS.map((option) => (
                <option key={option.label} value={option.value ?? ''}>{option.label}</option>
              ))}
            </select>
            <select
              className="tl-select"
              style={{ width: 'auto', padding: '6px 10px', fontSize: 'var(--tl-text-sm)' }}
              value={filters.sort}
              aria-label="Trier"
              onChange={(event) => onFiltersChange({ ...filters, sort: event.target.value as SortMode })}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>

          {catalog.loading ? (
            <div className="tl-card-grid">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="tl-feature-card is-disabled" style={{ minHeight: 190 }}>
                  <span className="tl-spinner" />
                </div>
              ))}
            </div>
          ) : results.length > 0 ? (
            <div className="tl-card-grid">
              {results.map((card, index) => (
                <FeatureCardView key={card.id} card={card} index={index} favorite={favorites.includes(card.id)} onOpen={onOpenCard} onToggleFavorite={onToggleFavorite} />
              ))}
            </div>
          ) : (
            <EmptyState
              icon={query ? <IconSearch size={30} /> : <IconCompass size={30} />}
              title={query ? 'Aucun résultat pour cette recherche' : 'Aucune carte ne correspond à ces filtres'}
              message={
                query
                  ? `Aucune fonctionnalité publiée ne correspond à « ${query} ». Essayez un autre terme, vérifiez l’orthographe, ou retirez des filtres.`
                  : 'Retirez des filtres pour élargir la recherche, ou actualisez le catalogue.'
              }
            />
          )}
        </>
      )}
    </>
  );
}
