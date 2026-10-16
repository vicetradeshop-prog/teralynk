/**
 * Console de suivi d'exécution — état réel du processus :
 * sortie standard et erreurs distinguées, durée mesurée, arrêt possible,
 * code de sortie exploitable. Aucune progression simulée : si le script
 * n'émet rien, la console le montre tel quel.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { FeatureCard } from '@teralynk/shared';
import { Modal, Button, Badge } from '@/components/ui';
import { IconExternal, IconStop, IconTerminal } from '@/components/Icons';
import { api, type PreparedScriptView, type RunEventPayload } from '@/lib/api';
import { useToast } from '@/components/Toasts';

interface Line {
  at: string;
  kind: 'stdout' | 'stderr' | 'info' | 'exit';
  text: string;
}

type RunState = 'starting' | 'running' | 'exited-ok' | 'exited-error' | 'stopped' | 'failed-start';

interface Props {
  prepared: PreparedScriptView;
  card: FeatureCard;
  onClose: () => void;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s} s ${ms % 1000} ms`;
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

export function RunConsole({ prepared, card, onClose }: Props) {
  const toast = useToast();
  const [lines, setLines] = useState<Line[]>([]);
  const [runState, setRunState] = useState<RunState>('starting');
  const [runId, setRunId] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState<number | null>(null);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const startedAtRef = useRef<number>(Date.now());
  const closedRef = useRef(false);

  // Abonnement aux événements AVANT de demander l'exécution (aucune perte).
  useEffect(() => {
    closedRef.current = false;
    const unsubscribe = api!.scripts.onEvent((event: RunEventPayload) => {
      if (closedRef.current || (runIdRef.current && event.runId !== runIdRef.current)) return;
      if (event.type === 'exit') {
        setDurationMs(event.durationMs ?? null);
        setExitCode(event.code ?? null);
        setRunState(event.code === 0 ? 'exited-ok' : 'stopped');
        setLines((prev) => [
          ...prev,
          {
            at: event.at,
            kind: 'exit',
            text:
              event.code === 0
                ? `Processus terminé avec succès (code 0) en ${formatDuration(event.durationMs ?? 0)}.`
                : `Processus terminé — code ${event.code ?? 'inconnu'}${event.signal ? `, signal ${event.signal}` : ''} en ${formatDuration(event.durationMs ?? 0)}.`
          }
        ]);
        return;
      }
      setLines((prev) => [...prev.slice(-2000), { at: event.at, kind: event.type, text: event.text ?? '' }]);
    });

    // Lancement — le jeton de préparation est à usage unique côté main.
    void (async () => {
      const response = await api!.scripts.execute(prepared.token, prepared.cardId);
      if (response.ok && response.runId) {
        runIdRef.current = response.runId;
        setRunId(response.runId);
        setRunState('running');
        startedAtRef.current = Date.now();
      } else {
        setRunState('failed-start');
        setLines((prev) => [...prev, { at: new Date().toISOString(), kind: 'stderr', text: response.message ?? 'Échec du lancement.' }]);
        toast.push('error', response.message ?? 'Le script n’a pas pu démarrer.');
      }
    })();

    return () => {
      closedRef.current = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runIdRef = useRef<string | null>(null);

  // Défilement automatique vers le bas.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [lines]);

  // Durée écoulée affichée en direct pendant l'exécution.
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (runState !== 'running') return;
    const timer = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [runState]);

  const stop = useCallback(async () => {
    if (!runIdRef.current) return;
    const response = await api!.scripts.stop(runIdRef.current);
    if (!response.ok) toast.push('warning', response.message ?? 'Arrêt impossible.');
    else setRunState('stopped');
  }, [toast]);

  const stateBadge = (() => {
    switch (runState) {
      case 'starting': return <Badge kind="soon">Démarrage…</Badge>;
      case 'running': return <Badge kind="new">En cours</Badge>;
      case 'exited-ok': return <Badge kind="available">Terminé</Badge>;
      case 'exited-error':
      case 'failed-start': return <Badge kind="critical">Échec</Badge>;
      case 'stopped': return <Badge kind="unavailable">Arrêté</Badge>;
    }
  })();

  const elapsed = durationMs ?? (runState === 'running' ? Date.now() - startedAtRef.current : null);

  return (
    <Modal
      open
      onClose={onClose}
      title={card.name}
      subtitle={`Exécution · ${prepared.runtime.label}${prepared.runtime.version ? ` ${prepared.runtime.version}` : ''} · empreinte ${prepared.sha256.slice(0, 10)}…`}
      icon={<div className="tl-card-icon" style={{ width: 44, height: 44 }}><IconTerminal size={22} /></div>}
      footer={
        <>
          <Button variant="ghost" size="sm" icon={<IconExternal size={14} />} onClick={() => void api!.system.openExternal(card.script!.url)}>
            Origine du script
          </Button>
          {runState === 'running' && (
            <Button variant="danger" icon={<IconStop size={13} />} onClick={stop}>
              Arrêter
            </Button>
          )}
          <Button variant="primary" onClick={onClose} disabled={runState === 'running'}>
            Fermer
          </Button>
        </>
      }
    >
      <div className="tl-row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <span className={`tl-status-dot ${runState === 'running' || runState === 'starting' ? 'tl-status-running' : runState === 'exited-ok' ? 'tl-status-done' : 'tl-status-error'}`} />
        {stateBadge}
        <span className="tl-faint" style={{ fontSize: 'var(--tl-text-sm)' }}>
          {elapsed !== null ? `Durée : ${formatDuration(elapsed)}` : ''}
          {exitCode !== null && runState !== 'running' ? ` · code de sortie ${exitCode}` : ''}
        </span>
      </div>

      <div className="tl-console">
        <div className="tl-console-head">
          <b>Sortie</b>
          <span className="tl-faint">stdout / stderr / système — horodaté</span>
        </div>
        <div className="tl-console-body" ref={bodyRef}>
          {lines.length === 0 && runState === 'starting' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="tl-line tl-line-info">
              <span className="tl-line-time">--:--:--</span>
              <span>Lancement du processus vérifié…</span>
            </motion.div>
          )}
          {lines.length === 0 && runState === 'running' && (
            <div className="tl-line tl-line-info">
              <span className="tl-line-time">--:--:--</span>
              <span>Le script s’exécute et n’a rien émis pour l’instant.</span>
            </div>
          )}
          {lines.map((line, index) => (
            <div key={index} className={`tl-line tl-line-${line.kind === 'exit' ? (line.text.includes('succès') ? 'exit-ok' : 'exit-err') : line.kind}`}>
              <span className="tl-line-time">{new Date(line.at).toLocaleTimeString('fr-FR')}</span>
              <span>{line.text}</span>
            </div>
          ))}
        </div>
      </div>

      {runState === 'failed-start' && (
        <p className="tl-faint" style={{ marginTop: 10, fontSize: 'var(--tl-text-xs)' }}>
          Le processus n’a pas pu être lancé. Vérifiez que le runtime requis est toujours installé (Paramètres → Exécution).
        </p>
      )}
    </Modal>
  );
}
