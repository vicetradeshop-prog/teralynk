/**
 * Page À propos — version, projet, liens officiels, mentions.
 */
import { api, type SystemInfo } from '@/lib/api';
import { Badge, Button } from '@/components/ui';
import { IconExternal, IconShield, TeralynkMark } from '@/components/Icons';

interface Props {
  systemInfo: SystemInfo | null;
}

export function AboutPage({ systemInfo }: Props) {
  return (
    <>
      <div className="tl-page-head">
        <h1 className="tl-page-title">À propos de Teralynk</h1>
        <p className="tl-page-sub">Plateforme de scripts et d’outils, distribuée exclusivement via GitHub.</p>
      </div>

      <section className="tl-settings-group" style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
        <div className="tl-brand-mark" style={{ width: 72, height: 72, borderRadius: 20, flex: 'none' }}>
          <TeralynkMark size={40} />
        </div>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 'var(--tl-text-xl)', fontWeight: 700, letterSpacing: '-0.02em' }}>Teralynk</h2>
          <p className="tl-muted" style={{ fontSize: 'var(--tl-text-sm)', maxWidth: 520, marginTop: 4 }}>
            Découvrez, consultez et exécutez des scripts et des outils vérifiés, dans une application desktop premium.
            Le catalogue, les annonces, les sondages et les mises à jour sont publiés sur le dépôt GitHub officiel —
            aucun serveur intermédiaire, aucune base de données, aucun compte utilisateur.
          </p>
          <div className="tl-row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
            <Badge kind="info">Version {systemInfo?.appVersion ?? '…'}</Badge>
            <Badge kind="neutral">Electron {systemInfo?.electronVersion ?? '…'}</Badge>
            <Badge kind="neutral">{systemInfo ? `${systemInfo.platform} ${systemInfo.arch}` : '…'}</Badge>
          </div>
        </div>
      </section>

      <section className="tl-settings-group">
        <h3>Liens officiels</h3>
        <div className="tl-settings-row">
          <div className="grow">
            <div className="title">Dépôt GitHub</div>
            <div className="sub tl-mono">{systemInfo ? `${systemInfo.remote.owner}/${systemInfo.remote.repo}` : '…'}</div>
          </div>
          <Button variant="ghost" size="sm" icon={<IconExternal size={14} />} onClick={() => systemInfo && void api!.system.openExternal(systemInfo.repoUrl)}>Ouvrir</Button>
        </div>
        <div className="tl-settings-row">
          <div className="grow">
            <div className="title">Releases et mises à jour</div>
            <div className="sub">Toutes les versions de Teralynk sont distribuées via les releases GitHub officielles.</div>
          </div>
          <Button variant="ghost" size="sm" icon={<IconExternal size={14} />} onClick={() => systemInfo && void api!.system.openExternal(systemInfo.releasesUrl)}>Ouvrir</Button>
        </div>
      </section>

      <section className="tl-settings-group">
        <h3>Sécurité et vie privée</h3>
        <dl className="tl-kv">
          <dt>Mises à jour</dt>
          <dd>Vérification obligatoire au démarrage, manifeste signé Ed25519, empreintes SHA-256 des fichiers.</dd>
          <dt>Scripts</dt>
          <dd>Téléchargés depuis des hôtes GitHub autorisés, empreinte vérifiée, contenu présenté, confirmation explicite, exécution sans shell.</dd>
          <dt>Données</dt>
          <dd>Préférences et historique strictement locaux. Aucune télémétrie, aucun compte, aucune collecte.</dd>
          <dt>Jetons</dt>
          <dd>L’application ne contient aucun jeton administrateur. Votre éventuel jeton GitHub personnel (sondages centralisés) est chiffré via le stockage sécurisé du système.</dd>
        </dl>
        <div className="tl-row" style={{ marginTop: 14 }}>
          <IconShield size={18} style={{ color: 'var(--tl-success)' }} />
          <span className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)' }}>
            Avertissement : l’origine officielle d’un script ne garantit pas qu’il soit inoffensif. Lisez toujours
            les risques déclarés et le contenu avant exécution.
          </span>
        </div>
      </section>

      <p className="tl-faint" style={{ fontSize: 'var(--tl-text-xs)', textAlign: 'center', padding: '8px 0 24px' }}>
        © 2025 Teralynk · Application distribuée en l’état · Les marques tierces appartiennent à leurs propriétaires.
      </p>
    </>
  );
}
