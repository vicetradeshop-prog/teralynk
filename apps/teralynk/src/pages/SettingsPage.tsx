/**
 * Page Paramètres — Apparence, Application, Exécution, Diagnostic.
 * La vérification obligatoire des mises à jour n'y est PAS désactivable :
 * seul le canal et la vérification manuelle sont exposés.
 */
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Modal } from '@/components/ui';
import { IconAlert, IconCheck, IconExternal, IconRefresh, IconShield, IconTerminal, IconTrash, IconX } from '@/components/Icons';
import { api, type PrefsView, type SystemInfo } from '@/lib/api';
import { useToast } from '@/components/Toasts';

interface RuntimeView {
  id: string;
  label: string;
  detected: boolean;
  executablePath?: string;
  version?: string;
  installHint: string;
}

interface Props {
  prefs: PrefsView | null;
  onPrefsChange: (prefs: PrefsView) => void;
  systemInfo: SystemInfo | null;
  onCheckUpdates: () => void;
}

export function SettingsPage({ prefs, onPrefsChange, systemInfo, onCheckUpdates }: Props) {
  const toast = useToast();
  const [runtimes, setRuntimes] = useState<RuntimeView[] | null>(null);
  const [githubStatus, setGithubStatus] = useState<{ reachable: boolean; latencyMs: number | null; detail?: string } | null>(null);
  const [checkingGithub, setCheckingGithub] = useState(false);
  const [confirmReset, setConfirmReset] = useState<null | 'prefs' | 'cache'>(null);

  const loadRuntimes = useCallback(async () => {
    setRuntimes(await api!.scripts.runtimes());
  }, []);

  const checkGithub = useCallback(async () => {
    setCheckingGithub(true);
    setGithubStatus(await api!.system.githubStatus());
    setCheckingGithub(false);
  }, []);

  useEffect(() => {
    void loadRuntimes();
    void checkGithub();
  }, [loadRuntimes, checkGithub]);

  if (!prefs) return null;

  const patch = async (partial: Partial<PrefsView>) => {
    const next = await api!.prefs.patch(partial);
    onPrefsChange(next);
  };

  return (
    <>
      <div className="tl-page-head">
        <h1 className="tl-page-title">Paramètres</h1>
        <p className="tl-page-sub">Préférences locales de cette installation — jamais transmises.</p>
      </div>

      {/* ---------------- Apparence ---------------- */}
      <section className="tl-settings-group">
        <h3>Apparence</h3>
        <p className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)', marginBottom: 8 }}>Identité visuelle et mouvement.</p>

        <div className="tl-settings-row">
          <div className="grow">
            <div className="title">Thème</div>
            <div className="sub">Teralynk propose l’interface sombre premium. D’autres thèmes pourront être ajoutés via le système de variables centralisé.</div>
          </div>
          <Badge kind="neutral">Sombre</Badge>
        </div>

        <div className="tl-settings-row">
          <div className="grow">
            <div className="title">Couleur d’accent</div>
            <div className="sub">Violet électrique, bleu lumineux ou reflets irisés.</div>
          </div>
          <div className="tl-accent-picker">
            {(['violet', 'blue', 'iridescent'] as const).map((accent) => (
              <button
                key={accent}
                className={`tl-accent-swatch tl-accent-${accent} ${prefs.accent === accent ? 'is-active' : ''}`}
                aria-label={`Accent ${accent}`}
                onClick={() => void patch({ accent })}
              />
            ))}
          </div>
        </div>

        <div className="tl-settings-row">
          <div className="grow">
            <div className="title">Animations</div>
            <div className="sub">« Système » respecte prefers-reduced-motion de votre OS. « Réduites » désactive les animations partout.</div>
          </div>
          <select className="tl-select" style={{ width: 160 }} value={prefs.reduceMotion} onChange={(e) => void patch({ reduceMotion: e.target.value as PrefsView['reduceMotion'] })}>
            <option value="system">Système</option>
            <option value="on">Réduites</option>
            <option value="off">Complètes</option>
          </select>
        </div>

        <div className="tl-settings-row">
          <div className="grow">
            <div className="title">Intensité des effets visuels</div>
            <div className="sub">Halo, reflets et flous : « Discret » améliore les performances sur les machines modestes.</div>
          </div>
          <select className="tl-select" style={{ width: 160 }} value={prefs.visualIntensity} onChange={(e) => void patch({ visualIntensity: e.target.value as PrefsView['visualIntensity'] })}>
            <option value="subtle">Discret</option>
            <option value="balanced">Équilibré</option>
            <option value="rich">Riche</option>
          </select>
        </div>

        <div className="tl-settings-row">
          <div className="grow">
            <div className="title">Passer l’introduction au démarrage</div>
            <div className="sub">Raccourcit l’animation de lancement. La vérification obligatoire des mises à jour reste toujours effectuée.</div>
          </div>
          <label className="tl-switch">
            <input type="checkbox" checked={prefs.skipIntro} onChange={(e) => void patch({ skipIntro: e.target.checked })} />
            <span className="tl-switch-track" /><span className="tl-switch-thumb" />
          </label>
        </div>

        <div className="tl-settings-row">
          <div className="grow">
            <div className="title">Démarrage de la fenêtre</div>
          </div>
          <select className="tl-select" style={{ width: 160 }} value={prefs.windowStart} onChange={(e) => void patch({ windowStart: e.target.value as PrefsView['windowStart'] })}>
            <option value="default">Taille normale</option>
            <option value="maximized">Maximisée</option>
          </select>
        </div>
      </section>

      {/* ---------------- Application ---------------- */}
      <section className="tl-settings-group">
        <h3>Application</h3>

        <div className="tl-settings-row">
          <div className="grow">
            <div className="title">Version installée</div>
            <div className="sub">Dernier contrôle : {prefs.lastUpdateCheck ? `${new Date(prefs.lastUpdateCheck.at).toLocaleString('fr-FR')} — ${prefs.lastUpdateCheck.result}${prefs.lastUpdateCheck.latestVersion ? ` (publiée : ${prefs.lastUpdateCheck.latestVersion})` : ''}` : 'jamais effectué'}</div>
          </div>
          <Badge kind="info">v{systemInfo?.appVersion ?? '…'}</Badge>
        </div>

        <div className="tl-settings-row">
          <div className="grow">
            <div className="title">Canal de mise à jour</div>
            <div className="sub">« stable » pour les versions finales, « beta » pour tester les avant-premières publiées.</div>
          </div>
          <select className="tl-select" style={{ width: 160 }} value={prefs.updateChannel} onChange={(e) => void patch({ updateChannel: e.target.value as PrefsView['updateChannel'] })}>
            <option value="stable">Stable</option>
            <option value="beta">Bêta</option>
          </select>
        </div>

        <div className="tl-settings-row">
          <div className="grow">
            <div className="title">Vérification des mises à jour</div>
            <div className="sub">Obligatoire au démarrage — elle ne peut pas être désactivée. Ce bouton relance un contrôle immédiat.</div>
          </div>
          <Button variant="secondary" size="sm" icon={<IconRefresh size={14} />} onClick={onCheckUpdates}>Vérifier maintenant</Button>
        </div>

        <div className="tl-settings-row">
          <div className="grow">
            <div className="title">Journaux techniques</div>
            <div className="sub">Journaux locaux assainis (jetons et secrets masqués). Aucune télémétrie.</div>
          </div>
          <Button variant="ghost" size="sm" icon={<IconExternal size={14} />} onClick={() => void api!.system.openLogs()}>Ouvrir</Button>
        </div>

        <div className="tl-settings-row">
          <div className="grow">
            <div className="title">Informations sur le projet</div>
            <div className="sub">Dépôt officiel et releases sur GitHub.</div>
          </div>
          <Button variant="ghost" size="sm" icon={<IconExternal size={14} />} onClick={() => systemInfo && void api!.system.openExternal(systemInfo.repoUrl)}>Dépôt GitHub</Button>
        </div>
      </section>

      {/* ---------------- Exécution ---------------- */}
      <section className="tl-settings-group">
        <h3>Exécution des scripts</h3>
        <p className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)', marginBottom: 8 }}>
          Runtimes détectés sur cet ordinateur. Teralynk n’installe jamais d’environnement à votre place.
        </p>

        {runtimes === null ? (
          <div className="tl-row"><span className="tl-spinner" /> <span className="tl-muted">Détection en cours…</span></div>
        ) : (
          runtimes.filter((r) => r.id !== 'info').map((runtime) => (
            <div className="tl-settings-row" key={runtime.id}>
              <div className="grow">
                <div className="title">
                  <IconTerminal size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
                  {runtime.label}
                  {runtime.version && <span className="tl-faint"> · {runtime.version}</span>}
                </div>
                <div className="sub">{runtime.detected ? runtime.executablePath : runtime.installHint}</div>
              </div>
              {runtime.detected ? <Badge kind="available">Détecté</Badge> : <Badge kind="soon">Absent</Badge>}
            </div>
          ))
        )}
        <div className="tl-settings-row">
          <div className="grow">
            <div className="title">Conservation de l’historique</div>
            <div className="sub">Durée avant purge automatique des entrées locales.</div>
          </div>
          <select className="tl-select" style={{ width: 160 }} value={prefs.historyRetentionDays} onChange={(e) => void patch({ historyRetentionDays: Number(e.target.value) })}>
            <option value={7}>7 jours</option>
            <option value={30}>30 jours</option>
            <option value={90}>90 jours</option>
            <option value={365}>1 an</option>
          </select>
        </div>
        <div className="tl-settings-row">
          <div className="grow">
            <div className="title">Sécurité d’exécution</div>
            <div className="sub">
              Empreinte SHA-256 vérifiée avant chaque exécution · confirmation explicite obligatoire ·
              processus lancé sans shell · privilèges jamais élevés automatiquement.
            </div>
          </div>
          <IconShield size={20} style={{ color: 'var(--tl-success)' }} />
        </div>
      </section>

      {/* ---------------- Diagnostic ---------------- */}
      <section className="tl-settings-group">
        <h3>Diagnostic</h3>

        <div className="tl-settings-row">
          <div className="grow">
            <div className="title">Connexion à GitHub</div>
            <div className="sub">
              {checkingGithub
                ? 'Test en cours…'
                : githubStatus
                  ? githubStatus.reachable
                    ? `Accessible · latence ${githubStatus.latencyMs} ms`
                    : `Inaccessible · ${githubStatus.detail ?? 'cause inconnue'}`
                  : 'Non testé'}
            </div>
          </div>
          {githubStatus && !checkingGithub && (githubStatus.reachable ? <IconCheck size={18} style={{ color: 'var(--tl-success)' }} /> : <IconX size={18} style={{ color: 'var(--tl-danger)' }} />)}
          <Button variant="ghost" size="sm" loading={checkingGithub} onClick={checkGithub}>Tester</Button>
        </div>

        <dl className="tl-kv" style={{ padding: '12px 0' }}>
          <dt>Version Teralynk</dt><dd className="tl-mono">{systemInfo?.appVersion ?? '—'}</dd>
          <dt>Système</dt><dd>{systemInfo ? `${systemInfo.platform} ${systemInfo.arch} · ${systemInfo.osRelease}` : '—'}</dd>
          <dt>Electron</dt><dd className="tl-mono">{systemInfo?.electronVersion ?? '—'}</dd>
          <dt>Dépôt distant</dt><dd className="tl-mono">{systemInfo ? `${systemInfo.remote.owner}/${systemInfo.remote.repo}@${systemInfo.remote.branch}` : '—'}</dd>
          <dt>Application empaquetée</dt><dd>{systemInfo?.packaged ? 'Oui (installation)' : 'Non (mode développement)'}</dd>
          <dt>Dernier contrôle</dt>
          <dd>
            {prefs.lastUpdateCheck
              ? `${new Date(prefs.lastUpdateCheck.at).toLocaleString('fr-FR')} — ${prefs.lastUpdateCheck.result}`
              : 'Aucun'}
          </dd>
        </dl>
        <p className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)' }}>
          Aucune donnée personnelle n’est collectée ni transmise : le diagnostic reste sur cet ordinateur.
        </p>
      </section>

      {/* ---------------- Données locales ---------------- */}
      <section className="tl-settings-group">
        <h3>Données locales</h3>

        <div className="tl-settings-row">
          <div className="grow">
            <div className="title">Vider le cache de contenu</div>
            <div className="sub">Supprime le catalogue, les annonces et les sondages mis en cache. Prochain chargement depuis GitHub uniquement.</div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setConfirmReset('cache')}>Vider le cache</Button>
        </div>

        <div className="tl-settings-row">
          <div className="grow">
            <div className="title" style={{ color: 'var(--tl-danger)' }}>Réinitialiser toutes les préférences</div>
            <div className="sub">Supprime favoris, réglages, votes locaux et historique de cette installation. Action irréversible.</div>
          </div>
          <Button variant="danger" size="sm" icon={<IconTrash size={14} />} onClick={() => setConfirmReset('prefs')}>Réinitialiser</Button>
        </div>
      </section>

      {/* Confirmations destructives */}
      <Modal
        open={confirmReset !== null}
        onClose={() => setConfirmReset(null)}
        small
        title={confirmReset === 'prefs' ? 'Réinitialiser les préférences ?' : 'Vider le cache de contenu ?'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmReset(null)}>Annuler</Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (confirmReset === 'prefs') {
                  const next = await api!.prefs.reset();
                  onPrefsChange(next);
                  toast.push('info', 'Préférences réinitialisées.');
                } else {
                  await api!.content.clearCache();
                  toast.push('info', 'Cache de contenu vidé.');
                }
                setConfirmReset(null);
              }}
            >
              Confirmer la suppression
            </Button>
          </>
        }
      >
        <p className="tl-muted">
          {confirmReset === 'prefs' ? (
            <>
              <IconAlert size={16} style={{ verticalAlign: -3, marginRight: 6, color: 'var(--tl-warning)' }} />
              Vos favoris, réglages d’apparence, votes locaux et historique seront définitivement supprimés de cet
              ordinateur. Les données publiées sur GitHub ne sont pas affectées.
            </>
          ) : (
            'Le catalogue, les annonces et les sondages en cache seront supprimés. Teralynk les rechargera depuis GitHub à la prochaine actualisation — hors connexion, ces contenus deviendront indisponibles jusqu’au retour du réseau.'
          )}
        </p>
      </Modal>
    </>
  );
}
