/**
 * Page Annonces (admin) — création, modification, suppression et publication
 * des annonces sur GitHub. Les annonces retirées disparaissent du fichier
 * publié : l'application ne les affiche plus (le cache est écrasé à chaque
 * récupération réseau réussie).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  announcementSchema,
  announcementsManifestSchema,
  type Announcement,
  type AnnouncementsManifest
} from '@teralynk/shared';
import { Badge, Button, EmptyState, Modal } from '@/components/ui';
import { IconAlert, IconMegaphone, IconRefresh, IconTrash } from '@/components/Icons';
import { adminApi } from '@/lib/api';
import { useToast } from '@/components/Toasts';

const CATEGORY_LABELS: Record<string, string> = {
  general: 'Information générale',
  release: 'Nouvelle version',
  feature: 'Nouvelle fonctionnalité',
  update: 'Mise à jour importante',
  maintenance: 'Maintenance',
  alert: 'Alerte',
  catalog: 'Changement du catalogue',
  upcoming: 'Fonctionnalité à venir'
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Basse',
  normal: 'Normale',
  high: 'Haute (bannière accueil)',
  critical: 'Critique (bannière rouge)'
};

function emptyAnnouncement(): Announcement {
  return announcementSchema.parse({
    id: `a-${Date.now().toString(36)}`,
    title: '',
    summary: '',
    body: '',
    category: 'general',
    priority: 'normal',
    publishedAt: new Date().toISOString()
  });
}

export function AdminAnnouncementsPage() {
  const toast = useToast();
  const [manifest, setManifest] = useState<AnnouncementsManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Announcement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const result = await adminApi!.content.read('announcements');
    setLoading(false);
    if (!result.ok) {
      setLoadError(result.message ?? 'Lecture impossible.');
      return;
    }
    if (!result.exists || !result.content) {
      setManifest({ schemaVersion: 1, generatedAt: new Date().toISOString(), announcements: [] });
      return;
    }
    const parsed = announcementsManifestSchema.safeParse(result.content);
    if (!parsed.success) {
      setLoadError(`Annonces publiées invalides : ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      return;
    }
    setManifest(parsed.data);
    setDirty(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const announcements = manifest?.announcements ?? [];

  const save = (announcement: Announcement) => {
    if (!manifest) return;
    const validated = announcementSchema.safeParse(announcement);
    if (!validated.success) {
      toast.push('error', `Annonce invalide : ${validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, 9000);
      return;
    }
    const exists = manifest.announcements.some((a) => a.id === validated.data.id);
    setManifest({
      ...manifest,
      announcements: exists
        ? manifest.announcements.map((a) => (a.id === validated.data.id ? validated.data : a))
        : [validated.data, ...manifest.announcements]
    });
    setDirty(true);
    setEditing(null);
    toast.push('success', exists ? 'Annonce modifiée (brouillon local).' : 'Annonce créée (brouillon local).');
  };

  const remove = (announcement: Announcement) => {
    if (!manifest) return;
    setManifest({ ...manifest, announcements: manifest.announcements.filter((a) => a.id !== announcement.id) });
    setDirty(true);
    setConfirmDelete(null);
    toast.push('info', 'Annonce retirée du brouillon — disparaîtra des applications après publication.');
  };

  const publish = async () => {
    if (!manifest) return;
    setPublishing(true);
    const result = await adminApi!.content.publish(
      'announcements',
      { ...manifest, generatedAt: new Date().toISOString() },
      `annonces: publication (${manifest.announcements.length} annonce(s))`
    );
    setPublishing(false);
    if (result.ok) {
      toast.push('success', `Annonces publiées et signées (${result.path}).`);
      setDirty(false);
      await load();
    } else {
      toast.push('error', `${result.message}${result.hint ? ` — ${result.hint}` : ''}`, 12000);
    }
  };

  return (
    <>
      <div className="tl-page-head tl-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h1 className="tl-page-title">Annonces</h1>
          <p className="tl-page-sub">
            {loading ? 'Chargement…' : `${announcements.length} annonce(s) publiée(s) dans le fichier distant`}
            {dirty && <span style={{ color: 'var(--tl-warning)' }}> · modifications locales non publiées</span>}
          </p>
        </div>
        <div className="tl-row" style={{ gap: 8 }}>
          <Button variant="ghost" size="sm" icon={<IconRefresh size={14} />} onClick={load} disabled={loading}>Actualiser</Button>
          <Button variant="secondary" size="sm" onClick={() => setEditing(emptyAnnouncement())}>Nouvelle annonce</Button>
          <Button variant="primary" size="sm" disabled={!dirty || publishing} loading={publishing} onClick={publish}>Publier sur GitHub</Button>
        </div>
      </div>

      {loadError && (
        <div className="tl-poll-mode-note" style={{ borderColor: 'rgba(248,113,113,0.45)', marginBottom: 16 }}>
          <IconAlert size={14} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--tl-danger)' }} /> {loadError}
        </div>
      )}

      {!loading && announcements.length === 0 && !loadError && (
        <EmptyState icon={<IconMegaphone size={30} />} title="Aucune annonce" message="Créez votre première annonce : elle apparaîtra dans l'application dès la publication." action={<Button variant="primary" onClick={() => setEditing(emptyAnnouncement())}>Créer une annonce</Button>} />
      )}

      <div className="tl-col">
        {announcements.map((announcement) => {
          const expired = announcement.expiresAt && new Date(announcement.expiresAt).getTime() < Date.now();
          return (
            <div key={announcement.id} className="tl-announcement-card" style={{ cursor: 'default' }}>
              <div className="tl-announcement-head">
                <Badge kind={announcement.priority === 'critical' ? 'critical' : announcement.priority === 'high' ? 'soon' : 'info'}>
                  {CATEGORY_LABELS[announcement.category] ?? announcement.category}
                </Badge>
                {!announcement.published && <Badge kind="unavailable">Brouillon (non visible)</Badge>}
                {expired && <Badge kind="unavailable">Expirée</Badge>}
                <span className="tl-announcement-title">{announcement.title}</span>
                <span style={{ marginLeft: 'auto' }} className="tl-row">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(announcement)}>Modifier</Button>
                  <Button variant="danger" size="sm" icon={<IconTrash size={13} />} onClick={() => setConfirmDelete(announcement)} aria-label="Supprimer" />
                </span>
              </div>
              <p className="tl-announcement-summary">{announcement.summary}</p>
              <span className="tl-announcement-meta">
                Publiée le {new Date(announcement.publishedAt).toLocaleString('fr-FR')}
                {announcement.expiresAt ? ` · expire le ${new Date(announcement.expiresAt).toLocaleDateString('fr-FR')}` : ''}
                {announcement.link ? ' · lien associé' : ''}
              </span>
            </div>
          );
        })}
      </div>

      {editing && <AnnouncementEditor announcement={editing} onCancel={() => setEditing(null)} onSave={save} />}

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        small
        title="Supprimer cette annonce ?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Annuler</Button>
            <Button variant="danger" onClick={() => confirmDelete && remove(confirmDelete)}>Supprimer</Button>
          </>
        }
      >
        <p className="tl-muted">
          L’annonce sera retirée du brouillon local. Après publication, elle disparaîtra définitivement
          des applications (le cache utilisateur est écrasé à chaque récupération réussie — aucun affichage fantôme).
        </p>
      </Modal>
    </>
  );
}

function AnnouncementEditor({ announcement, onCancel, onSave }: { announcement: Announcement; onCancel: () => void; onSave: (a: Announcement) => void }) {
  const [draft, setDraft] = useState<Announcement>(announcement);
  const validation = announcementSchema.safeParse(draft);

  const set = <K extends keyof Announcement>(key: K, value: Announcement[K]) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <Modal
      open
      onClose={onCancel}
      title={announcement.title ? `Modifier : ${announcement.title}` : 'Nouvelle annonce'}
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
          <input className="tl-input" value={draft.title} onChange={(e) => set('title', e.target.value)} />
        </div>
        <div className="tl-field full">
          <label className="tl-label">Résumé * (max 400 caractères, affiché dans les listes)</label>
          <textarea className="tl-textarea" rows={2} value={draft.summary} onChange={(e) => set('summary', e.target.value)} />
        </div>
        <div className="tl-field full">
          <label className="tl-label">Contenu complet * (texte, affiché dans la fenêtre de lecture)</label>
          <textarea className="tl-textarea" rows={8} value={draft.body} onChange={(e) => set('body', e.target.value)} />
        </div>
        <div className="tl-field">
          <label className="tl-label">Catégorie</label>
          <select className="tl-select" value={draft.category} onChange={(e) => set('category', e.target.value as Announcement['category'])}>
            {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="tl-field">
          <label className="tl-label">Priorité</label>
          <select className="tl-select" value={draft.priority} onChange={(e) => set('priority', e.target.value as Announcement['priority'])}>
            {Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="tl-field">
          <label className="tl-label">Date de publication</label>
          <input className="tl-input" type="datetime-local"
            value={draft.publishedAt.slice(0, 16)}
            onChange={(e) => set('publishedAt', new Date(e.target.value).toISOString())} />
        </div>
        <div className="tl-field">
          <label className="tl-label">Date d’expiration (optionnelle)</label>
          <input className="tl-input" type="datetime-local"
            value={draft.expiresAt ? draft.expiresAt.slice(0, 16) : ''}
            onChange={(e) => set('expiresAt', e.target.value ? new Date(e.target.value).toISOString() : undefined)} />
        </div>
        <div className="tl-field full">
          <label className="tl-label">Illustration (URL https d’un hôte GitHub autorisé, optionnelle)</label>
          <input className="tl-input tl-mono" value={draft.illustration ?? ''} onChange={(e) => set('illustration', e.target.value || undefined)} />
        </div>
        <div className="tl-field full">
          <label className="tl-label">Lien associé (URL https d’un hôte GitHub autorisé, optionnel)</label>
          <input className="tl-input tl-mono" value={draft.link ?? ''} onChange={(e) => set('link', e.target.value || undefined)} />
        </div>
        <div className="tl-field full">
          <label className="tl-row" style={{ gap: 8 }}>
            <input type="checkbox" checked={draft.published} onChange={(e) => set('published', e.target.checked)} />
            Publiée (visible dans l’application — décocher pour garder en brouillon distant)
          </label>
        </div>
      </div>
      {!validation.success && (
        <div className="tl-poll-mode-note" style={{ borderColor: 'rgba(251,191,36,0.45)', marginTop: 8 }}>
          <IconAlert size={14} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--tl-warning)' }} />
          {validation.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · ')}
        </div>
      )}
    </Modal>
  );
}
