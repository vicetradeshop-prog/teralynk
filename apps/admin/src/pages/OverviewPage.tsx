/**
 * Page Vue d'ensemble (admin) — résumé des versions, publications récentes
 * et état du dépôt. Uniquement des données réelles lues depuis GitHub.
 */
import { useCallback, useEffect, useState } from 'react';
import type { VersionManifest } from '@teralynk/shared';
import { Badge, Button } from '@/components/ui';
import { IconCheck, IconExternal, IconRefresh, IconX } from '@/components/Icons';
import { adminApi, type AdminLogEntryView, type GitHubReleaseView, type TokenValidation } from '@/lib/api';

interface Props {
  validation: TokenValidation;
  onNavigate: (page: string) => void;
}

export function OverviewPage({ validation, onNavigate }: Props) {
  const [versions, setVersions] = useState<Record<string, { content: VersionManifest; sha: string } | null> | null>(null);
  const [releases, setReleases] = useState<GitHubReleaseView[] | null>(null);
  const [logs, setLogs] = useState<AdminLogEntryView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [versionsResult, releasesResult, logsResult] = await Promise.all([
      adminApi!.content.read('versions'),
      adminApi!.releases.list(),
      adminApi!.logs.get()
    ]);
    if (versionsResult.ok && versionsResult.versions) setVersions(versionsResult.versions as Record<string, { content: VersionManifest; sha: string } | null>);
    else setError(versionsResult.message ?? 'Manifestes de version inaccessibles.');
    if (releasesResult.ok && releasesResult.releases) setReleases(releasesResult.releases);
    setLogs(logsResult.slice(0, 8));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="tl-page-head tl-row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1 className="tl-page-title">Vue d’ensemble</h1>
          <p className="tl-page-sub">
            Connecté en tant que <b>{validation.login}</b> sur {validation.repo} (branche {validation.branch}) ·
            permissions : {(validation.scopes ?? []).join(', ')}
          </p>
        </div>
        <Button variant="ghost" size="sm" icon={<IconRefresh size={14} />} loading={loading} onClick={load}>Actualiser</Button>
      </div>

      {error && (
        <div className="tl-poll-mode-note" style={{ borderColor: 'rgba(251,191,36,0.45)', marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Manifestes de version par canal */}
      <section className="tl-section">
        <h2 className="tl-section-title" style={{ marginBottom: 10 }}>Canaux de publication</h2>
        <div className="tl-card-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
          {(['stable', 'beta'] as const).map((channel) => {
            const entry = versions?.[channel];
            return (
              <div key={channel} className="tl-glass" style={{ padding: 20 }}>
                <div className="tl-row" style={{ marginBottom: 8 }}>
                  <Badge kind={channel === 'stable' ? 'available' : 'experimental'}>{channel}</Badge>
                  <span className="tl-faint tl-mono" style={{ fontSize: 11 }}>versions/{channel}.json</span>
                </div>
                {entry ? (
                  <>
                    <div style={{ fontSize: 'var(--tl-text-xl)', fontWeight: 700 }} className="tl-mono">v{entry.content.latest.version}</div>
                    <div className="tl-muted" style={{ fontSize: 'var(--tl-text-sm)' }}>{entry.content.latest.title}</div>
                    <div className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)', marginTop: 6 }}>
                      Publiée le {new Date(entry.content.latest.publishedAt).toLocaleString('fr-FR')} ·
                      minimale requise : {entry.content.latest.minSupportedVersion} ·
                      {entry.content.latest.files.length} fichier(s)
                    </div>
                  </>
                ) : (
                  <p className="tl-faint" style={{ fontSize: 'var(--tl-text-sm)' }}>
                    Aucun manifeste publié sur ce canal. La première publication de version le créera.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Releases récentes */}
      <section className="tl-section">
        <h2 className="tl-section-title" style={{ marginBottom: 10 }}>Releases récentes</h2>
        <div className="tl-glass" style={{ padding: 8, overflowX: 'auto' }}>
          <table className="admin-table">
            <thead><tr><th>Tag</th><th>Nom</th><th>État</th><th>Assets</th><th /></tr></thead>
            <tbody>
              {(releases ?? []).slice(0, 6).map((release) => (
                <tr key={release.id}>
                  <td className="tl-mono">{release.tag_name}</td>
                  <td>{release.name ?? '—'}</td>
                  <td>{release.draft ? <Badge kind="soon">Brouillon</Badge> : release.prerelease ? <Badge kind="experimental">Pré-release</Badge> : <Badge kind="available">Publiée</Badge>}</td>
                  <td className="tl-faint">{release.assets.length} fichier(s)</td>
                  <td><Button variant="ghost" size="sm" icon={<IconExternal size={13} />} onClick={() => void adminApi!.system.openExternal(release.html_url)} aria-label="Ouvrir" /></td>
                </tr>
              ))}
              {releases !== null && releases.length === 0 && (
                <tr><td colSpan={5} className="tl-faint" style={{ textAlign: 'center', padding: 16 }}>Aucune release.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Activité récente */}
      <section className="tl-section">
        <div className="tl-section-head">
          <h2 className="tl-section-title">Activité récente</h2>
          <Button variant="ghost" size="sm" onClick={() => onNavigate('logs')}>Tous les journaux</Button>
        </div>
        <div className="tl-col" style={{ gap: 6 }}>
          {logs.map((entry, index) => (
            <div key={index} className="tl-history-item">
              <span className={`op-status ${entry.status}`}>
                {entry.status === 'success' ? <IconCheck size={11} /> : entry.status === 'failed' ? <IconX size={11} /> : null}
                {entry.status}
              </span>
              <span>{entry.action}{entry.detail && <span className="tl-faint"> · {entry.detail.slice(0, 120)}</span>}</span>
              <time>{new Date(entry.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</time>
            </div>
          ))}
          {logs.length === 0 && <p className="tl-faint" style={{ padding: 12 }}>Aucune opération enregistrée pour l’instant.</p>}
        </div>
      </section>
    </>
  );
}
