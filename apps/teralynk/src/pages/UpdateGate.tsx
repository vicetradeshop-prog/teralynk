/**
 * Écran de vérification OBLIGATOIRE des mises à jour.
 *
 * Règles respectées :
 *  - Aucun bouton ne permet d'entrer dans l'application sans contrôle réussi
 *    (ou sans politique de secours explicite décidée côté main : cache signé
 *    valide + version toujours supportée → mode dégradé hors-ligne signalé).
 *  - Les messages d'étape correspondent à des étapes RÉELLES du contrôle.
 *  - La progression du téléchargement provient d'electron-updater (réelle).
 *  - Les erreurs affichent la cause et un bouton Réessayer.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api, type UpdateGateView, type UpdateProgress } from '@/lib/api';
import { Button, Progress } from '@/components/ui';
import { IconAlert, IconCheck, IconDownload, IconExternal, IconRefresh, IconShield, TeralynkMark } from '@/components/Icons';

type Phase = 'checking' | 'result';

interface Props {
  onGatePassed: (result: UpdateGateView) => void;
}

const CHECK_STEPS = [
  'Vérification de la version de Teralynk…',
  'Contrôle de la signature du manifeste…',
  'Recherche des dernières améliorations…',
  'Vérification de l’intégrité des fichiers…'
];

export function UpdateGate({ onGatePassed }: Props) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [stepIndex, setStepIndex] = useState(0);
  const [result, setResult] = useState<UpdateGateView | null>(null);
  const [progress, setProgress] = useState<UpdateProgress | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<string | null>(null);
  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const runCheck = useCallback(async () => {
    setPhase('checking');
    setStepIndex(0);
    setResult(null);
    setProgress(null);
    setDownloadError(null);
    setDownloaded(null);
    setDownloading(false);

    // Les étapes défilent PENDANT la vraie requête (jamais après coup) :
    // la vérification réseau prend typiquement 0,5–3 s.
    stepTimer.current = setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, CHECK_STEPS.length - 1));
    }, 900);

    try {
      const gate = await api!.updates.check();
      setResult(gate);
      setPhase('result');
    } finally {
      if (stepTimer.current) clearInterval(stepTimer.current);
    }
  }, []);

  useEffect(() => {
    void runCheck();
    const unsubscribe = api?.events.onUpdates((channel, payload) => {
      if (channel === 'updates:progress') setProgress(payload as UpdateProgress);
      if (channel === 'updates:error') setDownloadError((payload as { message: string }).message);
      if (channel === 'updates:downloaded') setDownloaded((payload as { version: string }).version);
    });
    return () => {
      unsubscribe?.();
      if (stepTimer.current) clearInterval(stepTimer.current);
    };
  }, [runCheck]);

  const startDownload = async () => {
    setDownloading(true);
    setDownloadError(null);
    const response = await api!.updates.download();
    if (!response.started) {
      setDownloading(false);
      setDownloadError(response.error ?? 'Téléchargement impossible.');
    }
  };

  const outcome = result?.outcome;

  const iconClass = !outcome
    ? 'tl-gate-icon is-checking'
    : outcome.state === 'up-to-date'
      ? 'tl-gate-icon is-ok'
      : outcome.state === 'blocked-offline' || outcome.state === 'blocked-invalid'
        ? 'tl-gate-icon is-err'
        : 'tl-gate-icon';

  return (
    <div className="tl-boot">
      <div className="tl-boot-aura" aria-hidden><span /><span /><span /></div>

      <motion.div
        className="tl-gate-card"
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className={iconClass}>
          <AnimatePresence mode="wait">
            {phase === 'checking' && (
              <motion.div key="checking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <IconRefresh size={38} />
              </motion.div>
            )}
            {phase === 'result' && outcome?.state === 'up-to-date' && (
              <motion.div key="ok" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                <IconCheck size={40} />
              </motion.div>
            )}
            {phase === 'result' && (outcome?.state === 'blocked-offline' || outcome?.state === 'blocked-invalid') && (
              <motion.div key="err" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                <IconAlert size={38} />
              </motion.div>
            )}
            {phase === 'result' && (outcome?.state === 'optional-update' || outcome?.state === 'mandatory-update') && (
              <motion.div key="dl" initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }}>
                <IconDownload size={38} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ---------------- Phase : vérification en cours ---------------- */}
        {phase === 'checking' && (
          <>
            <h1 className="tl-gate-title">Mise à jour de Teralynk</h1>
            <p className="tl-gate-message" aria-live="polite">{CHECK_STEPS[stepIndex]}</p>
            <div className="tl-gate-progress">
              <Progress indeterminate />
            </div>
            <p className="tl-faint tl-mono">Cette vérification est obligatoire avant d’accéder à l’application.</p>
          </>
        )}

        {/* ---------------- Phase : résultat ---------------- */}
        {phase === 'result' && result && outcome && (
          <>
            {outcome.state === 'up-to-date' && (
              <>
                <h1 className="tl-gate-title">{outcome.offline ? 'Vérification terminée (mode hors-ligne)' : 'Teralynk est à jour.'}</h1>
                <div className="tl-gate-versions">
                  <div className="v"><b>{result.installedVersion}</b><span>Installée</span></div>
                  <div className="v"><b>{outcome.manifest.latest.version}</b><span>Publiée ({result.channel})</span></div>
                </div>
                {outcome.offline ? (
                  <p className="tl-gate-message">
                    GitHub est momentanément inaccessible. La dernière vérification signée confirme que votre version reste
                    autorisée : Teralynk démarre en mode dégradé. Le catalogue en ligne peut être indisponible et une
                    bannière le signalera dans l’application.
                  </p>
                ) : (
                  <p className="tl-gate-message">Vous accédez à l’application dans un instant.</p>
                )}
                <div className="tl-gate-actions">
                  <Button variant="primary" size="lg" onClick={() => onGatePassed(result)}>
                    Entrer dans Teralynk
                  </Button>
                </div>
              </>
            )}

            {(outcome.state === 'optional-update' || outcome.state === 'mandatory-update') && (
              <>
                <h1 className="tl-gate-title">
                  {outcome.state === 'mandatory-update' ? 'Une mise à jour est nécessaire pour continuer.' : 'Une nouvelle version est disponible.'}
                </h1>
                <div className="tl-gate-versions">
                  <div className="v"><b>{result.installedVersion}</b><span>Installée</span></div>
                  <div className="v"><b>{outcome.manifest.latest.version}</b><span>À installer</span></div>
                </div>
                {outcome.manifest.latest.notes && <div className="tl-gate-notes">{outcome.manifest.latest.notes}</div>}
                {outcome.state === 'mandatory-update' && (
                  <p className="tl-gate-message">
                    Votre version (minimale requise : {outcome.manifest.latest.minSupportedVersion}) n’est plus compatible
                    avec les services publiés. L’accès au tableau de bord restera bloqué jusqu’à la mise à jour.
                  </p>
                )}

                {progress && (
                  <div className="tl-gate-progress">
                    <Progress percent={progress.percent} />
                    <div className="tl-gate-progress-meta">
                      <span>{Math.round(progress.percent)} %</span>
                      <span>{(progress.transferred / 1048576).toFixed(1)} Mo / {(progress.total / 1048576).toFixed(1)} Mo · {(progress.bytesPerSecond / 1048576).toFixed(1)} Mo/s</span>
                    </div>
                  </div>
                )}
                {downloadError && <p className="tl-gate-message" style={{ color: 'var(--tl-danger)' }}>{downloadError}</p>}
                {downloaded && (
                  <p className="tl-gate-message" style={{ color: 'var(--tl-success)' }}>
                    Version {downloaded} téléchargée et vérifiée. Teralynk va redémarrer et relancer la vérification.
                  </p>
                )}

                <div className="tl-gate-actions">
                  {!downloaded && (
                    <Button variant="primary" size="lg" loading={downloading} icon={<IconDownload size={16} />} onClick={startDownload}>
                      {downloading ? 'Téléchargement…' : 'Télécharger la mise à jour'}
                    </Button>
                  )}
                  {downloaded && (
                    <Button variant="primary" size="lg" onClick={() => void api!.updates.installNow()}>
                      Installer et redémarrer
                    </Button>
                  )}
                  {outcome.state === 'optional-update' && !downloading && !downloaded && (
                    <Button variant="secondary" size="lg" onClick={() => onGatePassed(result)}>
                      Continuer avec {result.installedVersion}
                    </Button>
                  )}
                  <Button variant="ghost" size="lg" icon={<IconExternal size={15} />} onClick={() => void api!.system.openExternal(result.releasesUrl)}>
                    Page des versions
                  </Button>
                  {!result.canAutoInstall && (
                    <p className="tl-faint" style={{ width: '100%', fontSize: 'var(--tl-text-xs)' }}>
                      Installation automatique indisponible dans ce contexte (application non empaquetée) :
                      téléchargez l’installateur depuis la page des versions GitHub.
                    </p>
                  )}
                </div>
              </>
            )}

            {(outcome.state === 'blocked-offline' || outcome.state === 'blocked-invalid') && (
              <>
                <h1 className="tl-gate-title">
                  {outcome.state === 'blocked-offline' ? 'Vérification impossible' : 'Contrôle de sécurité échoué'}
                </h1>
                <p className="tl-gate-message">{outcome.reason}</p>
                {'detail' in outcome && outcome.detail && <pre className="tl-gate-error-detail">{outcome.detail}</pre>}
                <div className="tl-gate-versions">
                  <div className="v"><b>{result.installedVersion}</b><span>Installée</span></div>
                  <div className="v"><b>—</b><span>Publiée (inconnue)</span></div>
                </div>
                <div className="tl-gate-actions">
                  <Button variant="primary" size="lg" icon={<IconRefresh size={16} />} onClick={runCheck}>
                    Réessayer
                  </Button>
                  <Button variant="ghost" size="lg" icon={<IconShield size={15} />} onClick={() => void api!.system.openLogs()}>
                    Ouvrir les journaux
                  </Button>
                </div>
                <p className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)', maxWidth: 420 }}>
                  La vérification des mises à jour est obligatoire : Teralynk ne l’ignore jamais silencieusement.
                  Aucun accès au tableau de bord n’est possible tant que ce contrôle n’a pas abouti.
                </p>
              </>
            )}
          </>
        )}

        <div style={{ position: 'absolute', bottom: 16, display: 'flex', alignItems: 'center', gap: 8, color: 'var(--tl-text-faint)', fontSize: 11 }}>
          <TeralynkMark size={14} /> Teralynk {result?.installedVersion ?? ''} · canal {result?.channel ?? 'stable'}
        </div>
      </motion.div>
    </div>
  );
}
