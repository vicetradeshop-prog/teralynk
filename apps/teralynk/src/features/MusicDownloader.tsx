/**
 * Interface native « Téléchargeur de musique » (carte featureUi music-downloader).
 *
 * v1.5.0 — refonte complète :
 *  - PANNEAU DÉPENDANCES : trois cartes animées (Python, spotdl, ffmpeg) avec
 *    statut réel et BOUTON D'INSTALLATION OBLIGATOIRE : rien n'est installé
 *    sans un clic volontaire de l'utilisateur (consentement explicite).
 *    ffmpeg s'installe désormais en automatique (build statique officiel,
 *    progression réelle) au lieu d'une simple consigne manuelle.
 *  - BOUTONS DOSSIER RÉPARÉS : « Dossier… » (vraie boîte de dialogue système)
 *    et « Ouvrir le dossier » (Explorateur Windows) fonctionnent réellement
 *    (les canaux IPC correspondants existent désormais côté processus principal).
 *  - ANIMATIONS : scène de fond animée (orbes, notes flottantes), égaliseur,
 *    étapes spring, barre de progression scintillante, célébration finale
 *    avec confettis, journal en direct repliable.
 *  - FAQ complète conservée (MP3, lecteur MP3, MP4, téléphone, ffmpeg, légalité).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { validateSpotifyUrl, type FeatureCard } from '@teralynk/shared';
import { Modal, Button, Badge } from '@/components/ui';
import {
  IconAlert, IconCheck, IconDownload, IconExternal, IconFolder, IconRefresh, IconStop, IconTerminal, IconWrench, IconX
} from '@/components/Icons';
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
      'le choix est mémorisé pour la session et chaque téléchargement y dépose un fichier .mp3 nommé « Artiste - Titre ». ' +
      'Le bouton « Ouvrir le dossier » y amène directement l’Explorateur de fichiers.'
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
      '1) Cliquez sur « Ouvrir le dossier » après un téléchargement (ou ouvrez votre dossier de destination).\n' +
      '2) Sélectionnez les fichiers .mp3 (Ctrl+clic pour plusieurs).\n' +
      '3) Copiez-les (Ctrl+C), branchez votre lecteur/clé, puis collez-les (Ctrl+V) dans son dossier musique.\n' +
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
    q: 'Comment ffmpeg est-il installé par Teralynk ?',
    a:
      'Le bouton « Installer ffmpeg » télécharge le build statique officiel publié sur les releases GitHub BtbN/FFmpeg-Builds, ' +
      'le décompresse dans un dossier local géré (%LOCALAPPDATA%\\Teralynk\\tools) et l’utilise automatiquement pour spotdl. ' +
      'Rien n’est modifié dans Windows : pas de registre, pas de PATH système, pas de privilèges administrateur. ' +
      'Préférence manuelle : winget install Gyan.FFmpeg fonctionne aussi (dans ce cas Teralynk détecte le ffmpeg système).'
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

type DepKind = 'spotdl' | 'ffmpeg';

export function MusicDownloader({ card, onClose }: Props) {
  const toast = useToast();
  const [status, setStatus] = useState<MusicStatusView | null>(null);
  const [checking, setChecking] = useState(true);
  const [url, setUrl] = useState('');
  const [folder, setFolder] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [depInstall, setDepInstall] = useState<DepKind | null>(null);
  const [depProgress, setDepProgress] = useState<number | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [stepIndex, setStepIndex] = useState(-1);
  const [lines, setLines] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [openingFolder, setOpeningFolder] = useState(false);
  const startedAt = useRef<number | null>(null);
  const runIdRef = useRef<string | null>(null);
  const depRunIdRef = useRef<string | null>(null);

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

  // Écoute des événements RÉELS du processus (installations + téléchargement)
  useEffect(() => {
    const unsubscribe = api!.music.onEvent((raw: MusicEventView) => {
      /* ---- Branche dépendances : installation spotdl/ffmpeg en cours ---- */
      if (depInstall || (depRunIdRef.current !== null && raw.runId === depRunIdRef.current)) {
        depRunIdRef.current = raw.runId;
        if (raw.type === 'progress') {
          if (typeof raw.percent === 'number') setDepProgress(raw.percent);
          if (raw.text) setLines((prev) => [...prev.slice(-400), raw.text ?? '']);
          return;
        }
        if (raw.type === 'line' || raw.type === 'stderr') {
          setLines((prev) => [...prev.slice(-400), raw.text ?? '']);
          return;
        }
        if (raw.type === 'step' && raw.text) {
          setLines((prev) => [...prev.slice(-400), `• ${raw.text}`]);
          return;
        }
        if (raw.type === 'error') {
          setError(raw.text ?? 'Erreur inconnue.');
          return;
        }
        if (raw.type === 'exit') {
          if (raw.code === 0) {
            toast.push('success', depInstall === 'ffmpeg' ? 'ffmpeg installé : il sera utilisé automatiquement.' : 'spotdl installé avec succès.');
          }
          setDepInstall(null);
          setDepProgress(null);
          depRunIdRef.current = null;
          void refreshStatus();
        }
        return;
      }

      /* ---- Branche téléchargement de musique ---- */
      if (runIdRef.current !== null && raw.runId !== runIdRef.current) return;
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
  }, [toast, depInstall, refreshStatus]);

  const installDep = async (kind: DepKind) => {
    setError(null);
    setLines([]);
    setDepProgress(null);
    setShowLog(true);
    setDepInstall(kind);
    const result = kind === 'spotdl' ? await api!.music.install() : await api!.music.installFfmpeg();
    if (!result.ok) {
      setDepInstall(null);
      setDepProgress(null);
      setError(result.message ?? 'Installation impossible.');
    }
    // En cas de succès, l'événement 'exit' ci-dessus rafraîchit le statut.
  };

  const openDestinationFolder = async (target?: string | null) => {
    const dest = target ?? folder;
    if (!dest) return;
    setOpeningFolder(true);
    const result = await api!.music.openFolder(dest);
    setOpeningFolder(false);
    if (!result.ok) {
      toast.push('error', result.message ?? 'Ouverture du dossier impossible.');
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
    if (runIdRef.current) {
      await api!.music.stop(runIdRef.current);
      setRunning(false);
      toast.push('info', 'Téléchargement arrêté.');
      return;
    }
    if (depRunIdRef.current) {
      await api!.music.stop(depRunIdRef.current);
      setDepInstall(null);
      setDepProgress(null);
      toast.push('info', 'Installation arrêtée.');
    }
  };

  const envReady = Boolean(status?.python && status?.spotdl && status?.ffmpeg);
  const succeeded = !running && stepIndex >= STEPS.length - 1;
  const canStart = Boolean(urlCheck.ok && folder && envReady && !running && !depInstall);

  return (
    <Modal
      open
      onClose={running || depInstall ? () => undefined : onClose}
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
          {running || depInstall ? (
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
      {/* ---- Scène animée de fond ---- */}
      <div className="tl-music-stage" aria-hidden>
        <span className="tl-music-orb" /><span className="tl-music-orb" /><span className="tl-music-orb" />
        <span className="tl-music-note">♪</span>
        <span className="tl-music-note">♫</span>
        <span className="tl-music-note">♩</span>
      </div>

      {/* ---- Dépendances : installation OBLIGATOIREMENT manuelle (clic) ---- */}
      <div className="tl-section-head" style={{ marginBottom: 8 }}>
        <h3 style={{ fontSize: 'var(--tl-text-base)', fontWeight: 650 }}>Dépendances requises</h3>
        <span className="tl-row" style={{ gap: 8 }}>
          <Badge kind={envReady ? 'available' : 'soon'}>{envReady ? 'Environnement prêt' : 'À compléter'}</Badge>
          <Button variant="ghost" size="sm" icon={<IconRefresh size={13} />} loading={checking} onClick={refreshStatus} aria-label="Revérifier l’environnement" />
        </span>
      </div>

      <div className="tl-dep-grid">
        {/* -------- Python -------- */}
        <motion.div
          className={`tl-dep-card ${status?.python ? 'is-ready' : 'is-missing'}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.02 }}
          title={status?.pythonPath ?? undefined}
        >
          <div className="tl-dep-head">
            <span className="tl-dep-ico"><IconTerminal size={16} /></span>
            <b>Python 3</b>
            <span className={`tl-dep-dot ${status?.python ? 'is-ok' : status ? 'is-off' : 'is-wait'}`} />
          </div>
          <p className="tl-dep-sub">
            {status?.python ? `Détecté${status.pythonVersion ? ` · ${status.pythonVersion}` : ''}` : 'Nécessaire pour exécuter spotdl'}
          </p>
          {status && !status.python && (
            <Button
              variant="secondary"
              size="sm"
              icon={<IconExternal size={13} />}
              onClick={() => void api!.system.openExternal('https://www.python.org/downloads/')}
            >
              Télécharger Python
            </Button>
          )}
          {status && !status.python && (
            <span className="tl-hint">Cochez « Add to PATH » à l’installation, puis cliquez sur Revérifier.</span>
          )}
        </motion.div>

        {/* -------- spotdl -------- */}
        <motion.div
          className={`tl-dep-card ${status?.spotdl ? 'is-ready' : depInstall === 'spotdl' ? 'is-working' : 'is-missing'}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.08 }}
        >
          <div className="tl-dep-head">
            <span className="tl-dep-ico"><IconDownload size={16} /></span>
            <b>spotdl</b>
            <span className={`tl-dep-dot ${status?.spotdl ? 'is-ok' : depInstall === 'spotdl' ? 'is-wait' : 'is-off'}`} />
          </div>
          <p className="tl-dep-sub">
            {status?.spotdl
              ? `Prêt${status.spotdlVersion ? ` · v${status.spotdlVersion}` : ''} (pip utilisateur)`
              : 'Moteur de téléchargement Spotify → MP3'}
          </p>
          {status && !status.spotdl && depInstall !== 'spotdl' && (
            <>
              <label className="tl-dep-consent">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                J’autorise l’installation (pip --user, sans admin)
              </label>
              <Button variant="primary" size="sm" disabled={!consent || !status.python} onClick={() => void installDep('spotdl')} className="tl-btn-sheen">
                Installer spotdl
              </Button>
              {!status.python && <span className="tl-hint">Installez d’abord Python.</span>}
            </>
          )}
          {depInstall === 'spotdl' && (
            <span className="tl-dep-working">Installation en cours… <span className="tl-dots" aria-hidden><i /><i /><i /></span></span>
          )}
        </motion.div>

        {/* -------- ffmpeg -------- */}
        <motion.div
          className={`tl-dep-card ${status?.ffmpeg ? 'is-ready' : depInstall === 'ffmpeg' ? 'is-working' : 'is-missing'}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.14 }}
        >
          <div className="tl-dep-head">
            <span className="tl-dep-ico"><IconWrench size={16} /></span>
            <b>ffmpeg</b>
            <span className={`tl-dep-dot ${status?.ffmpeg ? 'is-ok' : depInstall === 'ffmpeg' ? 'is-wait' : 'is-off'}`} />
          </div>
          <p className="tl-dep-sub">
            {status?.ffmpeg
              ? status.ffmpegSource === 'managed' ? 'Build géré par Teralynk' : 'Détecté sur le système'
              : 'Conversion MP3 + tags & pochette'}
          </p>
          {status && !status.ffmpeg && depInstall !== 'ffmpeg' && (
            <Button variant="primary" size="sm" icon={<IconDownload size={13} />} onClick={() => void installDep('ffmpeg')} className="tl-btn-sheen">
              Installer ffmpeg (auto)
            </Button>
          )}
          {depInstall === 'ffmpeg' && (
            <div className="tl-dep-progress" role="progressbar" aria-label="Téléchargement de ffmpeg">
              <div className="tl-progress" style={{ height: 6 }}>
                <div className={`tl-progress-bar ${depProgress === null ? 'tl-progress-anim' : ''}`} style={{ width: depProgress === null ? undefined : `${Math.max(4, depProgress)}%` }} />
              </div>
              <span className="tl-faint tl-mono" style={{ fontSize: 10 }}>{depProgress !== null ? `${Math.round(depProgress)} %` : 'connexion…'}</span>
            </div>
          )}
        </motion.div>
      </div>

      {/* ---- Lien + dossier ---- */}
      <div className="tl-field" style={{ marginTop: 14 }}>
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
          <Button
            variant="secondary"
            size="sm"
            disabled={running || depInstall !== null}
            onClick={async () => {
              const result = await api!.music.pickFolder();
              if (result.ok && result.folder) {
                setFolder(result.folder);
                toast.push('info', `Dossier de destination : ${result.folder}`);
              }
            }}
          >
            Dossier…
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={<IconFolder size={13} />}
            disabled={!folder || openingFolder}
            loading={openingFolder}
            onClick={() => void openDestinationFolder()}
          >
            Ouvrir le dossier
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
                <motion.div key={step.id} className={`tl-step is-${state}`} layout transition={{ type: 'spring', stiffness: 420, damping: 34 }}>
                  <span className="tl-step-dot">
                    {state === 'done' ? (
                      <motion.span initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 500, damping: 26 }}>
                        <IconCheck size={11} />
                      </motion.span>
                    ) : state === 'active' ? (
                      <span className="tl-step-pulse" />
                    ) : null}
                  </span>
                  <span className="tl-step-label">{step.label}</span>
                  {state === 'active' && <span className="tl-step-shimmer" aria-hidden />}
                </motion.div>
              );
            })}
            <div className="tl-progress" style={{ marginTop: 10 }}>
              <div className={`tl-progress-bar ${running ? 'tl-progress-anim' : ''}`} style={{ width: running ? undefined : stepIndex >= STEPS.length - 1 ? '100%' : '45%' }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---- Célébration de succès ---- */}
      <AnimatePresence>
        {succeeded && (
          <motion.div
            className="tl-celebrate"
            initial={{ opacity: 0, scale: 0.92, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 320, damping: 24 }}
          >
            <span className="tl-confetti" aria-hidden>
              {Array.from({ length: 10 }).map((_, i) => <i key={i} style={{ ['--i' as string]: i }} />)}
            </span>
            <motion.span
              className="tl-celebrate-check"
              initial={{ scale: 0, rotate: -120 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 380, damping: 18, delay: 0.08 }}
            >
              <IconCheck size={20} />
            </motion.span>
            <div style={{ flex: 1 }}>
              <b>Musique livrée !</b>
              <div className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)', marginTop: 2 }}>
                Fichier MP3 tagué (artiste, titre, pochette) déposé dans votre dossier de destination.
              </div>
            </div>
            <Button variant="secondary" size="sm" icon={<IconFolder size={13} />} onClick={() => void openDestinationFolder()}>
              Ouvrir le dossier
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {error && (
        <motion.div className="tl-music-notice" style={{ borderColor: 'rgba(248,113,113,0.45)' }} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          <IconAlert size={15} style={{ flex: 'none', marginTop: 2, color: 'var(--tl-danger)' }} />
          <div style={{ fontSize: 'var(--tl-text-sm)', flex: 1 }}>{error}</div>
        </motion.div>
      )}

      {!envReady && !error && status && (
        <p className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)', marginTop: 10 }}>
          Installez les dépendances ci-dessus (un clic par dépendance) pour activer le téléchargement.
        </p>
      )}

      {showLog && (
        <motion.pre className="tl-code" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} style={{ maxHeight: 160, marginTop: 4 }}>
          {lines.length ? lines.join('\n') : '(aucune sortie pour l’instant)'}
        </motion.pre>
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
