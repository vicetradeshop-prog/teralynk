/**
 * Page Sondages — participation HONNÊTE selon le mode :
 *
 *  - mode `github` (centralisé) : résultats réels lus depuis les issues GitHub
 *    (réactions +1) ; le vote exige le jeton GitHub personnel de l'utilisateur
 *    (chiffré localement via safeStorage). Jamais de jeton administrateur.
 *  - mode `local` : le choix est enregistré sur cet ordinateur UNIQUEMENT et
 *    l'interface le dit explicitement — aucune agrégation n'est prétendue.
 */
import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { describePollParticipation, isPollParticipable, pollWindowState, type Poll, type PollsManifest } from '@teralynk/shared';
import { Badge, Button, EmptyState, ErrorState, Modal } from '@/components/ui';
import { IconCheck, IconExternal, IconPoll, IconUser } from '@/components/Icons';
import { api, type PollResultsView, type PrefsView } from '@/lib/api';
import { useToast } from '@/components/Toasts';
import type { ContentState } from '@/hooks/useData';

interface Props {
  polls: ContentState<PollsManifest>;
  prefs: PrefsView | null;
  onPrefsChange: (prefs: PrefsView) => void;
}

export function PollsPage({ polls, prefs, onPrefsChange }: Props) {
  const toast = useToast();
  const [tokenModal, setTokenModal] = useState<Poll | null>(null);
  const [tokenInput, setTokenInput] = useState('');
  const [tokenStatus, setTokenStatus] = useState<{ exists: boolean; encryptionAvailable: boolean } | null>(null);
  const [results, setResults] = useState<Record<string, PollResultsView>>({});
  const [voting, setVoting] = useState<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ poll: Poll; optionId: string } | null>(null);

  const loadTokenStatus = useCallback(() => {
    api?.polls.tokenStatus().then(setTokenStatus);
  }, []);

  useEffect(() => {
    loadTokenStatus();
  }, [loadTokenStatus]);

  const allPolls = polls.data?.polls ?? [];
  const visible = allPolls
    .filter((poll) => poll.status !== 'draft')
    .sort((a, b) => {
      const rank = (p: Poll) => (isPollParticipable(p) ? 0 : pollWindowState(p) === 'scheduled' ? 1 : 2);
      return rank(a) - rank(b) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

  // Résultats centralisés : lus publiquement pour chaque sondage github visible.
  const refreshResults = useCallback(async (poll: Poll) => {
    const response = await api!.polls.results(poll);
    if (response.ok && response.results) {
      setResults((prev) => ({ ...prev, [poll.id]: response.results! }));
    }
  }, []);

  useEffect(() => {
    for (const poll of visible) {
      if (poll.mode === 'github') void refreshResults(poll);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polls.data]);

  /* ---------- Vote local (mode local) ---------- */
  const voteLocal = async (poll: Poll, optionId: string) => {
    if (!prefs) return;
    const next = await api!.prefs.patch({ localPollVotes: { ...prefs.localPollVotes, [poll.id]: optionId } });
    onPrefsChange(next);
    toast.push('info', 'Choix enregistré sur cet ordinateur. Rappel : ce vote local n’est pas comptabilisé dans un résultat global.');
  };

  /* ---------- Vote centralisé (mode github) ---------- */
  const voteGithub = async (poll: Poll, optionId: string) => {
    setVoting(`${poll.id}:${optionId}`);
    const response = await api!.polls.voteGithub(poll, optionId);
    setVoting(null);
    if (response.ok) {
      toast.push('success', response.message);
      await refreshResults(poll);
    } else {
      toast.push('error', response.message, 8000);
      if (response.message.includes('jeton')) setTokenModal(poll);
    }
  };

  const saveToken = async () => {
    if (tokenInput.trim().length < 20) {
      toast.push('error', 'Jeton trop court — utilisez un Personal Access Token GitHub (scope public_repo).');
      return;
    }
    const response = await api!.polls.storeToken(tokenInput.trim());
    if (response.ok) {
      toast.push('success', 'Jeton enregistré, chiffré via le stockage sécurisé du système.');
      setTokenInput('');
      setTokenModal(null);
      loadTokenStatus();
      const next = await api!.prefs.get();
      onPrefsChange(next);
    } else {
      toast.push('error', response.message ?? 'Enregistrement impossible.');
    }
  };

  const clearToken = async () => {
    await api!.polls.clearToken();
    loadTokenStatus();
    const next = await api!.prefs.get();
    onPrefsChange(next);
    toast.push('info', 'Jeton GitHub effacé de cet ordinateur.');
  };

  return (
    <>
      <div className="tl-page-head">
        <h1 className="tl-page-title">Sondages</h1>
        <p className="tl-page-sub">
          Consultations officielles. Chaque sondage indique clairement si la participation est centralisée (GitHub)
          ou strictement locale à cet ordinateur.
        </p>
      </div>

      {polls.error && <ErrorState title="Sondages inaccessibles" message={polls.error.message} detail={polls.error.detail} onRetry={polls.reload} />}

      {!polls.error && polls.loading && <div className="tl-col"><span className="tl-spinner" style={{ margin: '40px auto' }} /></div>}

      {!polls.error && !polls.loading && visible.length === 0 && (
        <EmptyState icon={<IconPoll size={30} />} title="Aucun sondage actif" message="Aucun sondage n’est publié pour le moment. Les prochaines consultations apparaîtront ici dès leur publication." />
      )}

      <div className="tl-col">
        {visible.map((poll, index) => {
          const info = describePollParticipation(poll);
          const windowState = info.windowState;
          const localVote = prefs?.localPollVotes?.[poll.id];
          const pollResults = results[poll.id];

          // Barres de résultats : centralisés si disponibles.
          const counts = pollResults?.options ?? [];
          const total = counts.reduce((sum, c) => sum + c.plusOne, 0);

          return (
            <motion.div
              key={poll.id}
              className="tl-poll-card"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, delay: Math.min(index * 0.06, 0.4) }}
            >
              <div className="tl-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <h2 style={{ fontSize: 'var(--tl-text-md)', fontWeight: 640, flex: 1, minWidth: 200 }}>{poll.title}</h2>
                <Badge kind={info.participable ? 'available' : windowState === 'scheduled' ? 'soon' : 'unavailable'}>
                  {info.participable ? 'Ouvert' : windowState === 'scheduled' ? `Début le ${new Date(poll.startsAt).toLocaleDateString('fr-FR')}` : 'Clôturé'}
                </Badge>
                <Badge kind={poll.mode === 'github' ? 'new' : 'neutral'}>
                  {poll.mode === 'github' ? 'Centralisé (GitHub)' : 'Local uniquement'}
                </Badge>
              </div>

              {poll.description && <p className="tl-muted" style={{ fontSize: 'var(--tl-text-sm)' }}>{poll.description}</p>}

              <p className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)' }}>
                Participation : du {new Date(poll.startsAt).toLocaleDateString('fr-FR')} au {new Date(poll.endsAt).toLocaleDateString('fr-FR')}
                {poll.mode === 'github' && pollResults && ` · résultats lus de GitHub le ${new Date(pollResults.fetchedAt).toLocaleTimeString('fr-FR')}`}
              </p>

              <div className="tl-col" style={{ gap: 8 }}>
                {poll.options.map((option) => {
                  const count = counts.find((c) => c.optionId === option.id);
                  const percent = total > 0 && count ? Math.round((count.plusOne / total) * 100) : null;
                  const selectedLocal = poll.mode === 'local' && localVote === option.id;
                  const isVoting = voting === `${poll.id}:${option.id}`;
                  const clickable = info.participable;

                  return (
                    <div
                      key={option.id}
                      className={`tl-poll-option ${selectedLocal ? 'is-selected' : ''} ${clickable ? '' : 'is-disabled'}`}
                      role={clickable ? 'button' : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      aria-disabled={!clickable}
                      onClick={() => {
                        if (!clickable) return;
                        if (poll.mode === 'local') void voteLocal(poll, option.id);
                        else setConfirmModal({ poll, optionId: option.id });
                      }}
                      onKeyDown={(e) => {
                        if (clickable && e.key === 'Enter') {
                          if (poll.mode === 'local') void voteLocal(poll, option.id);
                          else setConfirmModal({ poll, optionId: option.id });
                        }
                      }}
                    >
                      {percent !== null && <span className="tl-poll-option-bar" style={{ width: `${percent}%` }} />}
                      <span className="tl-poll-option-label">
                        {option.label}
                        {selectedLocal && <IconCheck size={14} style={{ marginLeft: 8, color: 'var(--tl-success)', verticalAlign: -2 }} />}
                      </span>
                      {isVoting && <span className="tl-spinner" style={{ width: 14, height: 14 }} />}
                      {percent !== null && <span className="tl-poll-option-count">{count?.plusOne ?? 0} · {percent} %</span>}
                      {poll.mode === 'github' && count && (
                        <button
                          className="tl-btn tl-btn-icon"
                          style={{ padding: 2, position: 'relative' }}
                          aria-label="Voir l’issue GitHub"
                          onClick={(e) => { e.stopPropagation(); void api?.system.openExternal(count.url); }}
                        >
                          <IconExternal size={13} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="tl-poll-mode-note">{info.modeExplanation}</div>

              {poll.mode === 'github' && (
                <div className="tl-row" style={{ gap: 8 }}>
                  <Button variant="ghost" size="sm" icon={<IconUser size={14} />} onClick={() => setTokenModal(poll)}>
                    {tokenStatus?.exists ? 'Jeton GitHub enregistré' : 'Configurer mon jeton GitHub'}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void refreshResults(poll)}>Actualiser les résultats</Button>
                  {tokenStatus?.exists && (
                    <Button variant="ghost" size="sm" onClick={clearToken}>Effacer le jeton</Button>
                  )}
                </div>
              )}
              {poll.mode === 'local' && localVote && (
                <p className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)' }}>
                  Votre choix est enregistré localement. Il reste modifiable tant que le sondage est ouvert, mais n’est transmis à personne.
                </p>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Confirmation vote centralisé (réaction publique) */}
      <Modal
        open={Boolean(confirmModal)}
        onClose={() => setConfirmModal(null)}
        small
        title="Voter publiquement sur GitHub ?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmModal(null)}>Annuler</Button>
            <Button
              variant="primary"
              onClick={async () => {
                if (!confirmModal) return;
                const { poll, optionId } = confirmModal;
                setConfirmModal(null);
                await voteGithub(poll, optionId);
              }}
            >
              Voter
            </Button>
          </>
        }
      >
        <p className="tl-muted" style={{ marginBottom: 10 }}>
          Votre vote sera une réaction « +1 » <b>publique</b> sur l’issue GitHub dédiée à l’option
          « {confirmModal ? confirmModal.poll.options.find((o) => o.id === confirmModal.optionId)?.label : ''} ».
          Elle sera visible par toute personne consultant le dépôt, associée à votre compte GitHub.
        </p>
        <p className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)' }}>
          Un seul vote par compte GitHub et par issue (comportement de l’API GitHub).
        </p>
      </Modal>

      {/* Jeton GitHub utilisateur */}
      <Modal
        open={Boolean(tokenModal)}
        onClose={() => setTokenModal(null)}
        small
        title="Jeton GitHub personnel"
        footer={
          <>
            <Button variant="ghost" onClick={() => setTokenModal(null)}>Fermer</Button>
            <Button variant="primary" onClick={saveToken}>Enregistrer (chiffré)</Button>
          </>
        }
      >
        <p className="tl-muted" style={{ marginBottom: 12, fontSize: 'var(--tl-text-sm)' }}>
          Pour voter aux sondages centralisés, Teralynk utilise <b>votre</b> jeton GitHub personnel — jamais un jeton
          administrateur (l’application n’en contient aucun). Créez un <i>Personal Access Token</i> classique limité au
          scope <code>public_repo</code>.
        </p>
        {!tokenStatus?.encryptionAvailable && (
          <p style={{ color: 'var(--tl-danger)', fontSize: 'var(--tl-text-sm)', marginBottom: 12 }}>
            Le stockage chiffré du système est indisponible sur cette machine : le jeton ne peut pas être enregistré en sécurité.
          </p>
        )}
        <div className="tl-field">
          <label className="tl-label" htmlFor="gh-token">Jeton (masqué par défaut)</label>
          <input
            id="gh-token"
            className="tl-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="ghp_••••••••••••••••••••"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
          />
          <span className="tl-hint">
            Chiffré via le stockage sécurisé du système (DPAPI sur Windows), déchiffré uniquement dans le processus
            principal au moment du vote. Jamais écrit en clair, jamais journalisé, jamais transmis ailleurs qu’à api.github.com.
          </span>
        </div>
      </Modal>
    </>
  );
}
