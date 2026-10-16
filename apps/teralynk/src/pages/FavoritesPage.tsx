/**
 * Page Favoris — cartes enregistrées localement (aucune synchronisation :
 * pas de compte Teralynk, les favoris appartiennent à cette installation).
 */
import { useMemo } from 'react';
import type { CatalogManifest, FeatureCard } from '@teralynk/shared';
import { FeatureCard as FeatureCardView } from '@/components/FeatureCard';
import { EmptyState } from '@/components/ui';
import { IconStar } from '@/components/Icons';
import type { ContentState } from '@/hooks/useData';
import type { PageId } from '@/components/Shell';

interface Props {
  catalog: ContentState<CatalogManifest>;
  favorites: string[];
  onOpenCard: (card: FeatureCard) => void;
  onToggleFavorite: (card: FeatureCard) => void;
  onNavigate: (page: PageId) => void;
}

export function FavoritesPage({ catalog, favorites, onOpenCard, onToggleFavorite, onNavigate }: Props) {
  const cards = catalog.data?.cards ?? [];
  const favoriteCards = useMemo(() => {
    const byId = new Map(cards.map((c) => [c.id, c]));
    return favorites.map((id) => byId.get(id)).filter((c): c is FeatureCard => Boolean(c));
  }, [cards, favorites]);

  // Favoris référençant des cartes retirées du catalogue publié.
  const orphanCount = favorites.length - favoriteCards.length;

  return (
    <>
      <div className="tl-page-head">
        <h1 className="tl-page-title">Favoris</h1>
        <p className="tl-page-sub">
          Vos cartes enregistrées sur cet ordinateur — sans compte ni synchronisation entre appareils.
          {orphanCount > 0 && ` · ${orphanCount} favori${orphanCount > 1 ? 's' : ''} ne correspond${orphanCount > 1 ? 'ent' : ''} plus au catalogue publié.`}
        </p>
      </div>

      {favoriteCards.length > 0 ? (
        <div className="tl-card-grid">
          {favoriteCards.map((card, index) => (
            <FeatureCardView key={card.id} card={card} index={index} favorite onOpen={onOpenCard} onToggleFavorite={onToggleFavorite} />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<IconStar size={30} />}
          title="Aucun favori pour l’instant"
          message="Ajoutez des cartes à vos favoris depuis le catalogue pour les retrouver ici. Ils sont conservés localement, même hors connexion."
          action={
            <button className="tl-btn tl-btn-primary" onClick={() => onNavigate('explore')}>
              Explorer le catalogue
            </button>
          }
        />
      )}
    </>
  );
}
