/**
 * Carte de fonctionnalité — cœur visuel de Teralynk.
 * États : normal, survol (reflet suivant le curseur, élévation, halo),
 * désactivée (bientôt/indisponible), mise en avant.
 */
import { memo, useCallback, useRef, type MouseEvent } from 'react';
import { motion } from 'framer-motion';
import type { FeatureCard as Card } from '@teralynk/shared';
import { Badge, Button } from './ui';
import { CatalogIcon, IconHeart, IconPlay } from './Icons';

const STATUS_LABELS: Record<Card['status'], string> = {
  available: 'Disponible',
  new: 'Nouveauté',
  soon: 'Prochainement',
  experimental: 'Expérimental',
  unavailable: 'Indisponible'
};

export function statusBadgeKind(status: Card['status']): string {
  switch (status) {
    case 'available': return 'available';
    case 'new': return 'new';
    case 'soon': return 'soon';
    case 'experimental': return 'experimental';
    case 'unavailable': return 'unavailable';
  }
}

export function isCardNative(card: Card): boolean {
  return card.enabled && card.featureUi === 'music-downloader';
}

export function isCardExecutable(card: Card): boolean {
  return (
    card.enabled &&
    !card.featureUi &&
    Boolean(card.script) &&
    card.script?.runtime !== 'info' &&
    Boolean(card.script?.sha256) &&
    (card.status === 'available' || card.status === 'new' || card.status === 'experimental')
  );
}

interface Props {
  card: Card;
  favorite: boolean;
  onOpen: (card: Card) => void;
  onToggleFavorite: (card: Card) => void;
  index?: number;
}

export const FeatureCard = memo(function FeatureCard({ card, favorite, onOpen, onToggleFavorite, index = 0 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const executable = isCardExecutable(card);

  // Reflet lumineux qui suit le curseur (--mx/--my exploités en CSS).
  const onMouseMove = useCallback((event: MouseEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    ref.current?.style.setProperty('--mx', `${event.clientX - rect.left}px`);
    ref.current?.style.setProperty('--my', `${event.clientY - rect.top}px`);
  }, []);

  return (
    <motion.div
      ref={ref}
      className={`tl-feature-card ${executable ? '' : 'is-disabled'} ${card.featured ? 'is-featured' : ''}`}
      onMouseMove={onMouseMove}
      onClick={() => onOpen(card)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen(card);
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`${card.name} — ${STATUS_LABELS[card.status]}`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.035, 0.4), ease: [0.22, 1, 0.36, 1] }}
      whileTap={{ scale: 0.985 }}
    >
      <button
        className={`tl-card-fav ${favorite ? 'is-fav' : ''}`}
        aria-label={favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite(card);
        }}
      >
        <IconHeart size={15} {...(favorite ? { fill: 'currentColor' } : {})} />
      </button>

      <div className="tl-card-head">
        <div className="tl-card-icon">
          <CatalogIcon name={card.icon} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="tl-card-title">{card.name}</div>
          <div className="tl-card-category">{card.category}{card.version ? ` · v${card.version}` : ''}</div>
        </div>
      </div>

      <p className="tl-card-desc">{card.description}</p>

      {card.status === 'unavailable' && card.unavailableReason && (
        <p className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)' }}>⚠ {card.unavailableReason}</p>
      )}
      {card.status === 'soon' && (
        <p className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)' }}>{card.unavailableReason ?? 'En cours de préparation — exécution désactivée.'}</p>
      )}

      <div className="tl-card-tags">
        <Badge kind={statusBadgeKind(card.status)}>{STATUS_LABELS[card.status]}</Badge>
        {card.tags.slice(0, 3).map((tag) => (
          <span className="tl-tag" key={tag}>{tag}</span>
        ))}
      </div>

      <div className="tl-card-foot">
        <span className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)' }}>
          {card.platforms.join(' · ')}
          {card.script && card.script.runtime !== 'info' ? ` · ${card.script.runtime}` : ''}
        </span>
        <span className="tl-card-action">
          {isCardNative(card) ? (
            <Button
              variant="primary"
              size="sm"
              icon={<IconPlay size={12} />}
              className="tl-btn-sheen"
              onClick={(e) => {
                e.stopPropagation();
                onOpen(card);
              }}
            >
              Ouvrir
            </Button>
          ) : executable ? (
            <Button
              variant="primary"
              size="sm"
              icon={<IconPlay size={12} />}
              onClick={(e) => {
                e.stopPropagation();
                onOpen(card);
              }}
            >
              Détails
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onOpen(card); }}>
              Consulter
            </Button>
          )}
        </span>
      </div>
    </motion.div>
  );
});
