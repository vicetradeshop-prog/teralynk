/**
 * Page Configuration (admin) — dépôt GitHub cible, options de publication,
 * clé de signature et gestion du jeton.
 */
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Modal } from '@/components/ui';
import { IconAlert, IconCheck, IconExternal, IconShield, IconTrash } from '@/components/Icons';
import { adminApi, type AdminConfigView, type TokenValidation } from '@/lib/api';
import { useToast } from '@/components/Toasts';

interface Props {
  validation: TokenValidation;
  onDisconnect: () => void;
}

export function ConfigPage({ validation, onDisconnect }: Props) {
  const toast = useToast();
  const [config, setConfig] = useState<AdminConfigView | null>(null);
  const [draft, setDraft] = useState<AdminConfigView | null>(null);
  const [keyStatus, setKeyStatus] = useState<{ configured: boolean; exists: boolean; fileName?: string } | null>(null);
  const [confirmClearToken, setConfirmClearToken] = useState(false);
  const [systemInfo, setSystemInfo] = useState<{ appVersion: string; platform: string; arch: string; electron: string; userData: string } | null>(null);

  const load = useCallback(async () => {
    const [cfg, key, sys] = await Promise.all([
      adminApi!.config.get(),
      adminApi!.config.signingKeyStatus(),
      adminApi!.system.info()
    ]);
    setConfig(cfg);
    setDraft(cfg);
    setKeyStatus(key);
    setSystemInfo(sys);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!config || !draft) return null;

  const dirty = JSON.stringify(config) !== JSON.stringify(draft);

  const save = async () => {
    const result = await adminApi!.config.save(draft);
    if (result.ok && result.config) {
      setConfig(result.config);
      setDraft(result.config);
      toast.push('success', 'Configuration enregistrée. Revalidez le jeton si le dépôt a changé.');
    } else {
      toast.push('error', result.message ?? 'Enregistrement impossible.');
    }
  };

  return (
    <>
      <div className="tl-page-head">
        <h1 className="tl-page-title">Configuration</h1>
        <p className="tl-page-sub">Dépôt cible, clé de signature et sécurité du panel.</p>
      </div>

      {/* Jeton administrateur */}
      <section className="tl-settings-group">
        <h3>Jeton GitHub administrateur</h3>
        <div className="tl-settings-row">
          <div className="grow">
            <div className="title">État de la connexion</div>
            <div className="sub">
              Connecté en tant que <b>{validation.login}</b> · scopes : {(validation.scopes ?? []).join(', ') || '—'} ·
              dépôt {validation.repo} ({validation.privateRepo ? 'privé' : 'public'}) ·
              droits : {validation.repoAccess?.push ? 'écriture ✓' : 'lecture seule ✕'}
            </div>
          </div>
          <Badge kind="available">Actif</Badge>
        </div>
        <div className="tl-settings-row">
          <div className="grow">
            <div className="title">Permissions minimales requises</div>
            <div className="sub">
              <code>{validation.privateRepo ? 'repo' : 'public_repo'}</code> — Contents (lecture/écriture), Releases (création, upload),
              Issues (création pour les sondages centralisés). Le panel affiche les droits manquants au lieu de
              demander un jeton à privilèges étendus.
            </div>
          </div>
          <Button variant="ghost" size="sm" icon={<IconExternal size={13} />} onClick={() => void adminApi!.system.openExternal('https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens')}>Documentation</Button>
        </div>
        <div className="tl-settings-row">
          <div className="grow">
            <div className="title" style={{ color: 'var(--tl-danger)' }}>Effacer le jeton enregistré</div>
            <div className="sub">Supprime le jeton chiffré de cet ordinateur et déconnecte le panel.</div>
          </div>
          <Button variant="danger" size="sm" icon={<IconTrash size={13} />} onClick={() => setConfirmClearToken(true)}>Effacer</Button>
        </div>
      </section>

      {/* Dépôt */}
      <section className="tl-settings-group">
        <h3>Dépôt GitHub officiel</h3>
        <p className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)', marginBottom: 10 }}>
          Cible unique de toutes les publications (catalogue, annonces, sondages, versions).
          L’application utilisateur pointe sur le même dépôt via sa configuration centralisée partagée.
        </p>
        <div className="form-grid">
          <div className="tl-field">
            <label className="tl-label">Propriétaire</label>
            <input className="tl-input" value={draft.repoOwner} onChange={(e) => setDraft({ ...draft, repoOwner: e.target.value })} />
          </div>
          <div className="tl-field">
            <label className="tl-label">Nom du dépôt</label>
            <input className="tl-input" value={draft.repoName} onChange={(e) => setDraft({ ...draft, repoName: e.target.value })} />
          </div>
          <div className="tl-field">
            <label className="tl-label">Branche de contenu</label>
            <input className="tl-input" value={draft.contentBranch} onChange={(e) => setDraft({ ...draft, contentBranch: e.target.value })} />
            <span className="tl-hint">Branche servant les fichiers JSON publics (raw.githubusercontent.com).</span>
          </div>
        </div>
        <div className="tl-row">
          <Button variant="primary" size="sm" disabled={!dirty} onClick={save}>Enregistrer</Button>
          {dirty && <span className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)' }}>Modifications non enregistrées</span>}
        </div>
      </section>

      {/* Clé de signature */}
      <section className="tl-settings-group">
        <h3>Clé de signature Ed25519</h3>
        <div className="tl-settings-row">
          <div className="grow">
            <div className="title">Clé privée (manifestes et contenus)</div>
            <div className="sub">
              {keyStatus?.configured
                ? keyStatus.exists
                  ? <>Fichier configuré : <span className="tl-mono">{keyStatus.fileName}</span> — reste sur cet ordinateur, jamais publié.</>
                  : <>⚠ Fichier configuré introuvable : <span className="tl-mono">{keyStatus.fileName}</span></>
                : 'Aucune clé configurée : la publication de versions et de contenus signés est bloquée.'}
            </div>
          </div>
          {keyStatus?.configured && keyStatus.exists ? <IconCheck size={18} style={{ color: 'var(--tl-success)' }} /> : <IconAlert size={18} style={{ color: 'var(--tl-warning)' }} />}
          <Button variant="secondary" size="sm" icon={<IconShield size={14} />} onClick={async () => {
            const result = await adminApi!.config.selectSigningKey();
            if (result.ok) {
              toast.push('success', `Clé configurée : ${result.fileName}`);
              await load();
            } else if (!result.cancelled) {
              toast.push('error', result.message ?? 'Sélection impossible.');
            }
          }}>
            {keyStatus?.configured ? 'Remplacer…' : 'Sélectionner une clé…'}
          </Button>
        </div>
        <div className="tl-poll-mode-note">
          <IconShield size={14} style={{ verticalAlign: -2, marginRight: 6, color: 'var(--tl-violet-bright)' }} />
          Générez la paire avec <span className="tl-mono">npm run gen:keys -- ./keys</span> à la racine du monorepo.
          La clé PUBLIQUE doit être intégrée à l’application utilisateur
          (<span className="tl-mono">apps/teralynk/electron/signing-public-key.pem</span>) avant sa compilation ;
          la clé PRIVÉE ne quitte jamais cet ordinateur et ne doit jamais être committée
          (le <span className="tl-mono">.gitignore</span> exclut <span className="tl-mono">keys/</span> et <span className="tl-mono">*.pem</span>).
          La clé de signature est distincte du jeton GitHub.
        </div>
      </section>

      {/* Panel */}
      <section className="tl-settings-group">
        <h3>Ce panel</h3>
        <dl className="tl-kv">
          <dt>Version</dt><dd className="tl-mono">{systemInfo?.appVersion ?? '—'}</dd>
          <dt>Système</dt><dd>{systemInfo ? `${systemInfo.platform} ${systemInfo.arch} · Electron ${systemInfo.electron}` : '—'}</dd>
          <dt>Données locales</dt>
          <dd>
            <span className="tl-mono" style={{ fontSize: 10 }}>{systemInfo?.userData}</span>{' '}
            <Button variant="ghost" size="sm" onClick={() => void adminApi!.system.openUserData()}>Ouvrir</Button>
          </dd>
          <dt>Séparation</dt>
          <dd>Teralynk Admin est une application distincte de Teralynk : installateurs, identifiants et fichiers de publication séparés.</dd>
        </dl>
      </section>

      <Modal
        open={confirmClearToken}
        onClose={() => setConfirmClearToken(false)}
        small
        title="Effacer le jeton et déconnecter ?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmClearToken(false)}>Annuler</Button>
            <Button
              variant="danger"
              onClick={async () => {
                await adminApi!.admin.clearToken();
                setConfirmClearToken(false);
                onDisconnect();
              }}
            >
              Effacer le jeton
            </Button>
          </>
        }
      >
        <p className="tl-muted">
          Le jeton chiffré sera supprimé de cet ordinateur et le panel reviendra à l’écran de connexion.
          Les brouillons locaux et la configuration du dépôt sont conservés.
        </p>
      </Modal>
    </>
  );
}
