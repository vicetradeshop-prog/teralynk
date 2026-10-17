/**
 * Interface native « Téléchargeur de musique » (carte featureUi music-downloader).
 *
 * Expérience : étapes animées en direct (événements réels du processus),
 * installation autonome de spotdl APRÈS consentement, choix du dossier via la
 * boîte de dialogue système, journal repliable, arrêt possible, et FAQ
 * complète (MP3, lecteur MP3, MP4, téléphone, ffmpeg, légalité).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { validateSpotifyUrl, type FeatureCard } from '@teralynk/shared';
import { Modal, Button, Badge } from '@/components/ui';
import { IconAlert, IconCheck, IconDownload, IconExternal, IconFolder, IconRefresh, IconStop, IconX } from '@/components/Icons';
import { api, type MusicEventView, type MusicStatusView } from '@/lib/api';
import { useToast } from '@/components/Toasts';

const STEPS: Array<{ id: string; label: string }> = [
  { id: 'link', label: 'Lien Spotify validé' },
  { id: 'ready', label: 'spotdl & ffmpeg prêts' },
  { id: 'download', label: 'Téléchargement du flux' },
  { id: 'convert', label: 'Conversion MP3 + tags & pochette' },
  { id: 'done', label: 'Musique livrée dans votre dossier' }
];

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'Où sont enregistrées mes musiques ?',
    a:
      'Dans le dossier affiché sous le champ de lien (par défaut : Musique\\Teralynk). Changez-le à tout moment avec le bouton « Dossier… » : ' +
      'le choix est mémorisé pour la session et chaque téléchargement y dépose un fichier .mp3 nommé « Artiste - Titre ».'
  },
  {
    q: 'Quel format et quelle qualité ?',
    a:
      'spotdl produit du MP3 (jusqu’à 320 kb/s selon la source) avec les métadonnées complètes : artiste, album, année, piste et pochette incrustée. ' +
      'Vos lecteurs et téléphones affichent donc des bibliothèques propres, pas des fichiers anonymes.'
  },
  {
    q: 'Comment mettre les musiques sur un lecteur MP3 ou une clé USB ?',
    a:
      '1) Ouvrez l’Explorateur de fichiers et allez dans votre dossier de destination (bouton « Ouvrir le dossier » après un téléchargement).\n' +
      '2) Sélectionnez les fichiers .mp3 (Ctrl+clic pour plusieurs).\n' +
      '3) Copiez-les (Ctrl+C), branchez votre lecteur/clé, puis collez (Ctrl+V) dans son dossier musique.\n' +
      '4) Éjectez proprement le périphérique. Les tags et pochettes sont conservés.'
  },
  {
    q: 'Comment convertir un morceau en MP4 (vidéo) ?',
    a:
      'Le MP3 est audio seul. Pour un MP4 (ex. fond noir ou visualiseur) :\n' +
      '— Avec VLC : Média → Convertir / Enregistrer → ajoutez le .mp3 → Profil « Video - H.264 + MP3 (MP4) » → Destination → Démarrer.\n' +
      '— Avec ffmpeg (ligne de commande) : ffmpeg -i "musique.mp3" -filter_complex "color=c=black:s=1280x720:r=1" -shortest "musique.mp4".\n' +
      'Teralynk fournit le MP3 source : la conversion vidéo reste un choix volontaire de votre part.'
  },
  {
    q: 'Envoyer mes musiques sur un téléphone ?',
    a:
      'Android : copiez les .mp3 dans le dossier Music du téléphone via USB (ou Drive/Files puis téléchargement).\n' +
      'iPhone/iPad : application Fichiers (glissez les .mp3 depuis l’ordinateur via iTunes/Finder ou iCloud Drive), ' +
      'ou importez-les dans une app de lecture compatible (VLC, Foobar2000).'
  },
  {
    q: 'Pourquoi ffmpeg est-il requis, et comment l’installer ?',
    a:
      'ffmpeg réalise l’encodage MP3 et l’incrustation des tags. Installation en 1 minute :\n' +
      '— Windows : winget install Gyan.FFmpeg (ou téléchargez le build « essentials » sur ffmpeg.org, dézippez, ajoutez le dossier bin au PATH).\n' +
      '— Ensuite redémarrez Teralynk : la puce « ffmpeg » passe au vert automatiquement.'
  },
  {
    q: 'Puis-je télécharger un album ou une playlist entière ?',
    a:
      'Oui : collez un lien d’album ou de playlist (open.spotify.com/album/… ou /playlist/…). spotdl enchaîne tous les titres ; ' +
      'les étapes et le journal affichent la progression morceau par morceau.'
  },
  {
    q: 'L’installation de spotdl est-elle sûre ?',
    a:
      'spotdl est un outil open source installé via pip (dépôt officiel PyPI), dans votre profil utilisateur uniquement (--user), sans privilèges ' +
      'administrateur et sans modification du système. Teralynk ne l’installe qu’après votre case cochée explicite, et chaque processus tourne ' +
      'fenêtre masquée avec un environnement nettoyé de tout secret.'
  },
  {
    q: 'Et côté légal ?',
    a:
      'Téléchargez uniquement des contenus que vous avez le droit de conserver (musiques libres, autorisées, ou vos achats selon votre juridiction). ' +
      'Respectez les conditions d’utilisation de Spotify et la législation locale : cette fonctionnalité est un outil technique, la responsabilité ' +
      'de l’usage vous appartient.'
  }
];

interface Props {
  card: FeatureCard;
  onClose: () => void;
}

export function MusicDownloader({ card, onClose }: Props) {
  const toast = useToast();
  const [status, setStatus] = useState<MusicStatusView | null>(null);
  const [checking, setChecking] = useState(true);
  const [url, setUrl] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [stepIndex, setStepIndex] = useState(-1);
  const [lines, setLines] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const startedAt = useRef<number | null>(null);
  const runIdRef = useRef<string | null>(null);

  const urlCheck = useMemo(() => validateSpotifyUrl(url), [url]);

  const refreshStatus = useCallback(async () => {
    setChecking(true);
    const [st, def] = await Promise.all([api!.music.status(), api!.music.defaultFolder()]);
    setStatus(st);
    setFolder((f) => f ?? (def.ok && def.folder ? def.folder : null));
    setChecking(false);
  }, []);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // Horloge d'exécution (durée réelle mesurée)
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - (startedAt.current ?? Date.now())) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running]);

  // Écoute des événements réels du processus
  useEffect(() => {
    const unsubscribe = api!.music.onEvent((raw: MusicEventView) => {
      if (runIdRef.current && raw.runId !== runIdRef.current) return;
      if (raw.type === 'step' && raw.step) {
        const idx = STEPS.findIndex((s) => s.id === raw.step);
        setStepIndex((prev) => Math.max(prev, idx));
        return;
      }
      if (raw.type === 'line' || raw.type === 'stderr') {
        setLines((prev) => [...prev.slice(-400), raw.text ?? '']);
        return;
      }
      if (raw.type === 'error') {
        setError(raw.text ?? 'Erreur inconnue.');
        return;
      }
      if (raw.type === 'exit') {
        setRunning(false);
        if (raw.code === 0) {
          setStepIndex(STEPS.length - 1);
          toast.push('success', 'Musique téléchargée et taguée dans votre dossier.');
        } else if (raw.code !== null) {
          setError(`spotdl s’est arrêté avec le code ${raw.code}. Ouvrez le journal pour le détail, consultez la FAQ ci-dessous.`);
        }
      }
    });
    return unsubscribe;
  }, [toast]);

  const install = async () => {
    setInstalling(true);
    setError(null);
    const result = await api!.music.install();
    setInstalling(false);
    if (result.ok) {
      toast.push('success', 'spotdl installé avec succès.');
      await refreshStatus();
    } else {
      setError(result.message ?? 'Installation impossible.');
    }
  };

  const start = async () => {
    if (!folder) return;
    setError(null);
    setLines([]);
    setStepIndex(0);
    setRunning(true);
    setElapsed(0);
    startedAt.current = Date.now();
    const result = await api!.music.download(url, folder);
    if (!result.ok) {
      setRunning(false);
      setStepIndex(-1);
      setError(result.message ?? 'Téléchargement impossible.');
      return;
    }
    runIdRef.current = result.runId ?? null;
    setRunId(result.runId ?? null);
  };

  const stop = async () => {
    if (!runIdRef.current) return;
    await api!.music.stop(runIdRef.current);
    setRunning(false);
    toast.push('info', 'Téléchargement arrêté.');
  };

  const missingSpotdl = status && !status.spotdl;
  const canStart = Boolean(urlCheck.ok && folder && status?.python && status?.spotdl && status?.ffmpeg && !running);

  return (
    <Modal
      open
      onClose={running ? () => undefined : onClose}
      title={card.name}
      subtitle={card.description}
      icon={
        <div className="tl-card-icon tl-music-icon" style={{ width: 46, height: 46 }}>
          <span className="tl-eq" aria-hidden>
            <i /><i /><i /><i />
          </span>
        </div>
      }
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={() => setShowLog((v) => !v)}>
            {showLog ? 'Masquer le journal' : 'Voir le journal'}
          </Button>
          {running ? (
            <Button variant="danger" icon={<IconStop size={13} />} onClick={stop}>Arrêter</Button>
          ) : (
            <Button variant="ghost" onClick={onClose}>Fermer</Button>
          )}
          <Button
            variant="primary"
            icon={<IconDownload size={15} />}
            disabled={!canStart}
            loading={running}
            onClick={start}
            className="tl-btn-sheen"
          >
            {running ? `En cours… ${elapsed}s` : 'Télécharger la musique'}
          </Button>
        </>
      }
    >
      {/* ---- État de l'environnement ---- */}
      <div className="tl-row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <Badge kind={status?.python ? 'available' : 'unavailable'}>Python {status?.pythonVersion ?? ''}</Badge>
        <Badge kind={status?.spotdl ? 'available' : 'soon'}>spotdl</Badge>
        <Badge kind={status?.ffmpeg ? 'available' : 'soon'}>ffmpeg</Badge>
        <Button variant="ghost" size="sm" icon={<IconRefresh size={13} />} loading={checking} onClick={refreshStatus} aria-label="Revérifier" />
        <span className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)', marginLeft: 'auto' }}>
          {status?.python && status.spotdl && status.ffmpeg ? 'Environnement prêt' : 'Complétez l’environnement ci-dessous'}
        </span>
      </div>

      {missingSpotdl && (
        <motion.div className="tl-music-notice" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <IconDownload size={15} style={{ flex: 'none', marginTop: 2, color: 'var(--tl-accent-bright)' }} />
          <div style={{ flex: 1 }}>
            <b>spotdl n’est pas encore installé.</b>
            <div className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)', marginTop: 2 }}>
              Installation automatique via pip (dépôt officiel PyPI, sans privilèges administrateur, fenêtre masquée).
            </div>
            <label className="tl-row" style={{ gap: 8, marginTop: 8, cursor: 'pointer', fontSize: 'var(--tl-text-sm)' }}>
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              J’autorise Teralynk à installer spotdl maintenant
            </label>
          </div>
          <Button variant="secondary" size="sm" disabled={!consent} loading={installing} onClick={install}>
            Installer
          </Button>
        </motion.div>
      )}

      {status && !status.ffmpeg && (
        <div className="tl-music-notice" style={{ borderColor: 'rgba(251,191,36,0.4)' }}>
          <IconAlert size={15} style={{ flex: 'none', marginTop: 2, color: 'var(--tl-warning)' }} />
          <div style={{ flex: 1, fontSize: 'var(--tl-text-sm)' }}>
            <b>ffmpeg manque</b> (indispensable pour convertir en MP3).
            <div className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)', marginTop: 2 }}>
              Windows : <span className="tl-mono">winget install Gyan.FFmpeg</span> — détails dans la FAQ ci-dessous. Puis bouton Rafraîchir.
            </div>
          </div>
        </div>
      )}

      {/* ---- Lien + dossier ---- */}
      <div className="tl-field" style={{ marginTop: 4 }}>
        <label className="tl-label">Lien Spotify (titre, album ou playlist)</label>
        <div className={`tl-search ${url && !urlCheck.ok ? 'is-invalid' : ''} ${urlCheck.ok ? 'is-valid' : ''}`} style={{ height: 44 }}>
          <IconDownload size={16} />
          <input
            type="text"
            placeholder="https://open.spotify.com/intl-fr/track/…"
            value={url}
            disabled={running}
            onChange={(e) => setUrl(e.target.value)}
            style={{ fontSize: 'var(--tl-text-base)' }}
          />
          {url && (urlCheck.ok ? <IconCheck size={16} style={{ color: 'var(--tl-success)' }} /> : <IconX size={16} style={{ color: 'var(--tl-danger)' }} />)}
        </div>
        {url && !urlCheck.ok && <span className="tl-error-text">{urlCheck.reason}</span>}
      </div>

      <div className="tl-field">
        <label className="tl-label">Dossier de destination</label>
        <div className="tl-row" style={{ gap: 8 }}>
          <div className="tl-music-folder" title={folder ?? ''}>
            <IconFolder size={15} style={{ flex: 'none', color: 'var(--tl-accent-bright)' }} />
            <span className="tl-mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folder ?? '…'}</span>
          </div>
          <Button variant="secondary" size="sm" disabled={running} onClick={async () => {
            const result = await api!.music.pickFolder();
            if (result.ok && result.folder) setFolder(result.folder ?? null);
          }}>
            Dossier…
          </Button>
        </div>
      </div>

      {/* ---- Étapes animées ---- */}
      <AnimatePresence>
        {(running || stepIndex >= 0) && (
          <motion.div className="tl-steps" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
            {STEPS.map((step, index) => {
              const state = index < stepIndex ? 'done' : index === stepIndex ? (running ? 'active' : step.id === 'done' ? 'done' : 'active') : 'todo';
              return (
                <div key={step.id} className={`tl-step is-${state}`}>
                  <span className="tl-step-dot">
                    {state === 'done' ? (
                      <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}>
                        <IconCheck size={11} />
                      </motion.span>
                    ) : state === 'active' ? (
                      <span className="tl-step-pulse" />
                    ) : null}
                  </span>
                  <span className="tl-step-label">{step.label}</span>
                </div>
              );
            })}
            <div className="tl-progress" style={{ marginTop: 10 }}>
              <div className={`tl-progress-bar ${running ? 'tl-progress-anim' : ''}`} style={{ width: running ? undefined : stepIndex >= STEPS.length - 1 ? '100%' : '45%' }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <motion.div className="tl-music-notice" style={{ borderColor: 'rgba(248,113,113,0.45)' }} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <IconAlert size={15} style={{ flex: 'none', marginTop: 2, color: 'var(--tl-danger)' }} />
          <div style={{ fontSize: 'var(--tl-text-sm)', flex: 1 }}>{error}</div>
        </motion.div>
      )}

      {showLog && (
        <pre className="tl-code" style={{ maxHeight: 160, marginTop: 4 }}>
          {lines.length ? lines.join('\n') : '(aucune sortie pour l’instant)'}
        </pre>
      )}

      {/* ---- FAQ ---- */}
      <div className="tl-divider" />
      <div className="tl-section-head" style={{ marginBottom: 8 }}>
        <h3 style={{ fontSize: 'var(--tl-text-base)', fontWeight: 650 }}>FAQ — bien utiliser vos musiques</h3>
        <span className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)' }}>{FAQ.length} réponses</span>
      </div>
      <div className="tl-faq">
        {FAQ.map((item, index) => (
          <div key={item.q} className={`tl-faq-item ${openFaq === index ? 'is-open' : ''}`}>
            <button className="tl-faq-q" onClick={() => setOpenFaq(openFaq === index ? null : index)}>
              <span>{item.q}</span>
              <motion.span animate={{ rotate: openFaq === index ? 45 : 0 }} transition={{ duration: 0.18 }} style={{ color: 'var(--tl-accent-bright)', fontSize: 16, lineHeight: 1 }}>
                +
              </motion.span>
            </button>
            <AnimatePresence initial={false}>
              {openFaq === index && (
                <motion.div
                  key="a"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                >
                  <p className="tl-faq-a">{item.a}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>

      <p className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)', marginTop: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
        <IconExternal size={12} />
        spotdl est un projet open source indépendant ; Teralynk l’orchestre sans fenêtre console et sans privilèges.
      </p>
    </Modal>
  );
}
