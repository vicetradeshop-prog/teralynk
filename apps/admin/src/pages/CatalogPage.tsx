/**
 * Page Catalogue — création, modification, suppression, duplication et
 * publication des cartes sur GitHub.
 *
 * Chaque carte est éditée via un formulaire complet validé par le schéma zod
 * partagé (le même que celui utilisé par l'application pour lire le catalogue :
 * ce qui est publié ici est exactement ce que l'app peut charger).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  catalogManifestSchema,
  featureCardSchema,
  type CatalogManifest,
  type FeatureCard
} from '@teralynk/shared';
import { Badge, Button, EmptyState, Modal } from '@/components/ui';
import { IconAlert, IconCheck, IconExternal, IconRefresh, IconTrash } from '@/components/Icons';
import { adminApi, type ContentReadResult } from '@/lib/api';
import { useToast } from '@/components/Toasts';

const STATUS_LABELS: Record<string, string> = {
  available: 'Disponible',
  new: 'Nouveauté',
  soon: 'Prochainement',
  experimental: 'Expérimental',
  unavailable: 'Indisponible'
};

const ICON_CHOICES = ['sparkles', 'terminal', 'wrench', 'flask', 'shield', 'globe', 'folder', 'layers', 'clock', 'download', 'star', 'poll'];

function emptyCard(): FeatureCard {
  const now = new Date().toISOString();
  // Objet brut : la validation stricte se fait en direct dans l'éditeur et à
  // l'enregistrement. Un .parse() sur champs vides lèverait une exception et
  // tuerait silencieusement le clic sur « Nouvelle carte ».
  return {
    id: '',
    slug: '',
    name: '',
    description: '',
    category: '',
    icon: 'sparkles',
    tags: [],
    status: 'soon',
    platforms: ['windows'],
    requirements: [],
    permissions: [],
    capabilities: [],
    knownRisks: [],
    riskLevel: 'low',
    featured: false,
    enabled: false,
    createdAt: now,
    updatedAt: now
  } as FeatureCard;
}

/** Convertit un nom en slug/identifiant kebab-case. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 63);
}

interface Props {
  onPublished: () => void;
}

export function CatalogPage({ onPublished }: Props) {
  const toast = useToast();
  const [manifest, setManifest] = useState<CatalogManifest | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [remoteSha, setRemoteSha] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [editing, setEditing] = useState<FeatureCard | null>(null);
  const [editingIsNew, setEditingIsNew] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FeatureCard | null>(null);
  const [confirmPublish, setConfirmPublish] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const result: ContentReadResult = await adminApi!.content.read('catalog');
    setLoading(false);
    if (!result.ok) {
      setLoadError(result.message ?? 'Lecture impossible.');
      return;
    }
    if (!result.exists || !result.content) {
      // Dépôt sans catalogue : état initial vide, honnête.
      setManifest({ schemaVersion: 1, generatedAt: new Date().toISOString(), cards: [] });
      setRemoteSha(result.sha ?? null);
      return;
    }
    const parsed = catalogManifestSchema.safeParse(result.content);
    if (!parsed.success) {
      setLoadError(`Catalogue publié invalide : ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
      return;
    }
    setManifest(parsed.data);
    setRemoteSha(result.sha ?? null);
    setDirty(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cards = manifest?.cards ?? [];

  const saveCard = (card: FeatureCard) => {
    if (!manifest) return;
    const validated = featureCardSchema.safeParse(card);
    if (!validated.success) {
      toast.push('error', `Carte invalide : ${validated.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`, 9000);
      return;
    }
    const nextCard: FeatureCard = { ...validated.data, updatedAt: new Date().toISOString() };
    const exists = manifest.cards.some((c) => c.id === nextCard.id);
    const cardsNext = exists
      ? manifest.cards.map((c) => (c.id === nextCard.id ? nextCard : c))
      : [...manifest.cards, nextCard];
    setManifest({ ...manifest, cards: cardsNext });
    setDirty(true);
    setEditing(null);
    toast.push('success', exists ? `Carte « ${nextCard.name} » modifiée (brouillon local).` : `Carte « ${nextCard.name} » créée (brouillon local).`);
  };

  const deleteCard = (card: FeatureCard) => {
    if (!manifest) return;
    setManifest({ ...manifest, cards: manifest.cards.filter((c) => c.id !== card.id) });
    setDirty(true);
    setConfirmDelete(null);
    toast.push('info', `Carte « ${card.name} » retirée du brouillon local.`);
  };

  const duplicateCard = (card: FeatureCard) => {
    if (!manifest) return;
    const base = slugify(`${card.slug}-copie`) || `${card.id}-copie`;
    let id = base;
    let n = 2;
    while (manifest.cards.some((c) => c.id === id)) id = `${base}-${n++}`;
    const copy: FeatureCard = {
      ...card,
      id,
      slug: id,
      name: `${card.name} (copie)`,
      status: 'soon',
      enabled: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    setManifest({ ...manifest, cards: [...manifest.cards, copy] });
    setDirty(true);
    setEditing(copy);
    setEditingIsNew(true);
    toast.push('info', 'Copie créée — pensez à changer son contenu avant publication.');
  };

  const toggleEnabled = (card: FeatureCard) => {
    if (!manifest) return;
    setManifest({
      ...manifest,
      cards: manifest.cards.map((c) => (c.id === card.id ? { ...c, enabled: !c.enabled, updatedAt: new Date().toISOString() } : c))
    });
    setDirty(true);
  };

  const publish = async () => {
    if (!manifest) return;
    setPublishing(true);
    const result = await adminApi!.content.publish(
      'catalog',
      { ...manifest, generatedAt: new Date().toISOString() },
      `catalog: publication du catalogue (${manifest.cards.length} carte(s))`
    );
    setPublishing(false);
    setConfirmPublish(false);
    if (result.ok) {
      toast.push('success', `Catalogue publié et signé sur GitHub (${result.path}). Les applications le recevront sans recompilation.`);
      setDirty(false);
      onPublished();
      await load();
    } else {
      toast.push('error', `${result.message}${result.hint ? ` — ${result.hint}` : ''}`, 12000);
    }
  };

  const validationSummary = useMemo(() => {
    if (!manifest) return null;
    const issues: string[] = [];
    for (const card of manifest.cards) {
      const parsed = featureCardSchema.safeParse(card);
      if (!parsed.success) issues.push(`${card.id || '(sans id)'} : ${parsed.error.issues[0]?.message}`);
    }
    return issues;
  }, [manifest]);

  return (
    <>
      <div className="tl-page-head tl-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h1 className="tl-page-title">Catalogue</h1>
          <p className="tl-page-sub">
            {loading ? 'Chargement depuis GitHub…' : `${cards.length} carte(s) · ${cards.filter((c) => c.enabled).length} publiée(s) (enabled)`}
            {dirty && <span style={{ color: 'var(--tl-warning)' }}> · modifications locales non publiées</span>}
          </p>
        </div>
        <div className="tl-row" style={{ gap: 8 }}>
          <Button variant="ghost" size="sm" icon={<IconRefresh size={14} />} onClick={load} disabled={loading}>Actualiser</Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setEditing(emptyCard());
              setEditingIsNew(true);
            }}
          >
            Nouvelle carte
          </Button>
          <Button variant="primary" size="sm" disabled={!dirty || publishing || (validationSummary?.length ?? 0) > 0} onClick={() => setConfirmPublish(true)}>
            {publishing ? 'Publication…' : 'Publier sur GitHub'}
          </Button>
        </div>
      </div>

      {loadError && (
        <div className="tl-poll-mode-note" style={{ borderColor: 'rgba(248,113,113,0.45)', marginBottom: 16 }}>
          <IconAlert size={14} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--tl-danger)' }} />
          {loadError}
        </div>
      )}

      {validationSummary && validationSummary.length > 0 && (
        <div className="tl-poll-mode-note" style={{ borderColor: 'rgba(251,191,36,0.45)', marginBottom: 16 }}>
          <IconAlert size={14} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--tl-warning)' }} />
          {validationSummary.length} carte(s) invalide(s) — publication bloquée : {validationSummary.slice(0, 3).join(' · ')}
        </div>
      )}

      {!loading && cards.length === 0 && !loadError && (
        <EmptyState
          icon={<IconExternal size={30} />}
          title="Catalogue vide"
          message="Aucune carte publiée. Créez votre première carte : elle apparaîtra dans l'application dès la publication, sans nouvelle compilation."
          action={<Button variant="primary" onClick={() => { setEditing(emptyCard()); setEditingIsNew(true); }}>Créer une carte</Button>}
        />
      )}

      <div className="tl-glass" style={{ padding: 8, overflowX: 'auto' }}>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Carte</th><th>Catégorie</th><th>Statut</th><th>Runtime</th><th>Version</th><th>Publiée</th><th style={{ textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((card) => (
              <motion.tr key={card.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
                <td>
                  <b>{card.name}</b>
                  {card.featured && <Badge kind="new"> ★</Badge>}
                  <div className="tl-faint tl-mono">{card.id}</div>
                </td>
                <td>{card.category}</td>
                <td><Badge kind={card.status === 'available' ? 'available' : card.status === 'new' ? 'new' : card.status === 'soon' ? 'soon' : card.status === 'experimental' ? 'experimental' : 'unavailable'}>{STATUS_LABELS[card.status]}</Badge></td>
                <td className="tl-mono">{card.script?.runtime ?? '—'}</td>
                <td className="tl-mono">{card.version ?? '—'}</td>
                <td>{card.enabled ? <IconCheck size={15} style={{ color: 'var(--tl-success)' }} /> : <span className="tl-faint">dépubliée</span>}</td>
                <td>
                  <div className="row-actions">
                    <Button variant="ghost" size="sm" onClick={() => toggleEnabled(card)}>{card.enabled ? 'Dépublier' : 'Publier (carte)'}</Button>
                    <Button variant="ghost" size="sm" onClick={() => duplicateCard(card)}>Dupliquer</Button>
                    <Button variant="ghost" size="sm" onClick={() => { setEditing(card); setEditingIsNew(false); }}>Modifier</Button>
                    <Button variant="danger" size="sm" icon={<IconTrash size={13} />} onClick={() => setConfirmDelete(card)} aria-label="Supprimer" />
                  </div>
                </td>
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <CardEditor
          card={editing}
          isNew={editingIsNew}
          existingIds={cards.map((c) => c.id)}
          onCancel={() => setEditing(null)}
          onSave={saveCard}
        />
      )}

      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        small
        title={`Supprimer « ${confirmDelete?.name} » ?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>Annuler</Button>
            <Button variant="danger" icon={<IconTrash size={14} />} onClick={() => confirmDelete && deleteCard(confirmDelete)}>Supprimer la carte</Button>
          </>
        }
      >
        <p className="tl-muted">
          La carte sera retirée du brouillon local. Elle disparaîtra du catalogue des utilisateurs
          uniquement après <b>publication sur GitHub</b>. Cette action est réversible tant que le brouillon n’est pas publié.
        </p>
      </Modal>

      <Modal
        open={confirmPublish}
        onClose={() => setConfirmPublish(false)}
        small
        title="Publier le catalogue sur GitHub ?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmPublish(false)}>Annuler</Button>
            <Button variant="primary" loading={publishing} onClick={publish}>Publier et signer</Button>
          </>
        }
      >
        <p className="tl-muted" style={{ marginBottom: 10 }}>
          Le fichier <span className="tl-mono">content/catalog.json</span> sera committé sur la branche de contenu,
          avec sa signature Ed25519 (<span className="tl-mono">.sig</span>). Toutes les applications Teralynk
          recevront ce catalogue à leur prochaine actualisation — sans recompilation.
        </p>
        <ul className="tl-muted" style={{ paddingLeft: 20, fontSize: 'var(--tl-text-sm)' }}>
          <li>{cards.length} carte(s), dont {cards.filter((c) => c.enabled).length} publiée(s)</li>
          <li>{cards.filter((c) => c.script && c.script.runtime !== 'info').length} carte(s) exécutable(s)</li>
          {remoteSha && <li>Mise à jour du fichier existant (commit sur la version distante actuelle)</li>}
        </ul>
      </Modal>
    </>
  );
}

/* ================================================================== */
/* Éditeur de carte                                                    */
/* ================================================================== */

function CardEditor({
  card,
  isNew,
  existingIds,
  onCancel,
  onSave
}: {
  card: FeatureCard;
  isNew: boolean;
  existingIds: string[];
  onCancel: () => void;
  onSave: (card: FeatureCard) => void;
}) {
  const [draft, setDraft] = useState<FeatureCard>(card);
  const [showScript, setShowScript] = useState(Boolean(card.script));
  const [validationError, setValidationError] = useState<string | null>(null);

  const set = <K extends keyof FeatureCard>(key: K, value: FeatureCard[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const validation = featureCardSchema.safeParse(draft);
  useEffect(() => {
    setValidationError(validation.success ? null : validation.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · '));
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const idConflict = isNew && existingIds.includes(draft.id);

  return (
    <Modal
      open
      onClose={onCancel}
      title={isNew ? 'Nouvelle carte' : `Modifier : ${card.name}`}
      subtitle="Tous les champs sont validés par le schéma partagé avec l'application."
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Annuler</Button>
          <Button
            variant="primary"
            disabled={!validation.success || idConflict}
            onClick={() => {
              const parsed = featureCardSchema.safeParse(draft);
              if (parsed.success) onSave(parsed.data);
            }}
          >
            Enregistrer le brouillon
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <div className="tl-field">
          <label className="tl-label">Nom *</label>
          <input className="tl-input" value={draft.name} onChange={(e) => {
            const name = e.target.value;
            set('name', name);
            if (isNew && !draft.id) {
              const slug = slugify(name);
              setDraft((d) => ({ ...d, name, id: slug, slug }));
            }
          }} />
        </div>
        <div className="tl-field">
          <label className="tl-label">Identifiant (kebab-case) *</label>
          <input className={`tl-input ${idConflict ? 'is-error' : ''}`} value={draft.id} disabled={!isNew}
            onChange={(e) => { const id = slugify(e.target.value); setDraft((d) => ({ ...d, id, slug: id })); }} />
          {idConflict && <span className="tl-error-text">Cet identifiant existe déjà.</span>}
        </div>
        <div className="tl-field full">
          <label className="tl-label">Description courte * (max 500)</label>
          <textarea className="tl-textarea" rows={2} value={draft.description} onChange={(e) => set('description', e.target.value)} />
        </div>
        <div className="tl-field full">
          <label className="tl-label">Description longue (objectif, capacités — optionnelle)</label>
          <textarea className="tl-textarea" rows={4} value={draft.longDescription ?? ''} onChange={(e) => set('longDescription', e.target.value || undefined)} />
        </div>
        <div className="tl-field">
          <label className="tl-label">Catégorie *</label>
          <input className="tl-input" value={draft.category} onChange={(e) => set('category', e.target.value)} placeholder="Productivité, Système, Réseau…" />
        </div>
        <div className="tl-field">
          <label className="tl-label">Icône</label>
          <select className="tl-select" value={typeof draft.icon === 'string' && !draft.icon.startsWith('http') ? draft.icon : 'sparkles'} onChange={(e) => set('icon', e.target.value)}>
            {ICON_CHOICES.map((icon) => <option key={icon} value={icon}>{icon}</option>)}
          </select>
          <span className="tl-hint">Ou URL https d’un hôte GitHub autorisé (champ brut) :</span>
          <input className="tl-input" style={{ marginTop: 4 }} value={typeof draft.icon === 'string' && draft.icon.startsWith('http') ? draft.icon : ''} placeholder="https://raw.githubusercontent.com/…"
            onChange={(e) => set('icon', e.target.value || 'sparkles')} />
        </div>
        <div className="tl-field">
          <label className="tl-label">Statut *</label>
          <select className="tl-select" value={draft.status} onChange={(e) => set('status', e.target.value as FeatureCard['status'])}>
            {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <span className="tl-hint">« Disponible/Nouveauté » exige un script exécutable avec empreinte SHA-256.</span>
        </div>
        <div className="tl-field">
          <label className="tl-label">Niveau de risque</label>
          <select className="tl-select" value={draft.riskLevel} onChange={(e) => set('riskLevel', e.target.value as FeatureCard['riskLevel'])}>
            <option value="low">Faible</option><option value="medium">Modéré</option><option value="high">Élevé</option>
          </select>
        </div>
        <div className="tl-field">
          <label className="tl-label">Version de la fonctionnalité</label>
          <input className="tl-input" value={draft.version ?? ''} placeholder="1.0.0" onChange={(e) => set('version', e.target.value || undefined)} />
        </div>
        <div className="tl-field">
          <label className="tl-label">Raison d’indisponibilité (statut soon/unavailable)</label>
          <input className="tl-input" value={draft.unavailableReason ?? ''} onChange={(e) => set('unavailableReason', e.target.value || undefined)} />
        </div>
        <div className="tl-field full">
          <label className="tl-label">Plateformes *</label>
          <div className="tl-row" style={{ gap: 14 }}>
            {(['windows', 'macos', 'linux'] as const).map((platform) => (
              <label key={platform} className="tl-row" style={{ gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={draft.platforms.includes(platform)}
                  onChange={(e) => set('platforms', e.target.checked ? [...draft.platforms, platform] : draft.platforms.filter((p) => p !== platform))} />
                {platform}
              </label>
            ))}
          </div>
        </div>
        <div className="tl-field full">
          <label className="tl-label">Étiquettes (séparées par des virgules)</label>
          <input className="tl-input" value={draft.tags.join(', ')} onChange={(e) => set('tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))} />
        </div>
        <div className="tl-field full">
          <label className="tl-label">Prérequis (une ligne par prérequis)</label>
          <textarea className="tl-textarea" rows={2} value={draft.requirements.join('\n')} onChange={(e) => set('requirements', e.target.value.split('\n').map((t) => t.trim()).filter(Boolean))} />
        </div>
        <div className="tl-field full">
          <label className="tl-label">Permissions nécessaires (une ligne par permission)</label>
          <textarea className="tl-textarea" rows={2} value={draft.permissions.join('\n')} onChange={(e) => set('permissions', e.target.value.split('\n').map((t) => t.trim()).filter(Boolean))} />
        </div>
        <div className="tl-field full">
          <label className="tl-label">Opérations principales réalisées (une ligne par opération)</label>
          <textarea className="tl-textarea" rows={2} value={draft.capabilities.join('\n')} onChange={(e) => set('capabilities', e.target.value.split('\n').map((t) => t.trim()).filter(Boolean))} />
        </div>
        <div className="tl-field full">
          <label className="tl-label">Risques connus (une ligne par risque)</label>
          <textarea className="tl-textarea" rows={2} value={draft.knownRisks.join('\n')} onChange={(e) => set('knownRisks', e.target.value.split('\n').map((t) => t.trim()).filter(Boolean))} />
        </div>
        <div className="tl-field full">
          <label className="tl-label">Notes de version</label>
          <textarea className="tl-textarea" rows={2} value={draft.releaseNotes ?? ''} onChange={(e) => set('releaseNotes', e.target.value || undefined)} />
        </div>
        <div className="tl-field full">
          <label className="tl-row" style={{ gap: 8 }}>
            <input type="checkbox" checked={draft.featured} onChange={(e) => set('featured', e.target.checked)} />
            Mettre en avant sur l’accueil
          </label>
          <label className="tl-row" style={{ gap: 8, marginTop: 6 }}>
            <input type="checkbox" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} />
            Carte publiée (visible dans l’application)
          </label>
        </div>
      </div>

      <div className="tl-divider" />

      <div className="tl-row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <b>Script exécutable</b>
        <label className="tl-switch">
          <input type="checkbox" checked={showScript} onChange={(e) => {
            setShowScript(e.target.checked);
            if (!e.target.checked) set('script', undefined);
            else if (!draft.script) setDraft((d) => ({ ...d, script: { runtime: 'powershell', url: '', sha256: undefined, args: [], requiresAdmin: false } }));
          }} />
          <span className="tl-switch-track" /><span className="tl-switch-thumb" />
        </label>
      </div>

      {showScript && draft.script && (
        <div className="form-grid">
          <div className="tl-field">
            <label className="tl-label">Runtime *</label>
            <select className="tl-select" value={draft.script.runtime}
              onChange={(e) => set('script', { ...draft.script!, runtime: e.target.value as 'powershell' })}>
              <option value="powershell">PowerShell (Windows)</option>
              <option value="pwsh">PowerShell 7+ (pwsh)</option>
              <option value="python">Python</option>
              <option value="node">Node.js</option>
              <option value="batch">Batch (cmd)</option>
              <option value="info">Informatif (jamais exécutable)</option>
            </select>
          </div>
          <div className="tl-field">
            <label className="tl-label">Privilèges administrateur requis</label>
            <label className="tl-row" style={{ gap: 8, paddingTop: 8 }}>
              <input type="checkbox" checked={draft.script.requiresAdmin} onChange={(e) => set('script', { ...draft.script!, requiresAdmin: e.target.checked })} />
              Oui (affiché à l’utilisateur, jamais auto-élévé)
            </label>
          </div>
          <div className="tl-field full">
            <label className="tl-label">URL du script * (https, hôte GitHub autorisé)</label>
            <input className="tl-input tl-mono" value={draft.script.url} placeholder="https://raw.githubusercontent.com/owner/repo/main/scripts/mon-script.ps1"
              onChange={(e) => set('script', { ...draft.script!, url: e.target.value })} />
            <span className="tl-hint">Hôtes autorisés : raw.githubusercontent.com, github.com, objects.githubusercontent.com, release-assets.githubusercontent.com.</span>
          </div>
          <div className="tl-field full">
            <label className="tl-label">Empreinte SHA-256 * (obligatoire pour un runtime réel)</label>
            <input className="tl-input tl-mono" value={draft.script.sha256 ?? ''} placeholder="64 caractères hexadécimaux"
              onChange={(e) => set('script', { ...draft.script!, sha256: e.target.value || undefined })} />
            <span className="tl-hint">
              Calculez-la avec <code>certutil -hashfile mon-script.ps1 SHA256</code> (Windows) ou <code>sha256sum</code> —
              ou publiez le script dans ce dépôt et utilisez l’empreinte affichée par votre CI.
              L’application refuse toute exécution si l’empreinte ne correspond pas.
            </span>
          </div>
        </div>
      )}

      {validationError && (
        <div className="tl-poll-mode-note" style={{ borderColor: 'rgba(251,191,36,0.45)', marginTop: 12 }}>
          <IconAlert size={14} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--tl-warning)' }} />
          Validation en direct : {validationError}
        </div>
      )}
    </Modal>
  );
}
