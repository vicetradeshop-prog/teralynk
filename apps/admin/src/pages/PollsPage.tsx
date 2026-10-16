/**
 * Page Sondages (admin) — création, publication, fermeture, archivage.
 *
 * Mode centralisé (`github`) : à la publication, le panel crée une issue par
 * option (via l'API GitHub) et enregistre les numéros d'issues dans le
 * sondage publié. Les votes des utilisateurs sont des réactions +1 publiques ;
 * l'application lit les compteurs réels — le panel n'affiche que ce qui est
 * réellement accessible.
 *
 * Mode `local` : rien n'est créé sur GitHub ; l'application indique
 * explicitement que le vote n'est pas centralisé.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  pollSchema,
  pollsManifestSchema,
  isPollParticipable,
  pollWindowState,
  type Poll,
  type PollsManifest
} from '@teralynk/shared';
import { Badge, Button, EmptyState, Modal } from '@/components/ui';
import { IconAlert, IconExternal, IconPoll, IconRefresh, IconTrash } from '@/components/Icons';
import { adminApi } from '@/lib/api';
import { useToast } from '@/components/Toasts';

function emptyPoll(): Poll {
  const now = new Date();
  const start = new Date(now.getTime() + 3600_000);
  const end = new Date(now.getTime() + 14 * 86400_000);
  return pollSchema.parse({
    id: `poll-${now.getTime().toString(36)}`,
    title: '',
    description: '',
    options: [
      { id: 'opt-1', label: '' },
      { id: 'opt-2', label: '' }
    ],
    mode: 'github',
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    status: 'draft',
    createdAt: now.toISOString()
  });
}

export function AdminPollsPage() {
  const toast = useToast();
  const [manifest, setManifest] = useState<PollsManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [editing, setEditing] = useState<Poll | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Poll | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const result = await adminApi!.content.read('polls');
    setLoading(false);
    if (!result.ok) {
      setLoadError(result.message ?? 'Lecture impossible.');
      return;
    }
    if (!result.exists || !result.content) {
      setManifest({ schemaVersion: 1, generatedAt: new Date().toISOString(), polls: [] });
      return;
    }
    const parsed = pollsManifestSchema.safeParse(result.content);
    if (!parsed.success) {
      setLoadError(`Sondages publiés invalides : ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      return;
    }
    setManifest(parsed.data);
    setDirty(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const polls = manifest?.polls ?? [];

  const save = (poll: Poll) => {
    if (!manifest) return;
    const validated = pollSchema.safeParse(poll);
    if (!validated.success) {
      toast.push('error', `Sondage invalide : ${validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, 9000);
      return;
    }
    const exists = manifest.polls.some((p) => p.id === validated.data.id);
    setManifest({
      ...manifest,
      polls: exists ? manifest.polls.map((p) => (p.id === validated.data.id ? validated.data : p)) : [validated.data, ...manifest.polls]
    });
    setDirty(true);
    setEditing(null);
    toast.push('success', exists ? 'Sondage modifié (brouillon local).' : 'Sondage créé (brouillon local).');
  };

  /** Publication : crée d'abord les issues des sondages github sans issueNumber. */
  const publish = async () => {
    if (!manifest) return;
    setPublishing(true);
    try {
      let nextPolls = manifest.polls;
      for (const poll of nextPolls) {
        if (poll.mode !== 'github' || poll.status === 'draft') continue;
        const needsIssues = poll.options.some((o) => o.issueNumber === undefined);
        if (!needsIssues) continue;
        toast.push('info', `Création des issues GitHub du sondage « ${poll.title} »…`, 4000);
        const result = await adminApi!.polls.createIssues(poll);
        if (!result.ok || !result.poll) {
          toast.push('error', `Issues impossibles à créer : ${result.message ?? 'erreur inconnue'} — publication abandonnée (aucun contenu modifié).`, 12000);
          setPublishing(false);
          return;
        }
        nextPolls = nextPolls.map((p) => (p.id === poll.id ? (result.poll as Poll) : p));
      }
      setManifest({ ...manifest, polls: nextPolls });

      const result = await adminApi!.content.publish(
        'polls',
        { ...manifest, polls: nextPolls, generatedAt: new Date().toISOString() },
        `sondages: publication (${nextPolls.length} sondage(s))`
      );
      if (result.ok) {
        toast.push('success', `Sondages publiés et signés (${result.path}).`);
        setDirty(false);
        await load();
      } else {
        toast.push('error', `${result.message}${result.hint ? ` — ${result.hint}` : ''}`, 12000);
      }
    } finally {
      setPublishing(false);
    }
  };

  const setStatus = (poll: Poll, status: Poll['status']) => {
    if (!manifest) return;
    setManifest({ ...manifest, polls: manifest.polls.map((p) => (p.id === poll.id ? { ...p, status } : p)) });
    setDirty(true);
    toast.push('info', `Sondage « ${poll.title} » → ${status}. Publiez pour appliquer.`);
  };

  const remove = (poll: Poll) => {
    if (!manifest) return;
    setManifest({ ...manifest, polls: manifest.polls.filter((p) => p.id !== poll.id) });
    setDirty(true);
    setConfirmDelete(null);
    toast.push('info', 'Sondage retiré du brouillon. Les issues GitHub associées restent consultables (archive des votes).');
  };

  return (
    <>
      <div className="tl-page-head tl-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h1 className="tl-page-title">Sondages</h1>
          <p className="tl-page-sub">
            {loading ? 'Chargement…' : `${polls.length} sondage(s) · ${polls.filter((p) => isPollParticipable(p)).length} ouvert(s)`}
            {dirty && <span style={{ color: 'var(--tl-warning)' }}> · modifications locales non publiées</span>}
          </p>
        </div>
        <div className="tl-row" style={{ gap: 8 }}>
          <Button variant="ghost" size="sm" icon={<IconRefresh size={14} />} onClick={load} disabled={loading}>Actualiser</Button>
          <Button variant="secondary" size="sm" onClick={() => setEditing(emptyPoll())}>Nouveau sondage</Button>
          <Button variant="primary" size="sm" disabled={!dirty || publishing} loading={publishing} onClick={publish}>Publier sur GitHub</Button>
        </div>
      </div>

      {loadError && (
        <div className="tl-poll-mode-note" style={{ borderColor: 'rgba(248,113,113,0.45)', marginBottom: 16 }}>
          <IconAlert size={14} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--tl-danger)' }} /> {loadError}
        </div>
      )}

      {!loading && polls.length === 0 && !loadError && (
        <EmptyState
          icon={<IconPoll size={30} />}
          title="Aucun sondage"
          message="Créez un sondage : en mode centralisé, chaque option recevra une issue GitHub dédiée dont les réactions +1 constituent les votes réels."
          action={<Button variant="primary" onClick={() => setEditing(emptyPoll())}>Créer un sondage</Button>}
        />
      )}

      <div className="tl-col">
        {polls.map((poll) => {
          const windowState = pollWindowState(poll);
          return (
            <div key={poll.id} className="tl-poll-card">
              <div className="tl-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <h2 style={{ fontSize: 'var(--tl-text-md)', fontWeight: 640, flex: 1, minWidth: 200 }}>{poll.title || '(sans titre)'}</h2>
                <Badge kind={poll.status === 'open' && windowState === 'open' ? 'available' : poll.status === 'draft' ? 'unavailable' : 'soon'}>
                  {poll.status === 'draft' ? 'Brouillon' : poll.status === 'open' ? (windowState === 'open' ? 'Ouvert' : windowState === 'scheduled' ? 'Programmé' : 'Fenêtre dépassée') : poll.status === 'closed' ? 'Fermé' : 'Archivé'}
                </Badge>
                <Badge kind={poll.mode === 'github' ? 'new' : 'neutral'}>{poll.mode === 'github' ? 'Centralisé (GitHub)' : 'Local uniquement'}</Badge>
              </div>
              {poll.description && <p className="tl-muted" style={{ fontSize: 'var(--tl-text-sm)' }}>{poll.description}</p>}
              <ul className="tl-muted" style={{ paddingLeft: 20, fontSize: 'var(--tl-text-sm)' }}>
                {poll.options.map((option) => (
                  <li key={option.id}>
                    {option.label || '(sans libellé)'}
                    {option.issueNumber && (
                      <button className="tl-btn tl-btn-icon" style={{ padding: 2, marginLeft: 6 }} aria-label="Voir l’issue"
                        onClick={() => void adminApi!.system.openExternal(`https://github.com/issues/${option.issueNumber}`)}>
                        <IconExternal size={12} /> #{option.issueNumber}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              <p className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)' }}>
                Du {new Date(poll.startsAt).toLocaleString('fr-FR')} au {new Date(poll.endsAt).toLocaleString('fr-FR')}
              </p>
              <div className="tl-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <Button variant="ghost" size="sm" onClick={() => setEditing(poll)}>Modifier</Button>
                {poll.status === 'draft' && <Button variant="secondary" size="sm" onClick={() => setStatus(poll, 'open')}>Ouvrir</Button>}
                {poll.status === 'open' && <Button variant="secondary" size="sm" onClick={() => setStatus(poll, 'closed')}>Fermer</Button>}
                {(poll.status === 'closed') && <Button variant="ghost" size="sm" onClick={() => setStatus(poll, 'archived')}>Archiver</Button>}
                <Button variant="danger" size="sm" icon={<IconTrash size={13} />} onClick={() => setConfirmDelete(poll)} aria-label="Supprimer" />
              </div>
            </div>
          );
        })}
      </div>

      {editing && <PollEditor poll={editing} onCancel={() => setEditing(null)} onSave={save} />}

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        small
        title="Supprimer ce sondage ?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Annuler</Button>
            <Button variant="danger" onClick={() => confirmDelete && remove(confirmDelete)}>Supprimer</Button>
          </>
        }
      >
        <p className="tl-muted">
          Le sondage sera retiré du brouillon local (publication requise pour le retirer des applications).
          Les issues GitHub des options ne sont pas supprimées : elles conservent l’historique public des votes.
        </p>
      </Modal>
    </>
  );
}

function PollEditor({ poll, onCancel, onSave }: { poll: Poll; onCancel: () => void; onSave: (p: Poll) => void }) {
  const [draft, setDraft] = useState<Poll>(poll);
  const validation = pollSchema.safeParse(draft);

  const set = <K extends keyof Poll>(key: K, value: Poll[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const updateOption = (index: number, patch: Partial<Poll['options'][number]>) => {
    setDraft((d) => ({ ...d, options: d.options.map((o, i) => (i === index ? { ...o, ...patch } : o)) }));
  };

  return (
    <Modal
      open
      onClose={onCancel}
      title={poll.title ? `Modifier : ${poll.title}` : 'Nouveau sondage'}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Annuler</Button>
          <Button variant="primary" disabled={!validation.success} onClick={() => validation.success && onSave(validation.data)}>
            Enregistrer le brouillon
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="tl-field full">
          <label className="tl-label">Titre *</label>
          <input className="tl-input" value={draft.title} onChange={(e) => set('title', e.target.value)} placeholder="Quelle fonctionnalité souhaitez-vous voir arriver ?" />
        </div>
        <div className="tl-field full">
          <label className="tl-label">Description</label>
          <textarea className="tl-textarea" rows={2} value={draft.description} onChange={(e) => set('description', e.target.value)} />
        </div>
        <div className="tl-field">
          <label className="tl-label">Mode de participation *</label>
          <select className="tl-select" value={draft.mode} onChange={(e) => set('mode', e.target.value as Poll['mode'])}>
            <option value="github">Centralisé via GitHub (issues + réactions)</option>
            <option value="local">Local uniquement (non centralisé, affiché comme tel)</option>
          </select>
          <span className="tl-hint">
            {draft.mode === 'github'
              ? 'À la publication, une issue sera créée par option. Voter = réaction +1 publique (jeton GitHub de l’utilisateur requis). Résultats réels et vérifiables.'
              : 'Le vote reste sur l’ordinateur de l’utilisateur. L’application indique explicitement qu’aucun résultat global n’existe.'}
          </span>
        </div>
        <div className="tl-field">
          <label className="tl-label">Statut</label>
          <select className="tl-select" value={draft.status} onChange={(e) => set('status', e.target.value as Poll['status'])}>
            <option value="draft">Brouillon</option>
            <option value="open">Ouvert</option>
            <option value="closed">Fermé</option>
            <option value="archived">Archivé</option>
          </select>
        </div>
        <div className="tl-field">
          <label className="tl-label">Début *</label>
          <input className="tl-input" type="datetime-local" value={draft.startsAt.slice(0, 16)} onChange={(e) => set('startsAt', new Date(e.target.value).toISOString())} />
        </div>
        <div className="tl-field">
          <label className="tl-label">Fin *</label>
          <input className="tl-input" type="datetime-local" value={draft.endsAt.slice(0, 16)} onChange={(e) => set('endsAt', new Date(e.target.value).toISOString())} />
        </div>
      </div>

      <div className="tl-divider" />
      <b style={{ fontSize: 'var(--tl-text-sm)' }}>Options ({draft.options.length}/8)</b>
      <div className="tl-col" style={{ marginTop: 10, gap: 8 }}>
        {draft.options.map((option, index) => (
          <div key={option.id} className="tl-row" style={{ gap: 8 }}>
            <input
              className="tl-input"
              style={{ flex: 1 }}
              value={option.label}
              placeholder={`Option ${index + 1}`}
              onChange={(e) => updateOption(index, { label: e.target.value })}
            />
            {option.issueNumber && <Badge kind="info">issue #{option.issueNumber}</Badge>}
            {draft.options.length > 2 && (
              <Button variant="ghost" size="sm" icon={<IconTrash size={13} />} aria-label="Retirer l’option"
                onClick={() => setDraft((d) => ({ ...d, options: d.options.filter((_, i) => i !== index) }))} />
            )}
          </div>
        ))}
        {draft.options.length < 8 && (
          <Button variant="ghost" size="sm" onClick={() => setDraft((d) => ({ ...d, options: [...d.options, { id: `opt-${d.options.length + 1}-${Date.now().toString(36)}`, label: '' }] }))}>
            + Ajouter une option
          </Button>
        )}
      </div>

      {!validation.success && (
        <div className="tl-poll-mode-note" style={{ borderColor: 'rgba(251,191,36,0.45)', marginTop: 12 }}>
          <IconAlert size={14} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--tl-warning)' }} />
          {validation.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · ')}
        </div>
      )}
    </Modal>
  );
}
