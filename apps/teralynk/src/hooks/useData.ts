/**
 * Hooks de données Teralynk : préférences locales et contenu distant.
 * Chaque hook rapporte honnêtement l'origine des données (réseau ou cache)
 * et les erreurs réelles — jamais de données fictives de remplissage.
 */
import { useCallback, useEffect, useState } from 'react';
import type { AnnouncementsManifest, CatalogManifest, PollsManifest } from '@teralynk/shared';
import { api, type ContentResponse, type PrefsView } from '@/lib/api';

/* ---------------- Préférences ---------------- */

export function usePrefs() {
  const [prefs, setPrefs] = useState<PrefsView | null>(null);

  const refresh = useCallback(async () => {
    if (!api) return;
    setPrefs(await api.prefs.get());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const patch = useCallback(async (partial: Partial<PrefsView>) => {
    if (!api) return;
    const next = await api.prefs.patch(partial);
    setPrefs(next);
  }, []);

  const reset = useCallback(async () => {
    if (!api) return;
    const next = await api.prefs.reset();
    setPrefs(next);
  }, []);

  const toggleFavorite = useCallback(
    async (cardId: string) => {
      if (!api || !prefs) return;
      const favorites = prefs.favorites.includes(cardId)
        ? prefs.favorites.filter((id) => id !== cardId)
        : [...prefs.favorites, cardId];
      await patch({ favorites });
    },
    [prefs, patch]
  );

  return { prefs, setPrefs, refresh, patch, reset, toggleFavorite };
}

/* ---------------- Contenu distant ---------------- */

export interface ContentState<T> {
  data: T | null;
  loading: boolean;
  source: 'network' | 'cache' | null;
  fetchedAt: string | null;
  stale: boolean;
  error: { kind: string; message: string; detail?: string } | null;
  reload: () => void;
}

function useRemoteContent<T>(loader: () => Promise<ContentResponse<T>>): ContentState<T> {
  const [state, setState] = useState<Omit<ContentState<T>, 'reload'>>({
    data: null,
    loading: true,
    source: null,
    fetchedAt: null,
    stale: false,
    error: null
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    loader().then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setState({ data: result.data, loading: false, source: result.source, fetchedAt: result.fetchedAt, stale: result.stale, error: null });
      } else {
        setState({ data: null, loading: false, source: null, fetchedAt: null, stale: false, error: result.error });
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

export function useCatalog(): ContentState<CatalogManifest> {
  return useRemoteContent(() => api!.content.catalog());
}

export function useAnnouncements(): ContentState<AnnouncementsManifest> {
  return useRemoteContent(() => api!.content.announcements());
}

export function usePolls(): ContentState<PollsManifest> {
  return useRemoteContent(() => api!.content.polls());
}

/* ---------------- Application des préférences visuelles ---------------- */

/** Applique thème/accent/mouvement/intensité sur <html> dès que les prefs changent. */
export function useApplyVisualPrefs(prefs: PrefsView | null): void {
  useEffect(() => {
    const root = document.documentElement;
    if (!prefs) return;
    root.dataset['accent'] = prefs.accent;
    root.dataset['intensity'] = prefs.visualIntensity;
    if (prefs.reduceMotion === 'system') {
      delete root.dataset['motion'];
    } else {
      root.dataset['motion'] = prefs.reduceMotion === 'on' ? 'off' : 'on';
    }
  }, [prefs]);
}

/** Détecte prefers-reduced-motion au niveau système. */
export function useSystemReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}
