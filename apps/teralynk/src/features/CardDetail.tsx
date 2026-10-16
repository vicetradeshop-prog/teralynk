/**
 * Fenêtre de détails d'une carte + écran de préparation à l'exécution.
 *
 * Toutes les informations affichées proviennent du catalogue (jamais
 * dupliquées). L'exécution exige : préparation (téléchargement + SHA-256)
 * puis confirmation EXPLICITE de l'utilisateur — jamais d'exécution
 * automatique au simple affichage d'une carte.
 */
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import type { FeatureCard } from '@teralynk/shared';
import { Modal, Button, Badge } from '@/components/ui';
import { CatalogIcon, IconAlert, IconExternal, IconHeart, IconPlay, IconShield, IconTerminal } from '@/components/Icons';
import { isCardExecutable, statusBadgeKind } from '@/components/FeatureCard';
import { api, type PreparedScriptView } from '@/lib/api';
import { useToast } from '@/components/Toasts';

const STATUS_LABELS: Record<string, string> = {
  available: 'Disponible',
  new: 'Nouveauté',
  soon: 'Prochainement',
  experimental: 'Expérimental',
  unavailable: 'Indisponible'
};

const RISK_LABELS: Record<string, string> = {
  low: 'Risque faible',
  medium: 'Risque modéré',
  high: 'Risque élevé'
};

interface Props {
  card: FeatureCard | null;
  onClose: () => void;
  favorite: boolean;
  onToggleFavorite: (card: FeatureCard) => void;
  onExecute: (card: FeatureCard) => void;
}

export function CardDetailModal({ card, onClose, favorite, onToggleFavorite, onExecute }: Props) {
  if (!card) return null;
  const executable = isCardExecutable(card);

  return (
    <Modal
      open={Boolean(card)}
      onClose={onClose}
      title={card.name}
      subtitle={`${card.category}${card.version ? ` · version ${card.version}` : ''} · mis à jour le ${new Date(card.updatedAt).toLocaleDateString('fr-FR')}`}
      icon={
        <div className="tl-card-icon" style={{ width: 52, height: 52 }}>
          <CatalogIcon name={card.icon} size={26} />
        </div>
      }
      footer={
        <>
          <Button variant="ghost" icon={<IconHeart size={15} {...(favorite ? { fill: 'currentColor' } : {})} />} onClick={() => onToggleFavorite(card)}>
            {favorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
          </Button>
          {executable ? (
            <Button variant="primary" icon={<IconPlay size={14} />} onClick={() => onExecute(card)}>
              Préparer l’exécution
            </Button>
          ) : (
            <Button variant="secondary" disabled>
              {card.status === 'soon' ? 'Prochainement' : card.status === 'unavailable' ? 'Indisponible' : 'Non exécutable'}
            </Button>
          )}
        </>
      }
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        <Badge kind={statusBadgeKind(card.status)}>{STATUS_LABELS[card.status]}</Badge>
        <Badge kind={`risk-${card.riskLevel}`}>{RISK_LABELS[card.riskLevel]}</Badge>
        {card.status === 'experimental' && <Badge kind="experimental">Fonctionnement non garanti</Badge>}
        {card.script && card.script.runtime !== 'info' && <Badge kind="info">{card.script.runtime}</Badge>}
        {card.featured && <Badge kind="new">Mise en avant</Badge>}
      </div>

      {(card.status === 'unavailable' || card.status === 'soon') && card.unavailableReason && (
        <div className="tl-poll-mode-note" style={{ marginBottom: 16, borderColor: 'rgba(251,191,36,0.35)' }}>
          <b>{card.status === 'unavailable' ? 'Pourquoi cette fonctionnalité est indisponible : ' : ''}</b>
          {card.unavailableReason}
        </div>
      )}

      <p className="tl-selectable" style={{ color: 'var(--tl-text)', marginBottom: 14 }}>{card.description}</p>
      {card.longDescription && (
        <p className="tl-selectable tl-muted" style={{ whiteSpace: 'pre-wrap', marginBottom: 18, fontSize: 'var(--tl-text-sm)' }}>
          {card.longDescription}
        </p>
      )}

      <dl className="tl-kv" style={{ marginBottom: 18 }}>
        <dt>Systèmes compatibles</dt>
        <dd>{card.platforms.join(', ')}</dd>
        {card.script && card.script.runtime !== 'info' && (
          <>
            <dt>Langage / runtime</dt>
            <dd>{card.script.runtime}{card.script.requiresAdmin ? ' · privilèges administrateur requis (jamais accordés automatiquement)' : ''}</dd>
          </>
        )}
        {card.requirements.length > 0 && (
          <>
            <dt>Prérequis</dt>
            <dd><ul style={{ paddingLeft: 18 }}>{card.requirements.map((r) => <li key={r}>{r}</li>)}</ul></dd>
          </>
        )}
        {card.permissions.length > 0 && (
          <>
            <dt>Permissions</dt>
            <dd><ul style={{ paddingLeft: 18 }}>{card.permissions.map((p) => <li key={p}>{p}</li>)}</ul></dd>
          </>
        )}
        {card.capabilities.length > 0 && (
          <>
            <dt>Capacités principales</dt>
            <dd><ul style={{ paddingLeft: 18 }}>{card.capabilities.map((c) => <li key={c}>{c}</li>)}</ul></dd>
          </>
        )}
        {card.knownRisks.length > 0 && (
          <>
            <dt>Risques connus</dt>
            <dd>
              <ul style={{ paddingLeft: 18, color: '#fca5a5' }}>
                {card.knownRisks.map((r) => <li key={r}>{r}</li>)}
              </ul>
            </dd>
          </>
        )}
        <dt>Étiquettes</dt>
        <dd style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{card.tags.map((t) => <span className="tl-tag" key={t}>{t}</span>)}</dd>
        <dt>Publication</dt>
        <dd>Créée le {new Date(card.createdAt).toLocaleDateString('fr-FR')} · mise à jour le {new Date(card.updatedAt).toLocaleDateString('fr-FR')}</dd>
        {card.script && (
          <>
            <dt>Origine du script</dt>
            <dd className="tl-mono" style={{ wordBreak: 'break-all' }}>
              {card.script.url}
              <button
                className="tl-btn tl-btn-icon" style={{ padding: 2, marginLeft: 6, verticalAlign: 'middle' }}
                aria-label="Ouvrir l’origine"
                onClick={() => void api?.system.openExternal(card.script!.url)}
              >
                <IconExternal size={13} />
              </button>
            </dd>
            <dt>Empreinte attendue</dt>
            <dd className="tl-mono">{card.script.sha256 ?? '—'}</dd>
          </>
        )}
      </dl>

      {card.releaseNotes && (
        <>
          <h3 style={{ fontSize: 'var(--tl-text-base)', fontWeight: 640, marginBottom: 8 }}>Notes de version</h3>
          <div className="tl-gate-notes tl-selectable" style={{ maxHeight: 180 }}>{card.releaseNotes}</div>
        </>
      )}

      <div className="tl-poll-mode-note" style={{ marginTop: 18, display: 'flex', gap: 10 }}>
        <IconShield size={16} style={{ flex: 'none', marginTop: 2, color: 'var(--tl-violet-bright)' }} />
        <span>
          Avant toute exécution, Teralynk télécharge le script depuis son origine officielle, vérifie son empreinte
          SHA-256 contre le manifeste publié, vous montre son contenu et exige votre confirmation explicite.
          Provenir du dépôt officiel ne garantit jamais qu’un script est inoffensif : lisez les risques ci-dessus.
        </span>
      </div>
    </Modal>
  );
}

/* ================================================================== */
/* Préparation + confirmation d'exécution                              */
/* ================================================================== */

interface RunPrepareProps {
  card: FeatureCard;
  onClose: () => void;
  onConfirmed: (prepared: PreparedScriptView, card: FeatureCard) => void;
}

export function RunPrepareModal({ card, onClose, onConfirmed }: RunPrepareProps) {
  const toast = useToast();
  const [phase, setPhase] = useState<'preparing' | 'ready' | 'error'>('preparing');
  const [prepared, setPrepared] = useState<PreparedScriptView | null>(null);
  const [failure, setFailure] = useState<{ message: string; detail?: string } | null>(null);
  const [showFullContent, setShowFullContent] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    // Préparation au montage : téléchargement + vérification SHA-256 réels.
    // Le garde empêche un double lancement (StrictMode) — le jeton est à usage unique.
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      const response = await api!.scripts.prepare(card);
      if (response.ok) {
        setPrepared(response.prepared);
        setPhase('ready');
      } else {
        setFailure({ message: response.message, detail: response.detail });
        setPhase('error');
        if (response.stage === 'integrity') {
          toast.push('error', 'Intégrité du script non vérifiée : exécution refusée.', 9000);
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const riskNote =
    card.riskLevel === 'high'
      ? 'Ce script est classé à risque élevé. Ne continuez que si vous comprenez exactement ses effets.'
      : card.riskLevel === 'medium'
        ? 'Ce script est classé à risque modéré : il peut modifier des fichiers ou accéder au réseau.'
        : null;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Préparer : ${card.name}`}
      subtitle={prepared ? `Vérifié · ${prepared.runtime.label}${prepared.runtime.version ? ` ${prepared.runtime.version}` : ''}` : 'Téléchargement et vérification d’intégrité en cours…'}
      icon={<div className="tl-card-icon" style={{ width: 44, height: 44 }}><IconTerminal size={22} /></div>}
      footer={
        phase === 'ready' && prepared ? (
          <>
            <Button variant="ghost" onClick={onClose}>Annuler</Button>
            <Button
              variant={card.riskLevel === 'high' ? 'danger' : 'primary'}
              icon={<IconPlay size={14} />}
              onClick={() => onConfirmed(prepared, card)}
            >
              J’ai compris, exécuter ce script
            </Button>
          </>
        ) : phase === 'error' ? (
          <Button variant="secondary" onClick={onClose}>Fermer</Button>
        ) : null
      }
    >
      {phase === 'preparing' && (
        <div className="tl-col" style={{ alignItems: 'center', padding: '32px 0', gap: 14 }}>
          <span className="tl-spinner" style={{ width: 28, height: 28 }} />
          <p className="tl-muted">Téléchargement du script depuis son origine officielle et vérification de l’empreinte SHA-256…</p>
          <p className="tl-faint tl-mono">{card.script?.url}</p>
        </div>
      )}

      {phase === 'error' && failure && (
        <div className="tl-col" style={{ padding: '8px 0' }}>
          <div className="tl-row" style={{ gap: 10, color: 'var(--tl-danger)' }}>
            <IconAlert size={20} />
            <b>Le script ne peut pas être exécuté.</b>
          </div>
          <p className="tl-muted">{failure.message}</p>
          {failure.detail && <pre className="tl-gate-error-detail">{failure.detail}</pre>}
        </div>
      )}

      {phase === 'ready' && prepared && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
          <div className="tl-poll-mode-note" style={{ marginBottom: 14, borderColor: 'rgba(52,211,153,0.4)' }}>
            <b style={{ color: 'var(--tl-success)' }}>Intégrité vérifiée.</b>{' '}
            Empreinte SHA-256 conforme au manifeste publié : <span className="tl-mono">{prepared.sha256}</span>
          </div>

          <dl className="tl-kv" style={{ marginBottom: 14 }}>
            <dt>Objectif</dt><dd>{card.description}</dd>
            <dt>Version</dt><dd>{card.version ?? '—'}</dd>
            <dt>Origine</dt><dd className="tl-mono" style={{ wordBreak: 'break-all' }}>{card.script?.url}</dd>
            <dt>Systèmes</dt><dd>{card.platforms.join(', ')}</dd>
            {card.requirements.length > 0 && (<><dt>Prérequis</dt><dd>{card.requirements.join(' · ')}</dd></>)}
            {card.permissions.length > 0 && (<><dt>Permissions</dt><dd>{card.permissions.join(' · ')}</dd></>)}
            {card.capabilities.length > 0 && (<><dt>Opérations principales</dt><dd><ul style={{ paddingLeft: 18 }}>{card.capabilities.map((c) => <li key={c}>{c}</li>)}</ul></dd></>)}
            {card.knownRisks.length > 0 && (
              <>
                <dt>Risques connus</dt>
                <dd><ul style={{ paddingLeft: 18, color: '#fca5a5' }}>{card.knownRisks.map((r) => <li key={r}>{r}</li>)}</ul></dd>
              </>
            )}
          </dl>

          {prepared.requiresAdmin && (
            <div className="tl-poll-mode-note" style={{ marginBottom: 14, borderColor: 'rgba(251,191,36,0.45)' }}>
              <IconAlert size={14} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--tl-warning)' }} />
              Ce script déclare avoir besoin de privilèges administrateur. Teralynk n’élève JAMAIS les privilèges
              automatiquement : sans élévation, certaines opérations peuvent échouer.
            </div>
          )}
          {riskNote && (
            <div className="tl-poll-mode-note" style={{ marginBottom: 14, borderColor: 'rgba(248,113,113,0.4)' }}>
              <IconAlert size={14} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--tl-danger)' }} />
              {riskNote}
            </div>
          )}

          <div className="tl-section-head" style={{ marginBottom: 8 }}>
            <b style={{ fontSize: 'var(--tl-text-sm)' }}>Contenu du script {prepared.contentTruncated && !showFullContent && '(extrait — 64 Ko)'}</b>
            {prepared.contentTruncated && (
              <Button variant="ghost" size="sm" onClick={() => setShowFullContent((v) => !v)}>
                {showFullContent ? 'Réduire' : 'Voir plus'}
              </Button>
            )}
          </div>
          <pre className="tl-code tl-selectable" style={{ maxHeight: showFullContent ? 420 : 220 }}>
            {showFullContent ? prepared.contentPreview : prepared.contentPreview.slice(0, 8000)}
          </pre>
        </motion.div>
      )}
    </Modal>
  );
}
