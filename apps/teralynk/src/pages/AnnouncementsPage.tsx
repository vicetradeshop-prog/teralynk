/**
 * Page Annonces — liste complète + consultation détaillée.
 * Les annonces retirées du dépôt disparaissent (le cache est écrasé à
 * chaque récupération réseau réussie — pas d'affichage fantôme).
 */
import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import type { Announcement, AnnouncementsManifest } from '@teralynk/shared';
import { Badge, Button, EmptyState, ErrorState, Modal } from '@/components/ui';
import { IconExternal, IconMegaphone } from '@/components/Icons';
import { api } from '@/lib/api';
import type { ContentState } from '@/hooks/useData';

const CATEGORY_LABELS: Record<string, string> = {
  general: 'Information',
  release: 'Nouvelle version',
  feature: 'Nouvelle fonctionnalité',
  update: 'Mise à jour',
  maintenance: 'Maintenance',
  alert: 'Alerte',
  catalog: 'Catalogue',
  upcoming: 'À venir'
};

function priorityBadgeKind(priority: string): string {
  switch (priority) {
    case 'critical': return 'critical';
    case 'high': return 'soon';
    default: return 'info';
  }
}

export function isAnnouncementActive(announcement: Announcement, now = new Date()): boolean {
  if (!announcement.published) return false;
  if (announcement.expiresAt && new Date(announcement.expiresAt).getTime() < now.getTime()) return false;
  return true;
}

interface Props {
  announcements: ContentState<AnnouncementsManifest>;
  initialDetail?: Announcement | null;
  onConsumeInitialDetail?: () => void;
}

export function AnnouncementsPage({ announcements, initialDetail, onConsumeInitialDetail }: Props) {
  const [detail, setDetail] = useState<Announcement | null>(initialDetail ?? null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const active = useMemo(
    () =>
      (announcements.data?.announcements ?? [])
        .filter((a) => isAnnouncementActive(a))
        .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime()),
    [announcements.data]
  );

  const categories = useMemo(() => [...new Set(active.map((a) => a.category))], [active]);
  const filtered = categoryFilter ? active.filter((a) => a.category === categoryFilter) : active;

  const openDetail = (announcement: Announcement) => {
    setDetail(announcement);
    onConsumeInitialDetail?.();
  };

  return (
    <>
      <div className="tl-page-head">
        <h1 className="tl-page-title">Annonces</h1>
        <p className="tl-page-sub">
          Communications officielles publiées depuis Teralynk Admin.
          {announcements.source === 'cache' && !announcements.loading && ' · Affichage du cache local — actualisation en cours ou GitHub inaccessible.'}
        </p>
      </div>

      {announcements.error && (
        <ErrorState title="Annonces inaccessibles" message={announcements.error.message} detail={announcements.error.detail} onRetry={announcements.reload} />
      )}

      {!announcements.error && (
        <>
          {categories.length > 1 && (
            <div className="tl-filterbar" style={{ marginBottom: 20 }}>
              <button className={`tl-chip ${!categoryFilter ? 'is-active' : ''}`} onClick={() => setCategoryFilter(null)}>Toutes</button>
              {categories.map((category) => (
                <button key={category} className={`tl-chip ${categoryFilter === category ? 'is-active' : ''}`} onClick={() => setCategoryFilter(category)}>
                  {CATEGORY_LABELS[category] ?? category}
                </button>
              ))}
            </div>
          )}

          {announcements.loading ? (
            <div className="tl-col"><span className="tl-spinner" style={{ margin: '40px auto' }} /></div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={<IconMegaphone size={30} />} title="Aucune annonce" message="Aucune annonce officielle n’est publiée pour le moment." />
          ) : (
            <div className="tl-col">
              <AnimatePresence initial={false}>
                {filtered.map((announcement, index) => (
                  <motion.div
                    key={announcement.id}
                    className="tl-announcement-card"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: Math.min(index * 0.05, 0.35) }}
                    onClick={() => openDetail(announcement)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && openDetail(announcement)}
                  >
                    <div className="tl-announcement-head">
                      <Badge kind={priorityBadgeKind(announcement.priority)}>{CATEGORY_LABELS[announcement.category] ?? announcement.category}</Badge>
                      {new Date().getTime() - new Date(announcement.publishedAt).getTime() < 7 * 24 * 3600 * 1000 && (
                        <Badge kind="new">Nouveau</Badge>
                      )}
                      <span className="tl-announcement-title">{announcement.title}</span>
                    </div>
                    <p className="tl-announcement-summary">{announcement.summary}</p>
                    <span className="tl-announcement-meta">Publiée le {new Date(announcement.publishedAt).toLocaleDateString('fr-FR', { dateStyle: 'long' })}</span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </>
      )}

      <Modal
        open={Boolean(detail)}
        onClose={() => {
          setDetail(null);
          onConsumeInitialDetail?.();
        }}
        title={detail?.title ?? ''}
        subtitle={detail ? `Publiée le ${new Date(detail.publishedAt).toLocaleDateString('fr-FR', { dateStyle: 'long' })}` : undefined}
        icon={<div className="tl-card-icon" style={{ width: 44, height: 44 }}><IconMegaphone size={22} /></div>}
        footer={
          detail?.link ? (
            <Button variant="secondary" icon={<IconExternal size={15} />} onClick={() => void api?.system.openExternal(detail.link!)}>
              Ouvrir le lien associé
            </Button>
          ) : undefined
        }
      >
        {detail?.illustration && (
          <img
            src={detail.illustration}
            alt=""
            style={{ width: '100%', borderRadius: 'var(--tl-radius-md)', marginBottom: 16, border: '1px solid var(--tl-line)' }}
            onError={(event) => { (event.target as HTMLImageElement).style.display = 'none'; }}
          />
        )}
        <div className="tl-announcement-body">{detail?.body}</div>
      </Modal>
    </>
  );
}
