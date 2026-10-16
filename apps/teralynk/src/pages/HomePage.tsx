/**
 * Page Accueil — présentation, bannière d'annonce importante,
 * mises en avant, nouveautés et raccourcis.
 */
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { Announcement, CatalogManifest, FeatureCard } from '@teralynk/shared';
import { FeatureCard as FeatureCardView } from '@/components/FeatureCard';
import { Badge, Button, EmptyState, ErrorState } from '@/components/ui';
import { IconAlert, IconChevronRight, IconCompass, IconMegaphone, IconSparkles } from '@/components/Icons';
import type { ContentState } from '@/hooks/useData';
import type { PageId } from '@/components/Shell';
import type { UpdateGateView } from '@/lib/api';

interface Props {
  catalog: ContentState<CatalogManifest>;
  topAnnouncement: Announcement | null;
  offline: boolean;
  updateInfo: UpdateGateView | null;
  favorites: string[];
  onOpenCard: (card: FeatureCard) => void;
  onToggleFavorite: (card: FeatureCard) => void;
  onNavigate: (page: PageId) => void;
  onOpenAnnouncement: (announcement: Announcement) => void;
  onShowUpdate: () => void;
}

export function HomePage({ catalog, topAnnouncement, offline, updateInfo, favorites, onOpenCard, onToggleFavorite, onNavigate, onOpenAnnouncement, onShowUpdate }: Props) {
  const cards = catalog.data?.cards ?? [];

  const featured = useMemo(() => cards.filter((c) => c.featured && c.enabled).slice(0, 3), [cards]);
  const newest = useMemo(
    () => [...cards].filter((c) => c.enabled).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 6),
    [cards]
  );
  const executableCount = useMemo(() => cards.filter((c) => c.enabled && c.script && c.script.runtime !== 'info').length, [cards]);

  const pendingUpdate = updateInfo && (updateInfo.outcome.state === 'optional-update' || updateInfo.outcome.state === 'mandatory-update');

  return (
    <>
      {/* Bannière : mise à jour disponible */}
      {pendingUpdate && updateInfo.outcome.state === 'optional-update' && (
        <motion.div className="tl-banner" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} onClick={onShowUpdate} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && onShowUpdate()}>
          <IconSparkles size={26} style={{ color: 'var(--tl-violet-bright)', flex: 'none' }} />
          <div className="tl-banner-content">
            <div className="tl-banner-title">Teralynk {updateInfo.outcome.manifest.latest.version} est disponible</div>
            <div className="tl-banner-summary">{updateInfo.outcome.manifest.latest.title} — cliquez pour voir les nouveautés et mettre à jour.</div>
          </div>
          <IconChevronRight size={20} style={{ color: 'var(--tl-text-dim)' }} />
        </motion.div>
      )}

      {/* Bannière : mode dégradé hors-ligne */}
      {offline && (
        <div className="tl-banner tl-banner-offline">
          <IconAlert size={24} style={{ color: 'var(--tl-warning)', flex: 'none' }} />
          <div className="tl-banner-content">
            <div className="tl-banner-title">Mode dégradé hors-ligne</div>
            <div className="tl-banner-summary">
              GitHub est inaccessible : les données affichées proviennent du cache local signé (dernier contrôle :{' '}
              {updateInfo ? new Date(updateInfo.checkedAt).toLocaleString('fr-FR') : 'inconnu'}).
            </div>
          </div>
        </div>
      )}

      {/* Bannière : annonce critique/haute priorité */}
      {topAnnouncement && (
        <motion.div
          className={`tl-banner ${topAnnouncement.priority === 'critical' ? 'tl-banner-critical' : ''}`}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          onClick={() => onOpenAnnouncement(topAnnouncement)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && onOpenAnnouncement(topAnnouncement)}
        >
          <IconMegaphone size={26} style={{ color: topAnnouncement.priority === 'critical' ? '#fda4af' : 'var(--tl-blue)', flex: 'none' }} />
          <div className="tl-banner-content">
            <div className="tl-banner-title">{topAnnouncement.title}</div>
            <div className="tl-banner-summary">{topAnnouncement.summary}</div>
          </div>
          <Badge kind={topAnnouncement.priority === 'critical' ? 'critical' : 'info'}>{topAnnouncement.category}</Badge>
        </motion.div>
      )}

      {/* En-tête */}
      <div className="tl-page-head">
        <h1 className="tl-page-title">Bienvenue sur Teralynk</h1>
        <p className="tl-page-sub">
          {catalog.loading
            ? 'Chargement du catalogue publié…'
            : catalog.error
              ? 'Catalogue indisponible pour le moment.'
              : `${cards.filter((c) => c.enabled).length} fonctionnalités au catalogue · ${executableCount} exécutables depuis l’application`}
        </p>
      </div>

      {/* État d'erreur du catalogue */}
      {catalog.error && !catalog.loading && (
        <div className="tl-glass" style={{ padding: 8, marginBottom: 24 }}>
          <ErrorState
            title="Catalogue inaccessible"
            message={catalog.error.message}
            detail={catalog.error.detail}
            onRetry={catalog.reload}
          />
        </div>
      )}

      {/* Mises en avant */}
      {featured.length > 0 && (
        <section className="tl-section">
          <div className="tl-section-head">
            <h2 className="tl-section-title">Mises en avant</h2>
            <Button variant="ghost" size="sm" onClick={() => onNavigate('explore')}>Tout explorer <IconChevronRight size={13} /></Button>
          </div>
          <div className="tl-card-grid">
            {featured.map((card, index) => (
              <FeatureCardView key={card.id} card={card} index={index} favorite={favorites.includes(card.id)} onOpen={onOpenCard} onToggleFavorite={onToggleFavorite} />
            ))}
          </div>
        </section>
      )}

      {/* Nouveautés */}
      <section className="tl-section">
        <div className="tl-section-head">
          <h2 className="tl-section-title">Nouveautés et récentes mises à jour</h2>
        </div>
        {catalog.loading ? (
          <div className="tl-card-grid">
            {[0, 1, 2].map((i) => (
              <div key={i} className="tl-feature-card is-disabled" style={{ minHeight: 190 }}>
                <span className="tl-spinner" />
              </div>
            ))}
          </div>
        ) : newest.length > 0 ? (
          <div className="tl-card-grid">
            {newest.map((card, index) => (
              <FeatureCardView key={card.id} card={card} index={index} favorite={favorites.includes(card.id)} onOpen={onOpenCard} onToggleFavorite={onToggleFavorite} />
            ))}
          </div>
        ) : (
          !catalog.error && (
            <EmptyState
              icon={<IconCompass size={30} />}
              title="Aucune fonctionnalité publiée"
              message="Le catalogue distant ne contient encore aucune carte. Dès qu’une publication sera effectuée depuis Teralynk Admin, elle apparaîtra ici sans nouvelle installation."
            />
          )
        )}
      </section>
    </>
  );
}
