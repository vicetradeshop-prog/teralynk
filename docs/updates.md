# Guide des mises à jour

## Principe

Au lancement, Teralynk exécute une **vérification obligatoire** avant d'ouvrir le tableau de
bord. Elle ne peut pas être désactivée depuis l'interface, et « Passer l'introduction » ne la
contourne jamais : l'écran de vérification s'enchaîne systématiquement.

## Chaîne de confiance

1. Téléchargement de `versions/{canal}.json` **et** `versions/{canal}.json.sig`
   (raw.githubusercontent, délai 15 s, 2 retries).
2. **Vérification Ed25519** de la signature avec la clé publique embarquée
   (`apps/teralynk/electron/signing-public-key.pem`). Une signature absente/incorrecte →
   `blocked-invalid` (accès refusé), car une empreinte fournie par un manifeste compromis
   n'est pas une preuve d'authenticité.
3. Validation zod du manifeste (`versionManifestSchema`).
4. Décision (`decideUpdate`, testée) :
   - `installée >= publiée` → **à jour** ;
   - `installée < publiée` mais `>= minSupportedVersion` → **mise à jour facultative**
     (nouveautés affichées, continuation possible) ;
   - `installée < minSupportedVersion` → **mise à jour obligatoire** (accès bloqué).
5. Le manifeste vérifié est mis en cache signé (`userData/cache/version-manifest.json`).

## Installation de la mise à jour

- **Application empaquetée** : `electron-updater` (provider GitHub) télécharge l'artefact de
  la release ; la progression affichée provient des événements réels d'electron-updater
  (`download-progress`), jamais d'une animation. Après téléchargement vérifié :
  « Installer et redémarrer » → `quitAndInstall()` → la vérification recommence au lancement.
- **Mode développement** : l'installation automatique est indisponible ; l'écran le dit et
  propose la page des releases. Ce n'est pas une fausse fonctionnalité : c'est une limite
  réelle d'electron-updater hors paquet signé/emballé.

## Politique de secours explicite (défaillance GitHub)

| Situation | Comportement |
|---|---|
| GitHub inaccessible, **cache signé valide** et `installée >= minSupportedVersion` du cache | Démarrage autorisé en **mode dégradé hors-ligne** : bannière permanente, contenus servis depuis le cache signalés « cache » |
| GitHub inaccessible et `installée < minSupportedVersion` (selon le cache signé) | **Accès bloqué** : mise à jour obligatoire, téléchargement proposé dès que le réseau revient |
| GitHub inaccessible et **aucun cache signé** | **Accès bloqué** avec bouton Réessayer + ouverture des journaux |
| Manifeste non signé / signature invalide / schéma invalide | **Accès bloqué** (aucun repli sur un contenu non vérifié) |

Aucun de ces cas n'est présenté comme un succès de mise à jour.

## Publication d'une version (côté admin)

Voir `docs/admin.md`. Ordre anti-incohérence : release brouillon → upload des assets
(progression réelle en octets) → vérification des assets sur GitHub → publication de la
release → commit du manifeste signé + `.sig` → relecture et comparaison d'empreinte.
Si une étape échoue, le manifeste n'est pas publié : les utilisateurs ne voient jamais une
version incomplète. La release brouillon orpheline peut être supprimée depuis l'admin.

## Canaux

- `stable` et `beta` : manifestes distincts (`versions/stable.json`, `versions/beta.json`).
- Le canal est un réglage utilisateur (Paramètres → Application) ; le gate relit le manifeste
  du canal choisi. Une release bêta est marquée `prerelease` sur GitHub.

## Signature de code Windows (limite documentée)

Les installateurs NSIS produits ici ne sont **pas** signés par un certificat de signature de
code acheté (EV/OV) : cela exige un certificat délivré à une entité vérifiée, hors périmètre
du projet. Conséquence réelle : SmartScreen peut afficher un avertissement à l'installation.
L'intégrité de la chaîne repose sur : empreintes SHA-256 des assets dans le manifeste signé,
signature Ed25519 du manifeste, et vérification de l'empreinte du script avant chaque
exécution. Si un certificat est obtenu plus tard, electron-builder le prend en charge via la
configuration `win.certificateFile` — sans changer l'architecture.

## Récupération après échec

- Téléchargement interrompu : electron-updater ne remplace rien avant vérification ;
  l'installation fonctionnelle reste intacte ; relancer la vérification suffit.
- Échec d'installation NSIS : l'installateur gère son propre rollback ; la version précédente
  reste en place et le gate redemandera la mise à jour au prochain lancement.
- Manifeste corrompu publié : l'app le rejette (signature/schéma) et reste sur la version
  installée ; corriger côté admin et republier (le commit Contents est atomique par fichier).
