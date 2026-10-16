/**
 * Écran de connexion de Teralynk Admin.
 *
 * - Saisie masquée du jeton, jamais réaffiché en clair après enregistrement.
 * - Validation réelle contre l'API GitHub : identité, scopes, droits sur le dépôt.
 * - Erreurs explicites (401, permissions insuffisantes, dépôt introuvable).
 * - Le jeton est chiffré via safeStorage dans le processus principal.
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui';
import { IconAlert, IconCheck, IconExternal, IconShield, TeralynkMark } from '@/components/Icons';
import { adminApi, type AdminConfigView, type TokenValidation } from '@/lib/api';

interface Props {
  onConnected: (validation: TokenValidation) => void;
}

export function LoginPage({ onConnected }: Props) {
  const [token, setToken] = useState('');
  const [config, setConfig] = useState<AdminConfigView | null>(null);
  const [existing, setExisting] = useState<{ exists: boolean; encryptionAvailable: boolean } | null>(null);
  const [phase, setPhase] = useState<'idle' | 'validating' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastValidation, setLastValidation] = useState<TokenValidation | null>(null);

  useEffect(() => {
    void (async () => {
      const [cfg, status] = await Promise.all([adminApi!.config.get(), adminApi!.admin.tokenStatus()]);
      setConfig(cfg);
      setExisting(status);
      if (status.exists) {
        // Jeton déjà enregistré : proposer la reconnexion directe.
        setPhase('validating');
        const result = await adminApi!.admin.validateToken();
        if (result.ok) {
          setLastValidation(result);
          onConnected(result);
        } else {
          setPhase('error');
          setError(result.message ?? 'Jeton enregistré invalide.');
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (token.trim().length < 20) {
      setPhase('error');
      setError('Collez un Personal Access Token GitHub complet (il commence généralement par « ghp_ » ou « github_pat_ »).');
      return;
    }
    setPhase('validating');
    setError(null);

    const stored = await adminApi!.admin.storeToken(token.trim());
    if (!stored.ok) {
      setPhase('error');
      setError(stored.message ?? 'Enregistrement du jeton impossible.');
      return;
    }
    const result = await adminApi!.admin.validateToken();
    if (result.ok) {
      setLastValidation(result);
      setToken('');
      onConnected(result);
    } else {
      setPhase('error');
      setError(result.message ?? 'Validation échouée.');
      await adminApi!.admin.clearToken(); // un jeton invalide ne reste pas stocké
    }
  };

  const clearToken = async () => {
    await adminApi!.admin.clearToken();
    setExisting({ exists: false, encryptionAvailable: existing?.encryptionAvailable ?? true });
    setLastValidation(null);
    setError(null);
    setPhase('idle');
  };

  return (
    <>
      <div className="tl-ambient" aria-hidden />
      <div className="admin-login">
        <motion.div
          className="admin-login-card"
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="admin-login-brand">
            <div className="mark"><TeralynkMark size={24} /></div>
            <div>
              <h1>Teralynk Admin</h1>
              <p>Panel de publication</p>
            </div>
          </div>

          {lastValidation?.ok ? (
            <div className="admin-token-state">
              <IconCheck size={16} style={{ color: 'var(--tl-success)' }} />
              <span>
                Connecté en tant que <b>{lastValidation.login}</b> sur {lastValidation.repo}
                <br />
                <span className="tl-faint">Permissions : {(lastValidation.scopes ?? []).join(', ') || 'aucune listée'}</span>
              </span>
            </div>
          ) : null}

          <p className="tl-muted" style={{ fontSize: 'var(--tl-text-sm)', marginBottom: 16 }}>
            Les opérations de publication nécessitent un <b>jeton GitHub administrateur</b>.
            Ce jeton n’est pas un compte Teralynk (il n’en existe aucun) : il autorise ce panel
            à écrire sur le dépôt <span className="tl-mono">{config ? `${config.repoOwner}/${config.repoName}` : '…'}</span> (branche{' '}
            <span className="tl-mono">{config?.contentBranch ?? '…'}</span>).
          </p>

          <div className="tl-field">
            <label className="tl-label" htmlFor="admin-token">Jeton GitHub (masqué)</label>
            <input
              id="admin-token"
              className="tl-input"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="ghp_•••••••••••••••••••• ou github_pat_••••"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void submit()}
            />
            <span className="tl-hint">
              Permissions minimales : <code>public_repo</code> (dépôt public) ou <code>repo</code> (dépôt privé) —
              Contents R/W, Releases, Issues. Le jeton est chiffré via le stockage sécurisé du système
              (Gestionnaire d’identifiants / DPAPI sur Windows), jamais écrit en clair ni journalisé.
            </span>
          </div>

          {existing && !existing.encryptionAvailable && (
            <div className="tl-poll-mode-note" style={{ borderColor: 'rgba(248,113,113,0.45)', marginBottom: 14 }}>
              <IconAlert size={14} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--tl-danger)' }} />
              Le stockage chiffré du système est indisponible : l’enregistrement sécurisé du jeton est impossible.
            </div>
          )}

          {phase === 'error' && error && (
            <div className="tl-poll-mode-note" style={{ borderColor: 'rgba(248,113,113,0.45)', marginBottom: 14 }}>
              <IconAlert size={14} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--tl-danger)' }} />
              {error}
            </div>
          )}

          <div className="tl-row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <Button variant="primary" size="lg" loading={phase === 'validating'} icon={<IconShield size={16} />} onClick={submit}>
              {phase === 'validating' ? 'Validation…' : 'Valider et connecter'}
            </Button>
            {existing?.exists && (
              <Button variant="danger" onClick={clearToken}>Effacer le jeton enregistré</Button>
            )}
          </div>

          <div className="tl-divider" />

          <p className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)', lineHeight: 1.6 }}>
            <IconExternal size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
            Créez un jeton sur github.com → Settings → Developer settings → Personal access tokens.
            Limitez sa durée et son périmètre au dépôt officiel. En cas de permission insuffisante,
            l’erreur affichée indique les droits nécessaires — ce panel ne demande jamais un jeton
            avec tous les privilèges par défaut.
          </p>
        </motion.div>
      </div>
    </>
  );
}
