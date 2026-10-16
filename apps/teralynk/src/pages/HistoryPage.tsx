/**
 * Page Historique — actions locales (exécutions, votes, consultations).
 * Conservation paramétrable ; aucune donnée ne quitte l'ordinateur.
 */
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { Badge, Button, EmptyState } from '@/components/ui';
import { IconHistory, IconTrash } from '@/components/Icons';
import type { PrefsView } from '@/lib/api';

const TYPE_LABELS: Record<string, { label: string; kind: string }> = {
  'script-run': { label: 'Script exécuté', kind: 'available' },
  'script-cancelled': { label: 'Script arrêté', kind: 'soon' },
  'script-failed': { label: 'Échec d’exécution', kind: 'critical' },
  'card-viewed': { label: 'Carte consultée', kind: 'neutral' },
  'poll-voted': { label: 'Vote enregistré', kind: 'info' },
  'update-check': { label: 'Contrôle de mise à jour', kind: 'neutral' }
};

interface Props {
  prefs: PrefsView | null;
  cardNames: Map<string, string>;
  onClear: () => void;
}

export function HistoryPage({ prefs, cardNames, onClear }: Props) {
  const history = useMemo(() => (prefs?.history ?? []).slice(0, 300), [prefs]);

  return (
    <>
      <div className="tl-page-head tl-row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1 className="tl-page-title">Historique</h1>
          <p className="tl-page-sub">
            Actions effectuées sur cet ordinateur · conservation {prefs?.historyRetentionDays ?? 90} jours ·
            strictement local, jamais transmis.
          </p>
        </div>
        {history.length > 0 && (
          <Button variant="danger" size="sm" icon={<IconTrash size={14} />} onClick={onClear}>
            Vider l’historique
          </Button>
        )}
      </div>

      {history.length === 0 ? (
        <EmptyState
          icon={<IconHistory size={30} />}
          title="Historique vide"
          message="Les exécutions de scripts, votes et consultations apparaîtront ici. Ces informations restent sur votre ordinateur."
        />
      ) : (
        <div className="tl-col" style={{ gap: 8 }}>
          {history.map((entry, index) => {
            const meta = TYPE_LABELS[entry.type] ?? { label: entry.type, kind: 'neutral' };
            return (
              <motion.div
                key={entry.id}
                className="tl-history-item"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, delay: Math.min(index * 0.02, 0.3) }}
              >
                <Badge kind={meta.kind}>{meta.label}</Badge>
                <span>
                  {entry.cardId ? (cardNames.get(entry.cardId) ?? entry.cardId) : entry.pollId ? `Sondage ${entry.pollId}` : ''}
                  {entry.detail && <span className="tl-faint"> · {entry.detail}</span>}
                  {entry.exitCode !== undefined && entry.exitCode !== null && entry.type === 'script-run' && (
                    <span className="tl-faint"> · code {entry.exitCode}</span>
                  )}
                </span>
                <time dateTime={entry.at}>{new Date(entry.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}</time>
              </motion.div>
            );
          })}
        </div>
      )}
    </>
  );
}
