# Guide GitHub — infrastructure distante de Teralynk

Tout le contenu distant vit dans **un seul dépôt GitHub officiel**, configuré dans un module
unique : `packages/shared/src/config.ts` (`REMOTE_CONFIG`). Aucun autre endroit du code ne
définit le owner/repo (un test statique le vérifie).

## Organisation attendue du dépôt

```
<depot>/
├── content/
│   ├── catalog.json          # manifeste du catalogue (signé)
│   ├── catalog.json.sig      # signature Ed25519 detached (base64)
│   ├── announcements.json    # annonces publiées (signées)
│   ├── announcements.json.sig
│   ├── polls.json            # sondages publiés (signés)
│   └── polls.json.sig
├── versions/
│   ├── stable.json           # manifeste de version du canal stable (signé)
│   ├── stable.json.sig
│   ├── beta.json             # canal bêta (signé)
│   └── beta.json.sig
├── scripts/                  # (recommandé) sources des scripts exécutables référencés par les cartes
└── (releases GitHub)         # artefacts d'installation + latest.yml
```

Les fichiers `.sig` contiennent la signature Ed25519 (base64, une ligne) du **byte-for-byte**
contenu JSON correspondant, produite par Teralynk Admin avec la clé privée locale.
L'application utilisateur vérifie ces signatures avec la clé publique embarquée
(`apps/teralynk/electron/signing-public-key.pem`) **avant** d'utiliser le contenu.

> Bootstrap : avant la première publication, générez la paire de clés
> (`npm run gen:keys -- ./keys`), placez la clé publique dans l'application, compilez-la,
> puis configurez la clé privée dans Teralynk Admin (Configuration → Clé de signature).

## Distribution

- **Lecture publique** : `raw.githubusercontent.com/<owner>/<repo>/<branche>/<chemin>`
  (hôtes autorisés par la liste blanche de l'application).
- **Écriture** : API REST GitHub (`api.github.com`) uniquement depuis Teralynk Admin,
  avec le jeton administrateur (commits Contents, releases, issues).
- **Releases** : créées par l'admin en brouillon, assets uploadés, vérifiés, publiés ;
  le manifeste de version n'est committé qu'ensuite → une version incomplète n'est jamais
  proposée aux utilisateurs.

## Manifestes (schémas partagés)

Tous les schémas sont dans `packages/shared/src/schemas.ts` (zod) :

- `catalogManifestSchema` : `{ schemaVersion: 1, generatedAt, cards[] }`
  Chaque carte : `id, slug, name, description, longDescription?, category, icon, tags[],
  version?, status, platforms[], requirements[], permissions[], capabilities[], knownRisks[],
  riskLevel, script?{runtime, url, sha256, args[], requiresAdmin}, unavailableReason?,
  releaseNotes?, featured, enabled, createdAt, updatedAt`.
  Règles : une carte `available`/`new` exige un script avec `sha256` ; une carte
  `unavailable`/`soon` exige une `unavailableReason` ; les URLs de scripts sont limitées aux
  hôtes GitHub de distribution en https.
- `announcementsManifestSchema` : `{ schemaVersion, generatedAt, announcements[] }`
  (`id, title, summary, body, category, priority, illustration?, link?, publishedAt,
  expiresAt?, published`).
- `pollsManifestSchema` : `{ schemaVersion, generatedAt, polls[] }`
  (`id, title, description, options[{id,label,issueNumber?}], mode: local|github,
  startsAt, endsAt, status, createdAt`).
- `versionManifestSchema` : `{ schemaVersion, channel, latest, history[], catalogSha256? }`
  avec `latest = { version, channel, title, notes, publishedAt, tag, minSupportedVersion,
  files[{name, sha256, size}] }`.
- `packageMetadataSchema` : métadonnées du paquet ZIP (`teralynk.package.json`).

## Sondages centralisés (mécanisme réel)

Contrainte : un JSON statique ne peut pas agréger des votes anonymes. Mécanisme retenu :

1. À la publication d'un sondage en mode `github`, Teralynk Admin crée **une issue par option**
   (`[Sondage] <titre> — <option>`, label `sondage`) et enregistre les `issueNumber`
   dans `polls.json`.
2. Dans l'application, l'utilisateur lit les compteurs **réels** :
   `GET /repos/{o}/{r}/issues/{n}` → champ `reactions['+1']` (lecture publique, sans jeton).
3. Voter = `POST /repos/{o}/{r}/issues/{n}/reactions` avec `content: "+1"`, authentifié par le
   jeton GitHub **personnel** de l'utilisateur (scope `public_repo`), chiffré localement via
   safeStorage. Un seul vote par compte et par issue (comportement GitHub).
4. Le panel admin n'affiche aucun « résultat global » inventé : il montre les issues créées.

Les sondages en mode `local` n'utilisent rien de tout cela : le choix est enregistré dans les
préférences locales et l'UI affiche explicitement qu'il n'est **pas** comptabilisé ailleurs.

## Permissions GitHub minimales

| Opération | Scope minimal (dépôt public) | Dépôt privé |
|---|---|---|
| Lire le contenu publié (app utilisateur) | aucun (raw public) | impossible sans auth |
| Valider le jeton admin (`GET /user`, `GET /repos/...`) | `public_repo` | `repo` |
| Publier contenu signé (Contents PUT) | `public_repo` | `repo` |
| Créer releases + uploader assets | `public_repo` | `repo` |
| Créer/fermer des issues (sondages) | `public_repo` | `repo` |

L'admin affiche les scopes du jeton validé et explique les droits manquants au lieu de
demander un jeton à privilèges étendus.

## Rate-limiting et disponibilité

- Lecture publique raw : pas de rate-limit d'API (CDN), mais l'application applique quand même
  délais (15 s), retries limitées (2) et cache signé de 15 min.
- Écriture API : 5 000 req/h par jeton — très largement suffisant ; l'admin n'effectue que des
  opérations unitaires.
- Si GitHub est indisponible : l'app sert le cache signé (signalé « cache » dans l'UI) et le
  gate de démarrage applique sa politique explicite (voir `docs/updates.md`).
