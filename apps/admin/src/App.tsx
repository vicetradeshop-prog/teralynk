/**
 * Teralynk Admin — orchestrateur : connexion puis shell de gestion.
 * Navigation : Vue d'ensemble, Catalogue, Annonces, Sondages, Versions,
 * Ressources, Journaux, Configuration.
 */
import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ToastProvider } from '@/components/Toasts';
import {
  IconCompass, IconDownload, IconFolder, IconHistory, IconLayers,
  IconMegaphone, IconPoll, IconSettings, TeralynkMark
} from '@/components/Icons';
import { LoginPage } from '@/pages/LoginPage';
import { OverviewPage } from '@/pages/OverviewPage';
import { CatalogPage } from '@/pages/CatalogPage';
import { AdminAnnouncementsPage } from '@/pages/AnnouncementsPage';
import { AdminPollsPage } from '@/pages/PollsPage';
import { ReleasesPage } from '@/pages/ReleasesPage';
import { ResourcesPage } from '@/pages/ResourcesPage';
import { LogsPage } from '@/pages/LogsPage';
import { ConfigPage } from '@/pages/ConfigPage';
import { adminApi, type TokenValidation } from '@/lib/api';

type AdminPage = 'overview' | 'catalog' | 'announcements' | 'polls' | 'releases' | 'resources' | 'logs' | 'config';

const NAV: Array<{ id: AdminPage; label: string; icon: React.ReactNode; caption?: string }> = [
  { id: 'overview', label: 'Vue d’ensemble', icon: <IconCompass /> },
  { id: 'catalog', label: 'Catalogue', icon: <IconLayers /> },
  { id: 'announcements', label: 'Annonces', icon: <IconMegaphone /> },
  { id: 'polls', label: 'Sondages', icon: <IconPoll /> },
  { id: 'releases', label: 'Versions et mises à jour', icon: <IconDownload /> },
  { id: 'resources', label: 'Ressources', icon: <IconFolder />, caption: 'Dépôt' },
  { id: 'logs', label: 'Journaux', icon: <IconHistory /> },
  { id: 'config', label: 'Configuration', icon: <IconSettings /> }
];

function AdminInner() {
  const [validation, setValidation] = useState<TokenValidation | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [page, setPage] = useState<AdminPage>('overview');
  const [contentNonce, setContentNonce] = useState(0);

  // Pré-vérification silencieuse : si un jeton chiffré existe déjà,
  // la page de connexion le revalide automatiquement.
  useEffect(() => {
    void adminApi!.admin.tokenStatus().then((status) => {
      setBootstrapping(false);
      if (!status.exists) setValidation(null);
    });
  }, []);

  const onConnected = useCallback((result: TokenValidation) => {
    setValidation(result);
    setPage('overview');
  }, []);

  const onDisconnect = useCallback(() => setValidation(null), []);

  if (bootstrapping) {
    return (
      <div className="tl-boot">
        <div className="tl-boot-aura" aria-hidden><span /><span /><span /></div>
        <div className="tl-boot-content">
          <div className="tl-logo-wrap"><div className="tl-logo-core"><TeralynkMark size={52} /></div></div>
          <span className="tl-spinner" />
        </div>
      </div>
    );
  }

  if (!validation?.ok) {
    return <LoginPage onConnected={onConnected} />;
  }

  const pageContent = (() => {
    switch (page) {
      case 'overview':
        return <OverviewPage key={contentNonce} validation={validation} onNavigate={(p) => setPage(p as AdminPage)} />;
      case 'catalog':
        return <CatalogPage key={`c${contentNonce}`} onPublished={() => setContentNonce((n) => n + 1)} />;
      case 'announcements':
        return <AdminAnnouncementsPage />;
      case 'polls':
        return <AdminPollsPage />;
      case 'releases':
        return <ReleasesPage />;
      case 'resources':
        return <ResourcesPage key={`r${contentNonce}`} />;
      case 'logs':
        return <LogsPage />;
      case 'config':
        return <ConfigPage validation={validation} onDisconnect={onDisconnect} />;
    }
  })();

  return (
    <>
      <div className="tl-ambient" aria-hidden />
      <div className="tl-shell">
        <nav className="tl-sidebar" aria-label="Navigation admin">
          <div className="tl-brand">
            <div className="tl-brand-mark"><TeralynkMark size={20} /></div>
            <div>
              <div className="tl-brand-name">Teralynk Admin</div>
              <div className="tl-brand-sub">Publication GitHub</div>
            </div>
          </div>

          {NAV.map((entry) => (
            <span key={entry.id}>
              {entry.caption && <div className="tl-nav-caption">{entry.caption}</div>}
              <button className={`tl-nav-item ${page === entry.id ? 'is-active' : ''}`} onClick={() => setPage(entry.id)}>
                {entry.icon}
                <span>{entry.label}</span>
              </button>
            </span>
          ))}

          <div className="tl-sidebar-foot">
            <div className="tl-version-pill">
              <span className="dot" />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{validation.login} · {validation.repo}</span>
            </div>
          </div>
        </nav>

        <header className="tl-topbar">
          <div className="tl-topbar-status">
            <IconFolder size={12} aria-hidden />
            {validation.repo} @ {validation.branch}
          </div>
          <div className="tl-topbar-right">
            <span className="tl-topbar-status">
              {validation.privateRepo ? 'Dépôt privé (scope repo)' : 'Dépôt public (scope public_repo)'}
            </span>
          </div>
        </header>

        <main className="tl-main">
          <AnimatePresence mode="wait">
            <motion.div
              key={page}
              className="tl-page"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              {pageContent}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </>
  );
}

export default function AdminApp() {
  return (
    <ToastProvider>
      <AdminInner />
    </ToastProvider>
  );
}
