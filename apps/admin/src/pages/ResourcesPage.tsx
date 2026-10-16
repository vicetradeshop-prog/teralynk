/**
 * Page Ressources (admin) — inspection des fichiers de contenu publiés sur
 * le dépôt : catalogue, annonces, sondages, manifestes de version et leurs
 * signatures. Lecture seule : la modification passe par les pages dédiées.
 */
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button } from '@/components/ui';
import { IconCheck, IconExternal, IconRefresh, IconX } from '@/components/Icons';
import { adminApi, type AdminConfigView, type ContentReadResult } from '@/lib/api';

type Kind = 'catalog' | 'announcements' | 'polls' | 'versions';

const KIND_LABELS: Record<Kind, string> = {
  catalog: 'content/catalog.json',
  announcements: 'content/announcements.json',
  polls: 'content/polls.json',
  versions: 'versions/stable.json + versions/beta.json'
};

export function ResourcesPage() {
  const [kind, setKind] = useState<Kind>('catalog');
  const [result, setResult] = useState<ContentReadResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<AdminConfigView | null>(null);

  const load = useCallback(async (k: Kind) => {
    setLoading(true);
    const response = await adminApi!.content.read(k);
    setResult(response);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(kind);
    void adminApi!.config.get().then(setConfig);
  }, [kind, load]);

  const pretty = (() => {
    if (!result?.ok) return null;
    try {
      return JSON.stringify(result.content ?? result.versions, null, 2);
    } catch {
      return null;
    }
  })();

  const githubWebPath = (() => {
    if (!config || kind === 'versions' || !result?.path) return null;
    return `https://github.com/${config.repoOwner}/${config.repoName}/blob/${config.contentBranch}/${result.path}`;
  })();

  return (
    <>
      <div className="tl-page-head tl-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h1 className="tl-page-title">Ressources</h1>
          <p className="tl-page-sub">
            Fichiers de contenu publiés sur le dépôt officiel
            {config ? ` ${config.repoOwner}/${config.repoName}@${config.contentBranch}` : ''} (lecture seule).
          </p>
        </div>
        <Button variant="ghost" size="sm" icon={<IconRefresh size={14} />} loading={loading} onClick={() => load(kind)}>Actualiser</Button>
      </div>

      <div className="tl-filterbar" style={{ marginBottom: 16 }}>
        {(Object.keys(KIND_LABELS) as Kind[]).map((k) => (
          <button key={k} className={`tl-chip ${kind === k ? 'is-active' : ''}`} onClick={() => setKind(k)}>
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>

      {loading && <div className="tl-col" style={{ alignItems: 'center', padding: 32 }}><span className="tl-spinner" /></div>}

      {!loading && result && !result.ok && (
        <div className="tl-poll-mode-note" style={{ borderColor: 'rgba(248,113,113,0.45)' }}>
          <IconX size={14} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--tl-danger)' }} />
          {result.message}
        </div>
      )}

      {!loading && result?.ok && (
        <div className="tl-glass" style={{ padding: 16 }}>
          <div className="tl-row" style={{ marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            {result.exists === false ? (
              <Badge kind="soon">Fichier absent du dépôt</Badge>
            ) : (
              <Badge kind="available">Présent sur {kind === 'versions' ? 'versions/' : result.path}</Badge>
            )}
            {result.validation && (
              result.validation.ok
                ? <span className="tl-row" style={{ gap: 4, color: 'var(--tl-success)', fontSize: 'var(--tl-text-xs)' }}><IconCheck size={13} /> Schéma valide</span>
                : <span className="tl-row" style={{ gap: 4, color: 'var(--tl-danger)', fontSize: 'var(--tl-text-xs)' }}><IconX size={13} /> Schéma invalide : {result.validation.issues}</span>
            )}
            {result.sha && <span className="tl-mono tl-faint" style={{ fontSize: 10 }}>blob {result.sha.slice(0, 10)}…</span>}
            {githubWebPath && (
              <Button variant="ghost" size="sm" icon={<IconExternal size={13} />} style={{ marginLeft: 'auto' }}
                onClick={() => void adminApi!.system.openExternal(githubWebPath)}>
                Voir sur GitHub
              </Button>
            )}
          </div>
          {result.exists === false ? (
            <p className="tl-faint" style={{ fontSize: 'var(--tl-text-sm)' }}>
              Ce fichier n’existe pas encore sur la branche de contenu. Il sera créé lors de la première publication
              depuis la page dédiée ({kind === 'catalog' ? 'Catalogue' : kind === 'announcements' ? 'Annonces' : kind === 'polls' ? 'Sondages' : 'Versions'}).
            </p>
          ) : (
            <pre className="tl-code" style={{ maxHeight: '52vh' }}>{pretty ?? '(contenu non sérialisable)'}</pre>
          )}
        </div>
      )}
    </>
  );
}
