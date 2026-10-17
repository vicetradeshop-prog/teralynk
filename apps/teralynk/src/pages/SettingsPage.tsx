/**
 * Page Paramètres — Apparence, Application, Exécution, Données locales.
 *
 * Confidentialité produit : les informations techniques sensibles (diagnostic
 * complet, chemins d'exécutables, versions d'infrastructure) sont masquées par
 * défaut derrière un « Mode avancé » explicite, destiné au support. L'utilisateur
 * final ne voit que ce qui lui est utile.
 */
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Modal } from '@/components/ui';
import { IconAlert, IconCheck, IconExternal, IconRefresh, IconShield, IconTerminal, IconTrash, IconX, TeralynkMark } from '@/components/Icons';
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
  const [advanced, setAdvanced] = useState(false);

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
  }, [loadRuntimes]);

  useEffect(() => {
    if (advanced && githubStatus === null) void checkGithub();
  }, [advanced, githubStatus, checkGithub]);

  if (!prefs) return null;

  const patch = async (partial: Partial<PrefsView>) => {
    const next = await api!.prefs.patch(partial);
    onPrefsChange(next);
  };

  return (
    <>
      <div className="tl-page-head">
        <h1 className="tl-page-title">Paramètres</h1>
        <p className="tl-page-sub">Vos préférences, sur cet appareil uniquement.</p>
      </div>

      {/* ---------------- Apparence ---------------- */}
      <section className="tl-settings-group">
        <h3>Apparence</h3>
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
            <div className="sub">« Système » respecte le réglage d’accessibilité de votre OS.</div>
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
            <div className="sub">« Discret » améliore la fluidité sur les machines modestes.</div>
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
            <div className="sub">La vérification de mise à jour reste toujours effectuée.</div>
          </div>
          <label className="tl-switch">
            <input type="checkbox" checked={prefs.skipIntro} onChange={(e) => void patch({ skipIntro: e.target.checked })} />
            <span className="tl-switch-track" /><span className="tl-switch-thumb" />
          </label>
        </div>
      </section>

      {/* ---------------- Application ---------------- */}
      <section className="tl-settings-group">
        <h3>Application</h3>
        <div className="tl-settings-row">
          <div className="grow">
            <div className="title">Version</div>
            <div className="sub">
              Dernier contrôle : {prefs.lastUpdateCheck ? new Date(prefs.lastUpdateCheck.at).toLocaleString('fr-FR') : 'au démarrage'}
              {prefs.lastUpdateCheck?.latestVersion ? ` · dernière version publiée : ${prefs.lastUpdateCheck.latestVersion}` : ''}
            </div>
          </div>
          <Badge kind="info">v{systemInfo?.appVersion ?? '…'}</Badge>
        </div>

        <div className="tl-settings-row">
          <div className="grow">
            <div className="title">Canal de mise à jour</div>
            <div className="sub">« stable » recommandé ; « beta » pour les avant-premières.</div>
          </div>
          <select className="tl-select" style={{ width: 160 }} value={prefs.updateChannel} onChange={(e) => void patch({ updateChannel: e.target.value as PrefsView['updateChannel'] })}>
            <option value="stable">Stable</option>
            <option value="beta">Bêta</option>
          </select>
        </div>

        <div className="tl-settings-row">
          <div className="grow">
            <div className="title">Vérifier les mises à jour maintenant</div>
            <div className="sub">Effectuée automatiquement à chaque démarrage.</div>
          </div>
          <Button variant="secondary" size="sm" icon={<IconRefresh size={14} />} onClick={onCheckUpdates}>Vérifier</Button>
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

      {/* ---------------- Exécution ---------------- */}
      <section className="tl-settings-group">
        <h3>Exécution des scripts</h3>
        <p className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)', marginBottom: 8 }}>
          Environnements détectés sur cet appareil. Teralynk n’installe rien sans votre accord.
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
                {/* Le chemin d'exécutable n'est exposé qu'en mode avancé. */}
                <div className="sub">{runtime.detected ? (advanced ? runtime.executablePath : 'Prêt à l’emploi') : runtime.installHint}</div>
              </div>
              {runtime.detected ? <Badge kind="available">Détecté</Badge> : <Badge kind="soon">Absent</Badge>}
            </div>
          ))
        )}
        <div className="tl-settings-row">
          <div className="grow">
            <div className="title">Conservation de l’historique</div>
          </div>
          <select className="tl-select" style={{ width: 160 }} value={prefs.historyRetentionDays} onChange={(e) => void patch({ historyRetentionDays: Number(e.target.value) })}>
            <option value={7}>7 jours</option>
            <option value={30}>30 jours</option>
            <option value={90}>90 jours</option>
            <option value={365}>1 an</option>
          </select>
        </div>
      </section>

      {/* ---------------- Support / mode avancé ---------------- */}
      <section className="tl-settings-group">
        <div className="tl-row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
          <h3 style={{ margin: 0 }}>Support</h3>
          <label className="tl-row" style={{ gap: 8, cursor: 'pointer' }}>
            <span className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)' }}>Mode avancé</span>
            <span className="tl-switch">
              <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
              <span className="tl-switch-track" /><span className="tl-switch-thumb" />
            </span>
          </label>
        </div>
        <p className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)', marginBottom: 8 }}>
          Réservé au dépannage : affiche l’état de connexion détaillé, les journaux et le diagnostic complet.
        </p>

        {advanced && (
          <>
            <div className="tl-settings-row">
              <div className="grow">
                <div className="title">Connexion au service de publication</div>
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
            <div className="tl-settings-row">
              <div className="grow">
                <div className="title">Journaux techniques</div>
                <div className="sub">Fichiers locaux assainis (aucun secret, aucune télémétrie).</div>
              </div>
              <Button variant="ghost" size="sm" icon={<IconExternal size={14} />} onClick={() => void api!.system.openLogs()}>Ouvrir</Button>
            </div>
            <dl className="tl-kv" style={{ padding: '12px 0' }}>
              <dt>Version</dt><dd className="tl-mono">{systemInfo?.appVersion ?? '—'}</dd>
              <dt>Système</dt><dd>{systemInfo ? `${systemInfo.platform} ${systemInfo.arch}` : '—'}</dd>
              <dt>Dernier contrôle</dt>
              <dd>{prefs.lastUpdateCheck ? `${new Date(prefs.lastUpdateCheck.at).toLocaleString('fr-FR')} — ${prefs.lastUpdateCheck.result}` : 'Aucun'}</dd>
            </dl>
          </>
        )}
      </section>

      {/* ---------------- Données locales ---------------- */}
      <section className="tl-settings-group">
        <h3>Données locales</h3>
        <div className="tl-settings-row">
          <div className="grow">
            <div className="title">Vider le cache de contenu</div>
            <div className="sub">Catalogue, annonces et sondages seront rechargés depuis le service officiel.</div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setConfirmReset('cache')}>Vider</Button>
        </div>
        <div className="tl-settings-row">
          <div className="grow">
            <div className="title" style={{ color: 'var(--tl-danger)' }}>Réinitialiser les préférences</div>
            <div className="sub">Favoris, réglages, votes locaux et historique de cet appareil. Irréversible.</div>
          </div>
          <Button variant="danger" size="sm" icon={<IconTrash size={14} />} onClick={() => setConfirmReset('prefs')}>Réinitialiser</Button>
        </div>
      </section>

      {/* ---------------- Marque (minimal, non sensible) ---------------- */}
      <div className="tl-brand-foot">
        <div className="tl-brand-mark" style={{ width: 40, height: 40, borderRadius: 12 }}>
          <TeralynkMark size={22} />
        </div>
        <div>
          <b>Teralynk</b> <span className="tl-faint">v{systemInfo?.appVersion ?? '…'}</span>
          <div className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)' }}>
            Scripts et outils vérifiés, distribués officiellement via GitHub.
            {' '}<button className="tl-link" onClick={() => systemInfo && void api!.system.openExternal(systemInfo.repoUrl)}>Projet officiel</button>
            {' · '}<button className="tl-link" onClick={() => systemInfo && void api!.system.openExternal(systemInfo.releasesUrl)}>Versions</button>
          </div>
        </div>
      </div>

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
              Favoris, réglages d’apparence, votes locaux et historique seront définitivement supprimés de cet appareil.
            </>
          ) : (
            'Le contenu mis en cache sera supprimé et rechargé depuis le service officiel à la prochaine actualisation.'
          )}
        </p>
      </Modal>
    </>
  );
}
