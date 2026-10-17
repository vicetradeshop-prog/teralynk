/**
 * Page Versions — publication d'une nouvelle version de Teralynk depuis un ZIP.
 *
 * Wizard en 5 étapes (spécification §18) :
 *  1. Sélection du fichier via la VRAIE boîte de dialogue du système.
 *  2. Analyse du ZIP (structure, chemins dangereux, métadonnées, fichiers).
 *  3. Métadonnées de publication (version, titre, notes, canal, minSupported).
 *  4. Récapitulatif + confirmation explicite.
 *  5. Publication GitHub avec progression RÉELLE (octets uploadés, étapes) —
 *     jamais de barre qui avance toute seule.
 *
 * En cas d'échec : état récupérable affiché (release brouillon éventuelle,
 * manifeste non publié) + nettoyage possible.
 */
import { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { compareSemver } from '@teralynk/shared';
import { Badge, Button, Modal, Progress } from '@/components/ui';
import { IconAlert, IconCheck, IconDownload, IconFolder, IconRefresh, IconTrash, IconX } from '@/components/Icons';
import { adminApi, type GitHubReleaseView, type PublishProgressView, type PublishResultView, type ZipFileInfo, type ZipInspectionView } from '@/lib/api';
import { useToast } from '@/components/Toasts';

type WizardStep = 1 | 2 | 3 | 4 | 5;

interface MetadataDraft {
  version: string;
  title: string;
  notes: string;
  channel: 'stable' | 'beta';
  minSupportedVersion: string;
  prerelease: boolean;
}

const STEP_TITLES = ['Fichier', 'Analyse', 'Métadonnées', 'Récapitulatif', 'Publication'];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / 1048576).toFixed(1)} Mo`;
}

export function ReleasesPage() {
  const toast = useToast();
  const [step, setStep] = useState<WizardStep>(1);
  const [zipFile, setZipFile] = useState<ZipFileInfo | null>(null);
  const [inspection, setInspection] = useState<ZipInspectionView | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [metadata, setMetadata] = useState<MetadataDraft | null>(null);
  const [releases, setReleases] = useState<GitHubReleaseView[]>([]);
  const [releasesError, setReleasesError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [progress, setProgress] = useState<PublishProgressView | null>(null);
  const [result, setResult] = useState<PublishResultView | null>(null);
  const [publishStepsList, setPublishStepsList] = useState<Array<{ id: string; label: string }>>([]);
  const [confirmCleanup, setConfirmCleanup] = useState<number | null>(null);

  const loadReleases = useCallback(async () => {
    const response = await adminApi!.releases.list();
    if (response.ok && response.releases) {
      setReleases(response.releases);
      setReleasesError(null);
    } else {
      setReleasesError(response.message ?? 'Liste des releases inaccessible.');
    }
  }, []);

  useEffect(() => {
    void loadReleases();
    void adminApi!.releases.publishSteps().then(setPublishStepsList);
    const unsubscribe = adminApi!.releases.onProgress((p) => setProgress(p));
    return unsubscribe;
  }, [loadReleases]);

  const selectZip = async () => {
    const response = await adminApi!.releases.selectZip();
    if (response.ok && response.file) {
      setZipFile(response.file);
      setInspection(null);
      setMetadata(null);
      setResult(null);
      setProgress(null);
      setStep(2);
      // Analyse immédiate après sélection (étape 2).
      setInspecting(true);
      const inspected = await adminApi!.releases.inspectZip(response.file.path);
      setInspecting(false);
      if (inspected.ok && inspected.inspection) {
        setInspection(inspected.inspection);
        if (inspected.inspection.ok && inspected.inspection.metadata) {
          const m = inspected.inspection.metadata;
          setMetadata({
            version: m.version,
            title: m.title,
            notes: m.notes,
            channel: m.channel,
            minSupportedVersion: m.minSupportedVersion,
            prerelease: m.channel === 'beta'
          });
        }
      } else {
        toast.push('error', inspected.message ?? 'Analyse du ZIP impossible.');
      }
    } else if (!response.cancelled && response.message) {
      toast.push('error', response.message);
    }
  };

  const conflict = (() => {
    if (!metadata) return null;
    const tag = `v${metadata.version}`;
    if (releases.some((r) => r.tag_name === tag)) return `Le tag ${tag} existe déjà — choisissez une autre version (rien ne sera écrasé).`;
    const latestStable = releases.filter((r) => !r.draft && !r.prerelease)[0];
    if (metadata.channel === 'stable' && latestStable) {
      const latestVersion = latestStable.tag_name.replace(/^v/, '');
      if (/^\d+\.\d+\.\d+/.test(latestVersion) && compareSemver(metadata.version, latestVersion) <= 0) {
        return `La dernière release stable est ${latestVersion} : la nouvelle version doit être supérieure.`;
      }
    }
    return null;
  })();

  const startPublish = async () => {
    if (!zipFile || !metadata) return;
    setPublishing(true);
    setResult(null);
    setProgress(null);
    setStep(5);
    const response = await adminApi!.releases.publish({
      zipPath: zipFile.path,
      overrides: {
        version: metadata.version,
        title: metadata.title,
        notes: metadata.notes,
        channel: metadata.channel,
        minSupportedVersion: metadata.minSupportedVersion,
        prerelease: metadata.prerelease
      }
    });
    setPublishing(false);
    setResult(response);
    await loadReleases();
    if (response.ok) {
      toast.push('success', `Version ${metadata.version} publiée et vérifiée sur GitHub.`, 10000);
    } else {
      toast.push('error', `Publication échouée (${response.failedStep}) : ${response.message}`, 14000);
    }
  };

  const reset = () => {
    setStep(1);
    setZipFile(null);
    setInspection(null);
    setMetadata(null);
    setProgress(null);
    setResult(null);
  };

  return (
    <>
      <div className="tl-page-head">
        <h1 className="tl-page-title">Versions et mises à jour</h1>
        <p className="tl-page-sub">Publier une nouvelle version de Teralynk depuis un paquet ZIP construit localement.</p>
      </div>

      {/* Fil du wizard */}
      <div className="wizard-steps">
        {STEP_TITLES.map((title, index) => {
          const n = (index + 1) as WizardStep;
          return (
            <div key={title} className={`wizard-step ${step === n ? 'is-active' : ''} ${step > n ? 'is-done' : ''}`}>
              {index + 1}. {title}
            </div>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {/* ---------- Étape 1 : sélection ---------- */}
        {step === 1 && (
          <motion.div key="s1" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.25 }}>
            <div className="wizard-drop">
              <IconFolder size={34} style={{ marginBottom: 10, color: 'var(--tl-accent-bright)' }} />
              <h3 style={{ marginBottom: 6 }}>Sélectionner un paquet de publication (.zip)</h3>
              <p className="tl-muted" style={{ fontSize: 'var(--tl-text-sm)', maxWidth: 460, margin: '0 auto 16px' }}>
                Le ZIP doit contenir à sa racine <span className="tl-mono">teralynk.package.json</span> (métadonnées du paquet)
                et les artefacts de distribution construits par <span className="tl-mono">npm run dist:app</span>
                (installateur NSIS + <span className="tl-mono">latest.yml</span>). Une archive source (code du projet) sera refusée.
              </p>
              <Button variant="primary" size="lg" icon={<IconFolder size={16} />} onClick={selectZip}>
                Parcourir… (boîte de dialogue système)
              </Button>
            </div>
          </motion.div>
        )}

        {/* ---------- Étape 2 : analyse ---------- */}
        {step === 2 && (
          <motion.div key="s2" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.25 }}>
            {zipFile && (
              <div className="wizard-file" style={{ marginBottom: 16 }}>
                <div className="icon"><IconDownload size={20} /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <b>{zipFile.name}</b>
                  <div className="tl-faint tl-mono" style={{ fontSize: 'var(--tl-text-xs)' }}>
                    {formatSize(zipFile.size)} · modifié le {new Date(zipFile.modifiedAt).toLocaleString('fr-FR')}
                  </div>
                  <div className="tl-faint tl-mono" style={{ fontSize: 10, wordBreak: 'break-all' }}>{zipFile.path}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={selectZip}>Remplacer</Button>
              </div>
            )}

            {inspecting && (
              <div className="tl-col" style={{ alignItems: 'center', padding: 32, gap: 12 }}>
                <span className="tl-spinner" />
                <p className="tl-muted">Analyse de l’archive : entrées, chemins dangereux, métadonnées, fichiers déclarés… (aucune exécution du contenu)</p>
              </div>
            )}

            {inspection && !inspecting && (
              <div className="tl-glass" style={{ padding: 20 }}>
                <div className="tl-row" style={{ marginBottom: 12 }}>
                  {inspection.ok ? <IconCheck size={20} style={{ color: 'var(--tl-success)' }} /> : <IconX size={20} style={{ color: 'var(--tl-danger)' }} />}
                  <b>{inspection.ok ? 'Paquet valide' : 'Paquet refusé'}</b>
                  <Badge kind={inspection.ok ? 'available' : 'critical'}>{inspection.entries.length} entrée(s) · {formatSize(inspection.totalUncompressedSize)} décompressé</Badge>
                </div>
                <p className="tl-muted" style={{ fontSize: 'var(--tl-text-sm)', marginBottom: 12 }}>{inspection.verdict}</p>

                {inspection.pathIssues.length > 0 && (
                  <div className="tl-poll-mode-note" style={{ borderColor: 'rgba(248,113,113,0.5)', marginBottom: 12 }}>
                    <IconAlert size={14} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--tl-danger)' }} />
                    Chemins dangereux détectés (Zip Slip) — archive rejetée sans extraction :
                    <ul style={{ paddingLeft: 18, marginTop: 4 }}>
                      {inspection.pathIssues.slice(0, 8).map((issue) => <li key={issue.entry} className="tl-mono">{issue.entry} ({issue.reason})</li>)}
                    </ul>
                  </div>
                )}

                {inspection.metadata && (
                  <dl className="tl-kv" style={{ marginBottom: 12 }}>
                    <dt>Version du paquet</dt><dd className="tl-mono">{inspection.metadata.version}</dd>
                    <dt>Canal</dt><dd>{inspection.metadata.channel}</dd>
                    <dt>Version minimale</dt><dd className="tl-mono">{inspection.metadata.minSupportedVersion}</dd>
                    <dt>Construit le</dt><dd>{new Date(inspection.metadata.builtAt).toLocaleString('fr-FR')}</dd>
                    <dt>Fichiers déclarés</dt>
                    <dd>
                      {inspection.metadata.files.map((f) => {
                        const entry = inspection.entries.find((e) => e.name === f);
                        return (
                          <span key={f} className="tl-tag" style={{ marginRight: 6 }}>
                            {f} {entry ? `(${formatSize(entry.uncompressedSize)})` : '(MANQUANT)'}
                          </span>
                        );
                      })}
                    </dd>
                  </dl>
                )}
                {inspection.metadataError && <p style={{ color: 'var(--tl-danger)', fontSize: 'var(--tl-text-sm)' }}>{inspection.metadataError}</p>}

                <div className="tl-row" style={{ marginTop: 12 }}>
                  <Button variant="ghost" onClick={reset}>Recommencer</Button>
                  <Button variant="primary" disabled={!inspection.ok} onClick={() => setStep(3)}>
                    Continuer vers les métadonnées
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        )}

        {/* ---------- Étape 3 : métadonnées ---------- */}
        {step === 3 && metadata && (
          <motion.div key="s3" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.25 }}>
            <div className="tl-glass" style={{ padding: 20 }}>
              <div className="form-grid">
                <div className="tl-field">
                  <label className="tl-label">Numéro de version *</label>
                  <input className="tl-input tl-mono" value={metadata.version} onChange={(e) => setMetadata({ ...metadata, version: e.target.value })} />
                </div>
                <div className="tl-field">
                  <label className="tl-label">Canal *</label>
                  <select className="tl-select" value={metadata.channel} onChange={(e) => setMetadata({ ...metadata, channel: e.target.value as 'stable' | 'beta', prerelease: e.target.value === 'beta' ? true : metadata.prerelease })}>
                    <option value="stable">stable</option>
                    <option value="beta">beta</option>
                  </select>
                </div>
                <div className="tl-field full">
                  <label className="tl-label">Titre de la publication *</label>
                  <input className="tl-input" value={metadata.title} onChange={(e) => setMetadata({ ...metadata, title: e.target.value })} />
                </div>
                <div className="tl-field full">
                  <label className="tl-label">Notes de version</label>
                  <textarea className="tl-textarea" rows={6} value={metadata.notes} onChange={(e) => setMetadata({ ...metadata, notes: e.target.value })} />
                  <span className="tl-hint">Affichées dans l’écran de mise à jour de l’application et sur la page GitHub.</span>
                </div>
                <div className="tl-field">
                  <label className="tl-label">Version minimale autorisée *</label>
                  <input className="tl-input tl-mono" value={metadata.minSupportedVersion} onChange={(e) => setMetadata({ ...metadata, minSupportedVersion: e.target.value })} />
                  <span className="tl-hint">
                    Toute installation strictement inférieure devra OBLIGATOIREMENT se mettre à jour.
                    Laissez une version antérieure pour une mise à jour facultative.
                  </span>
                </div>
                <div className="tl-field">
                  <label className="tl-label">Marquer comme pré-release GitHub</label>
                  <label className="tl-switch" style={{ marginTop: 8 }}>
                    <input type="checkbox" checked={metadata.prerelease} onChange={(e) => setMetadata({ ...metadata, prerelease: e.target.checked })} />
                    <span className="tl-switch-track" /><span className="tl-switch-thumb" />
                  </label>
                </div>
              </div>

              {conflict && (
                <div className="tl-poll-mode-note" style={{ borderColor: 'rgba(248,113,113,0.5)', marginBottom: 12 }}>
                  <IconAlert size={14} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--tl-danger)' }} />
                  {conflict}
                </div>
              )}

              <div className="tl-row">
                <Button variant="ghost" onClick={() => setStep(2)}>Retour</Button>
                <Button variant="primary" disabled={Boolean(conflict) || !/^\d+\.\d+\.\d+(-[0-9A-Za-z-.]+)?$/.test(metadata.version)} onClick={() => setStep(4)}>
                  Vérifier avant publication
                </Button>
              </div>
            </div>
          </motion.div>
        )}

        {/* ---------- Étape 4 : récapitulatif ---------- */}
        {step === 4 && metadata && inspection && (
          <motion.div key="s4" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.25 }}>
            <div className="tl-glass" style={{ padding: 20 }}>
              <h3 style={{ marginBottom: 12 }}>Récapitulatif de la publication</h3>
              <dl className="tl-kv" style={{ marginBottom: 16 }}>
                <dt>Paquet</dt><dd className="tl-mono">{zipFile?.name} ({formatSize(zipFile?.size ?? 0)})</dd>
                <dt>Nouvelle version</dt><dd className="tl-mono"><b>{metadata.version}</b> · canal {metadata.channel}{metadata.prerelease ? ' · pré-release' : ''}</dd>
                <dt>Version minimale</dt><dd className="tl-mono">{metadata.minSupportedVersion}</dd>
                <dt>Titre</dt><dd>{metadata.title}</dd>
                <dt>Fichiers distribués</dt>
                <dd>
                  {inspection.metadata?.files.map((f) => {
                    const entry = inspection.entries.find((e) => e.name === f);
                    return <div key={f} className="tl-mono">{f} — {formatSize(entry?.uncompressedSize ?? 0)}</div>;
                  })}
                </dd>
                <dt>Notes de version</dt><dd style={{ whiteSpace: 'pre-wrap', maxHeight: 120, overflowY: 'auto' }}>{metadata.notes || '(aucune)'}</dd>
                <dt>Destination</dt><dd className="tl-mono">github.com (dépôt officiel configuré) — release + versions/{metadata.channel}.json signé</dd>
              </dl>

              <div className="tl-poll-mode-note" style={{ marginBottom: 16 }}>
                <b>Opérations réalisées :</b> création d’une release brouillon → upload des fichiers (empreintes SHA-256 calculées) →
                vérification des assets sur GitHub → publication de la release → commit du manifeste de version signé (Ed25519) →
                contrôle final. Si une étape échoue, la release reste en brouillon et le manifeste n’est pas publié :
                les utilisateurs ne verront jamais une version incomplète.
              </div>

              <div className="tl-row">
                <Button variant="ghost" onClick={() => setStep(3)}>Retour</Button>
                <Button variant="primary" size="lg" onClick={startPublish} disabled={publishing}>
                  Confirmer et publier sur GitHub
                </Button>
              </div>
            </div>
          </motion.div>
        )}

        {/* ---------- Étape 5 : publication ---------- */}
        {step === 5 && (
          <motion.div key="s5" initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.25 }}>
            <div className="tl-glass" style={{ padding: 20 }}>
              <h3 style={{ marginBottom: 14 }}>{publishing ? 'Publication en cours…' : result?.ok ? 'Publication terminée' : 'Publication échouée'}</h3>

              <div className="tl-col" style={{ gap: 4, marginBottom: 16 }}>
                {publishStepsList.map((s) => {
                  const currentIndex = progress ? publishStepsList.findIndex((x) => x.id === progress.step) : -1;
                  const thisIndex = publishStepsList.findIndex((x) => x.id === s.id);
                  const failedHere = result && !result.ok && result.failedStep === s.id;
                  const done = result?.ok ? true : thisIndex < currentIndex;
                  return (
                    <div key={s.id} className={`publish-step ${failedHere ? 'is-failed' : progress?.step === s.id && publishing ? 'is-active' : done ? 'is-done' : ''}`}>
                      <span className="num">{failedHere ? '✕' : done ? '✓' : thisIndex + 1}</span>
                      <span style={{ flex: 1 }}>{s.label}</span>
                      {progress?.step === s.id && publishing && progress.percent > 0 && progress.percent < 100 && (
                        <span className="tl-mono tl-faint">{progress.percent} %</span>
                      )}
                    </div>
                  );
                })}
              </div>

              {progress && publishing && (
                <div style={{ marginBottom: 16 }}>
                  <Progress percent={progress.step === 'upload-assets' ? progress.percent : undefined} indeterminate={progress.step !== 'upload-assets'} />
                  <div className="tl-gate-progress-meta">
                    <span>{progress.label}</span>
                    <span>{progress.message ?? ''}</span>
                  </div>
                </div>
              )}

              {result && !result.ok && (
                <div className="tl-poll-mode-note" style={{ borderColor: 'rgba(248,113,113,0.5)', marginBottom: 16 }}>
                  <IconAlert size={14} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--tl-danger)' }} />
                  <b>Échec à l’étape « {publishStepsList.find((s) => s.id === result.failedStep)?.label ?? result.failedStep} ».</b>
                  <div style={{ marginTop: 6 }}>{result.message}</div>
                  <div style={{ marginTop: 6, color: 'var(--tl-text-dim)' }}>Récupération : {result.recovery}</div>
                  {result.releaseId && (
                    <Button variant="danger" size="sm" style={{ marginTop: 10 }} icon={<IconTrash size={13} />} onClick={() => setConfirmCleanup(result.releaseId!)}>
                      Supprimer la release brouillon orpheline
                    </Button>
                  )}
                </div>
              )}

              {result?.ok && (
                <div className="tl-poll-mode-note" style={{ borderColor: 'rgba(52,211,153,0.5)', marginBottom: 16 }}>
                  <IconCheck size={14} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--tl-success)' }} />
                  <b>Version {result.tag} publiée et vérifiée.</b>
                  <div style={{ marginTop: 6 }}>
                    Release : <button className="tl-btn tl-btn-ghost tl-btn-sm" onClick={() => void adminApi!.system.openExternal(result.release.html_url)}>{result.release.html_url}</button>
                  </div>
                  <div>Manifeste signé : <span className="tl-mono">{result.manifestPath}</span> (+ .sig) · assets : {result.assets.join(', ')}</div>
                  <div style={{ marginTop: 6, color: 'var(--tl-text-dim)' }}>
                    Les applications Teralynk proposeront cette mise à jour à leur prochain contrôle obligatoire.
                  </div>
                </div>
              )}

              <div className="tl-row">
                {!publishing && <Button variant="secondary" onClick={reset}>Nouvelle publication</Button>}
                {publishing && <span className="tl-faint tl-mono">Ne fermez pas l’application pendant la publication.</span>}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="tl-divider" />

      {/* ---------- Releases existantes ---------- */}
      <div className="tl-section-head">
        <h2 className="tl-section-title">Releases GitHub</h2>
        <Button variant="ghost" size="sm" icon={<IconRefresh size={14} />} onClick={loadReleases}>Actualiser</Button>
      </div>
      {releasesError && <p style={{ color: 'var(--tl-danger)', fontSize: 'var(--tl-text-sm)' }}>{releasesError}</p>}
      <div className="tl-glass" style={{ padding: 8, overflowX: 'auto' }}>
        <table className="admin-table">
          <thead><tr><th>Tag</th><th>Nom</th><th>État</th><th>Assets</th><th>Actions</th></tr></thead>
          <tbody>
            {releases.map((release) => (
              <tr key={release.id}>
                <td className="tl-mono">{release.tag_name}</td>
                <td>{release.name ?? '—'}</td>
                <td>
                  {release.draft ? <Badge kind="soon">Brouillon</Badge> : release.prerelease ? <Badge kind="experimental">Pré-release</Badge> : <Badge kind="available">Publiée</Badge>}
                </td>
                <td className="tl-mono tl-faint">{release.assets.map((a) => `${a.name} (${formatSize(a.size)})`).join(', ') || '—'}</td>
                <td>
                  <div className="row-actions">
                    <Button variant="ghost" size="sm" onClick={() => void adminApi!.system.openExternal(release.html_url)}>Voir</Button>
                    {release.draft && (
                      <Button variant="danger" size="sm" icon={<IconTrash size={13} />} aria-label="Supprimer le brouillon" onClick={() => setConfirmCleanup(release.id)} />
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {releases.length === 0 && !releasesError && (
              <tr><td colSpan={5} className="tl-faint" style={{ textAlign: 'center', padding: 20 }}>Aucune release sur ce dépôt.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={confirmCleanup !== null}
        onClose={() => setConfirmCleanup(null)}
        small
        title="Supprimer cette release brouillon ?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmCleanup(null)}>Annuler</Button>
            <Button
              variant="danger"
              onClick={async () => {
                if (confirmCleanup === null) return;
                const response = await adminApi!.releases.deleteDraft(confirmCleanup);
                setConfirmCleanup(null);
                if (response.ok) {
                  toast.push('success', 'Brouillon supprimé (nettoyage de la tentative échouée).');
                  await loadReleases();
                } else {
                  toast.push('error', response.message ?? 'Suppression impossible.');
                }
              }}
            >
              Supprimer
            </Button>
          </>
        }
      >
        <p className="tl-muted">
          Seuls les brouillons (créés par une tentative de publication échouée) peuvent être supprimés ici.
          Le manifeste de version n’ayant pas été publié, les utilisateurs ne voient pas cette version.
        </p>
      </Modal>
    </>
  );
}
