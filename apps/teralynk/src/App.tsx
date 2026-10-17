/**
 * Orchestrateur de Teralynk :
 *   Intro animée → Vérification OBLIGATOIRE des mises à jour → Shell applicatif.
 *
 * La vérification ne peut jamais être contournée : le seul chemin vers le
 * tableau de bord passe par un résultat de gate autorisé (à jour, mise à jour
 * facultative acceptée explicitement, ou mode dégradé hors-ligne décidé par le
 * processus principal sur la base du manifeste signé en cache).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { MotionConfig } from 'framer-motion';
import type { Announcement, FeatureCard } from '@teralynk/shared';
import { Shell, type PageId } from '@/components/Shell';
import { GlobalSearch } from '@/components/GlobalSearch';
import { ToastProvider, useToast } from '@/components/Toasts';
import { IntroScreen } from '@/pages/IntroScreen';
import { UpdateGate } from '@/pages/UpdateGate';
import { HomePage } from '@/pages/HomePage';
import { ExplorePage, type ExploreFilters } from '@/pages/ExplorePage';
import { FavoritesPage } from '@/pages/FavoritesPage';
import { AnnouncementsPage, isAnnouncementActive } from '@/pages/AnnouncementsPage';
import { PollsPage } from '@/pages/PollsPage';
import { HistoryPage } from '@/pages/HistoryPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { CardDetailModal, RunPrepareModal } from '@/features/CardDetail';
import { MusicDownloader } from '@/features/MusicDownloader';
import { RunConsole } from '@/features/RunConsole';
import { useAnnouncements, useCatalog, usePolls, usePrefs, useApplyVisualPrefs } from '@/hooks/useData';
import { api, type PreparedScriptView, type PrefsView, type SystemInfo, type UpdateGateView } from '@/lib/api';
import { isCardExecutable } from '@/components/FeatureCard';

type Stage = 'intro' | 'gate' | 'app';

function AppInner() {
  const toast = useToast();
  const [stage, setStage] = useState<Stage>('intro');
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateGateView | null>(null);
  const [page, setPage] = useState<PageId>('home');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ExploreFilters>({ category: null, status: null, platform: null, sort: 'featured' });

  const { prefs, setPrefs, patch, toggleFavorite } = usePrefs();
  useApplyVisualPrefs(prefs);

  const catalog = useCatalog();
  const announcements = useAnnouncements();
  const polls = usePolls();

  // Carte ouverte (détails) et exécution en cours.
  const [detailCard, setDetailCard] = useState<FeatureCard | null>(null);
  const [musicCard, setMusicCard] = useState<FeatureCard | null>(null);

  // Routage d'ouverture : interface native dédiée OU fenêtre de détails générique.
  const openCard = (card: FeatureCard) => {
    if (card.featureUi === 'music-downloader') {
      setMusicCard(card);
      return;
    }
    setDetailCard(card);
  };
  const [prepareCard, setPrepareCard] = useState<FeatureCard | null>(null);
  const [run, setRun] = useState<{ prepared: PreparedScriptView; card: FeatureCard } | null>(null);
  const [announcementDetail, setAnnouncementDetail] = useState<Announcement | null>(null);
  const [gateNonce, setGateNonce] = useState(0);
  const filtersRestored = useMemo(() => ({ current: false }), []);

  useEffect(() => {
    api?.system.info().then((info) => {
      setSystemInfo(info);
      document.title = `Teralynk ${info.appVersion}`;
    });
  }, []);

  // Restauration des derniers filtres (préférence locale) — une seule fois.
  useEffect(() => {
    if (!prefs || filtersRestored.current) return;
    filtersRestored.current = true;
    setQuery(prefs.lastFilters.query);
    setFilters({
      category: prefs.lastFilters.category,
      status: prefs.lastFilters.status as ExploreFilters['status'],
      platform: prefs.lastFilters.platform as ExploreFilters['platform'],
      sort: prefs.lastFilters.sort
    });
  }, [prefs, filtersRestored]);

  // Persistance des filtres utilisés (après restauration initiale).
  useEffect(() => {
    if (!prefs || !filtersRestored.current) return;
    void api?.prefs.patch({ lastFilters: { query, category: filters.category, status: filters.status, platform: filters.platform, sort: filters.sort } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, filters.category, filters.status, filters.platform, filters.sort]);

  const finishIntro = useCallback(() => setStage('gate'), []);

  const onGatePassed = useCallback((result: UpdateGateView) => {
    setUpdateInfo(result);
    setStage('app');
  }, []);

  const cards = catalog.data?.cards ?? [];
  const cardNames = useMemo(() => new Map(cards.map((c) => [c.id, c.name])), [cards]);

  const activeAnnouncements = useMemo(
    () => (announcements.data?.announcements ?? []).filter((a) => isAnnouncementActive(a)),
    [announcements.data]
  );
  const topAnnouncement = useMemo(
    () =>
      [...activeAnnouncements]
        .sort((a, b) => {
          const rank = { critical: 0, high: 1, normal: 2, low: 3 } as const;
          return rank[a.priority] - rank[b.priority] || new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
        })
        .find((a) => a.priority === 'critical' || a.priority === 'high') ?? null,
    [activeAnnouncements]
  );

  const openPolls = useMemo(
    () => (polls.data?.polls ?? []).filter((p) => p.status === 'open' && new Date(p.endsAt).getTime() > Date.now()).length,
    [polls.data]
  );

  const offline = updateInfo?.outcome.state === 'up-to-date' && updateInfo.outcome.offline;

  const badges: Partial<Record<PageId, number>> = {
    favorites: prefs?.favorites.length ?? 0,
    announcements: activeAnnouncements.filter((a) => Date.now() - new Date(a.publishedAt).getTime() < 7 * 864e5).length || undefined,
    polls: openPolls || undefined
  };

  const searchSlot = (
    <GlobalSearch
      value={query}
      onChange={(value) => {
        setQuery(value);
        if (value.trim() && page !== 'explore') setPage('explore');
      }}
      cards={cards}
      onPickSuggestion={(q) => {
        setQuery(q);
        setPage('explore');
      }}
    />
  );

  /* ---------------- Rendu par étape ---------------- */

  if (stage === 'intro') {
    return (
      <IntroScreen
        onFinished={finishIntro}
        skipIntro={prefs?.skipIntro ?? false}
        reducedMotionSetting={prefs?.reduceMotion ?? 'system'}
      />
    );
  }

  if (stage === 'gate') {
    return <UpdateGate key={gateNonce} onGatePassed={onGatePassed} />;
  }

  const pageContent = (() => {
    switch (page) {
      case 'home':
        return (
          <HomePage
            catalog={catalog}
            topAnnouncement={topAnnouncement}
            offline={Boolean(offline)}
            updateInfo={updateInfo}
            favorites={prefs?.favorites ?? []}
            onOpenCard={openCard}
            onToggleFavorite={(card) => void toggleFavorite(card.id)}
            onNavigate={setPage}
            onOpenAnnouncement={(a) => {
              setAnnouncementDetail(a);
              setPage('announcements');
            }}
            onShowUpdate={() => setStage('gate')}
          />
        );
      case 'explore':
        return (
          <ExplorePage
            catalog={catalog}
            query={query}
            filters={filters}
            onFiltersChange={setFilters}
            favorites={prefs?.favorites ?? []}
            onOpenCard={openCard}
            onToggleFavorite={(card) => void toggleFavorite(card.id)}
          />
        );
      case 'favorites':
        return (
          <FavoritesPage
            catalog={catalog}
            favorites={prefs?.favorites ?? []}
            onOpenCard={openCard}
            onToggleFavorite={(card) => void toggleFavorite(card.id)}
            onNavigate={setPage}
          />
        );
      case 'announcements':
        return (
          <AnnouncementsPage
            announcements={announcements}
            initialDetail={announcementDetail}
            onConsumeInitialDetail={() => setAnnouncementDetail(null)}
          />
        );
      case 'polls':
        return <PollsPage polls={polls} prefs={prefs} onPrefsChange={setPrefs} />;
      case 'history':
        return (
          <HistoryPage
            prefs={prefs}
            cardNames={cardNames}
            onClear={async () => {
              const next = await api!.prefs.patch({ history: [] });
              setPrefs(next);
              toast.push('info', 'Historique local vidé.');
            }}
          />
        );
      case 'settings':
        return (
          <SettingsPage
            prefs={prefs}
            onPrefsChange={setPrefs}
            systemInfo={systemInfo}
            onCheckUpdates={() => {
              setGateNonce((n) => n + 1);
              setStage('gate');
            }}
          />
        );
    }
  })();

  return (
    <>
      <div className="tl-ambient" aria-hidden />
      <Shell
        page={page}
        onNavigate={setPage}
        searchSlot={searchSlot}
        systemInfo={{
          appVersion: systemInfo?.appVersion ?? '…',
          channel: updateInfo?.channel ?? prefs?.updateChannel ?? 'stable',
          offline: Boolean(offline)
        }}
        updateInfo={updateInfo}
        badges={badges}
      >
        {pageContent}
      </Shell>

      {/* Détails de carte */}
      <CardDetailModal
        card={detailCard}
        onClose={() => setDetailCard(null)}
        favorite={detailCard ? (prefs?.favorites ?? []).includes(detailCard.id) : false}
        onToggleFavorite={(card) => void toggleFavorite(card.id)}
        onExecute={(card) => {
          if (!isCardExecutable(card)) {
            toast.push('warning', 'Cette fonctionnalité n’est pas exécutable actuellement.');
            return;
          }
          setDetailCard(null);
          setPrepareCard(card);
        }}
      />

      {/* Préparation (téléchargement + SHA-256 + confirmation) */}
      {prepareCard && (
        <RunPrepareModal
          card={prepareCard}
          onClose={() => setPrepareCard(null)}
          onConfirmed={(prepared: PreparedScriptView, card: FeatureCard) => {
            setPrepareCard(null);
            setRun({ prepared, card });
          }}
        />
      )}

      {/* Console d'exécution */}
      {run && <RunConsole prepared={run.prepared} card={run.card} onClose={() => setRun(null)} />}

      {/* Fonctionnalité native : téléchargeur de musique */}
      {musicCard && <MusicDownloader card={musicCard} onClose={() => setMusicCard(null)} />}
    </>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <MotionConfig reducedMotion="user">
        <AppInner />
      </MotionConfig>
    </ToastProvider>
  );
}

// Utilisé par SettingsPage après reset : recharge l'état complet.
export type { PrefsView };
