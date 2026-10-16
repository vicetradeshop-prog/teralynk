/**
 * Page Journaux (admin) — historique local des opérations administratives.
 * Les secrets n'y apparaissent jamais (assainissement à l'écriture).
 */
import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Badge, Button, EmptyState, Modal } from '@/components/ui';
import { IconCheck, IconRefresh, IconTrash, IconX } from '@/components/Icons';
import { adminApi, type AdminLogEntryView } from '@/lib/api';

const STATUS_LABELS: Record<string, string> = {
  pending: 'En attente',
  running: 'En cours',
  success: 'Réussie',
  failed: 'Échouée'
};

export function LogsPage() {
  const [logs, setLogs] = useState<AdminLogEntryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmClear, setConfirmClear] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLogs(await adminApi!.logs.get());
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="tl-page-head tl-row" style={{ justifyContent: 'space-between' }}>
        <div>
          <h1 className="tl-page-title">Journaux</h1>
          <p className="tl-page-sub">
            {logs.length} opération(s) enregistrée(s) localement · jetons et secrets assainis à l’écriture · jamais transmis.
          </p>
        </div>
        <div className="tl-row" style={{ gap: 8 }}>
          <Button variant="ghost" size="sm" icon={<IconRefresh size={14} />} loading={loading} onClick={load}>Actualiser</Button>
          {logs.length > 0 && <Button variant="danger" size="sm" icon={<IconTrash size={13} />} onClick={() => setConfirmClear(true)}>Vider</Button>}
        </div>
      </div>

      {logs.length === 0 && !loading ? (
        <EmptyState icon={<IconCheck size={30} />} title="Aucune opération" message="Les validations de jeton, publications de contenu et releases apparaîtront ici." />
      ) : (
        <div className="tl-col" style={{ gap: 6 }}>
          {logs.map((entry, index) => (
            <motion.div
              key={`${entry.at}-${index}`}
              className="tl-history-item"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.18, delay: Math.min(index * 0.015, 0.25) }}
            >
              <Badge kind={entry.status === 'success' ? 'available' : entry.status === 'failed' ? 'critical' : 'soon'}>
                {STATUS_LABELS[entry.status]}
              </Badge>
              <span style={{ flex: 1, minWidth: 0 }}>
                {entry.action}
                {entry.detail && <span className="tl-faint"> · {entry.detail}</span>}
              </span>
              <time>{new Date(entry.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'medium' })}</time>
            </motion.div>
          ))}
        </div>
      )}

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        small
        title="Vider les journaux locaux ?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClear(false)}>Annuler</Button>
            <Button
              variant="danger"
              onClick={async () => {
                await adminApi!.logs.clear();
                setConfirmClear(false);
                await load();
              }}
            >
              Vider
            </Button>
          </>
        }
      >
        <p className="tl-muted">
          <IconX size={14} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--tl-danger)' }} />
          L’historique local des opérations administratives sera définitivement supprimé de cet ordinateur.
          Les publications déjà effectuées sur GitHub ne sont pas affectées.
        </p>
      </Modal>
    </>
  );
}
