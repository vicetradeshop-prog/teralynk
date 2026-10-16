/**
 * Shell applicatif : barre latérale, barre supérieure et zone de contenu.
 * Navigation par état (pas d'URL) avec transitions animées entre pages.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  IconBell, IconCompass, IconHistory, IconHome, IconInfo, IconMegaphone,
  IconPoll, IconSearch, IconSettings, IconStar, TeralynkMark
} from '@/components/Icons';
import type { UpdateGateView } from '@/lib/api';

export type PageId = 'home' | 'explore' | 'favorites' | 'announcements' | 'polls' | 'history' | 'settings' | 'about';

export interface NavEntry {
  id: PageId;
  label: string;
  icon: ReactNode;
  badge?: number;
}

interface Props {
  page: PageId;
  onNavigate: (page: PageId) => void;
  children: ReactNode;
  searchSlot?: ReactNode;
  systemInfo: { appVersion: string; channel: string; offline: boolean };
  updateInfo: UpdateGateView | null;
  badges: Partial<Record<PageId, number>>;
}

export function Shell({ page, onNavigate, children, searchSlot, systemInfo, updateInfo, badges }: Props) {
  const entries = useMemo<NavEntry[]>(
    () => [
      { id: 'home', label: 'Accueil', icon: <IconHome /> },
      { id: 'explore', label: 'Explorer', icon: <IconCompass /> },
      { id: 'favorites', label: 'Favoris', icon: <IconStar />, badge: badges.favorites },
      { id: 'announcements', label: 'Annonces', icon: <IconMegaphone />, badge: badges.announcements },
      { id: 'polls', label: 'Sondages', icon: <IconPoll />, badge: badges.polls }
    ],
    [badges]
  );

  const secondary = useMemo<NavEntry[]>(
    () => [
      { id: 'history', label: 'Historique', icon: <IconHistory /> },
      { id: 'settings', label: 'Paramètres', icon: <IconSettings /> },
      { id: 'about', label: 'À propos de Teralynk', icon: <IconInfo /> }
    ],
    []
  );

  const mandatoryPending = updateInfo?.outcome.state === 'mandatory-update' || updateInfo?.outcome.state === 'optional-update';

  return (
    <div className="tl-shell">
      {/* ---------------- Barre latérale ---------------- */}
      <nav className="tl-sidebar" aria-label="Navigation principale">
        <div className="tl-brand">
          <div className="tl-brand-mark"><TeralynkMark size={20} /></div>
          <div>
            <div className="tl-brand-name">Teralynk</div>
            <div className="tl-brand-sub">Scripts · Outils</div>
          </div>
        </div>

        {entries.map((entry) => (
          <button key={entry.id} className={`tl-nav-item ${page === entry.id ? 'is-active' : ''}`} onClick={() => onNavigate(entry.id)}>
            {entry.icon}
            <span>{entry.label}</span>
            {entry.badge ? <span className="tl-nav-badge">{entry.badge > 99 ? '99+' : entry.badge}</span> : null}
          </button>
        ))}

        <div className="tl-nav-sep" />
        <div className="tl-nav-caption">Système</div>

        {secondary.map((entry) => (
          <button key={entry.id} className={`tl-nav-item ${page === entry.id ? 'is-active' : ''}`} onClick={() => onNavigate(entry.id)}>
            {entry.icon}
            <span>{entry.label}</span>
          </button>
        ))}

        <div className="tl-sidebar-foot">
          <div className="tl-version-pill">
            <span className={`dot ${systemInfo.offline ? 'offline' : ''}`} />
            <span>v{systemInfo.appVersion} · {systemInfo.channel}</span>
            {mandatoryPending && (
              <button className="tl-btn tl-btn-icon" style={{ marginLeft: 'auto', padding: 2, color: 'var(--tl-blue)' }} title="Mise à jour disponible" aria-label="Mise à jour disponible">
                <IconBell size={14} />
              </button>
            )}
          </div>
        </div>
      </nav>

      {/* ---------------- Barre supérieure ---------------- */}
      <header className="tl-topbar">
        <div className="tl-topbar-search">{searchSlot}</div>
        <div className="tl-topbar-right">
          <span className="tl-topbar-status">
            <IconSearch size={12} aria-hidden />
            {systemInfo.offline ? 'Mode hors-ligne (données en cache)' : 'Connecté à GitHub'}
          </span>
        </div>
      </header>

      {/* ---------------- Contenu ---------------- */}
      <main className="tl-main">
        <AnimatePresence mode="wait">
          <motion.div
            key={page}
            className="tl-page"
            initial={{ opacity: 0, y: 14, scale: 0.995 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.998 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}
