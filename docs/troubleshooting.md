# Guide de dépannage

## Lire les journaux

- **Application** : Paramètres → Application → « Ouvrir » les journaux, ou
  `%APPDATA%/teralynk/logs/teralynk.log` (Windows). Rotation à 2 Mo.
- **Admin** : rubrique Journaux (historique des opérations) ; données locales dans
  `%APPDATA%/teralynk-admin/`.
- Tous les journaux sont assainis : jetons, en-têtes d'authentification et clés privées
  apparaissent masqués (`[REDACTED…]`). Un test vérifie cette propriété.

## Erreurs fréquentes

### `npm run dist` : « Cannot compute electron version from installed node modules »
Cause : les versions récentes de npm bloquent par défaut les scripts postinstall des
dépendances (avertissement `npm warn install-scripts … allowScripts`). Le script officiel
d'Electron (téléchargement du binaire) n'a donc pas tourné.
Solutions (dans l'ordre) :
1. Le postinstall du projet (`scripts/ensure-electron.mjs`) exécute automatiquement
   `electron/install.js` lors de `npm install` — refaites simplement `npm install`.
2. Sinon, approuvez puis rejouez : `npm install-scripts approve electron` puis `npm rebuild electron`.
3. Sinon, exécutez manuellement : `node node_modules/electron/install.js`.
Vérification : `npx electron --version` doit afficher la version (ex. v31.7.7) avant de relancer `dist`.

### `npm run dist` : même erreur ALORS QUE `npx electron --version` fonctionne
Cause : en monorepo npm workspaces, Electron est hissé (hoisted) dans le `node_modules` RACINE ;
or electron-builder ne cherche `node_modules/electron` que dans le dossier de l'application
(`apps/teralynk/node_modules/electron`, absent) et refuse ensuite la plage de version `^31.3.0`
(non « fixée »). Correctif livré depuis la v1.0.4 : Electron est **épinglé en version exacte**
(`"electron": "31.7.7"`) dans `apps/teralynk/package.json` et `apps/admin/package.json` —
`computeElectronVersion` accepte alors la valeur sans résolution de module.
Si vous devez reproduire le correctif sur une ancienne copie : remplacer `"electron": "^31.3.0"`
par `"electron": "31.7.7"` dans ces deux fichiers puis `npm install`.

### « Teralynk ne peut pas joindre GitHub… » au démarrage
Cause : pas de connexion, DNS, proxy, ou dépôt/branche configuré inexistant.
Action : bouton **Réessayer**. Si un cache signé valide existe et que la version installée
reste supportée, l'app propose le mode dégradé hors-ligne (bannière). Sinon l'accès reste
bloqué — c'est volontaire : la vérification est obligatoire.

### « La signature du manifeste de version est invalide »
Cause : manifeste modifié hors Teralynk Admin, clé publique de l'app différente de la clé
privée ayant signé, ou fichier `.sig` non republié après modification.
Action : republier depuis l'admin (qui signe systématiquement) ; vérifier que la clé publique
embarquée correspond à la clé privée configurée (`npm run gen:keys` régénère une paire —
à recopier côté app **avant** compilation).

### « Le fichier catalog.json publié est mal formé »
Cause : édition manuelle du JSON sur GitHub.
Action : ne jamais éditer le contenu à la main — publier via l'admin, qui valide par schéma
avant commit. L'application rejette un contenu invalide et sert le cache valide le cas échéant.

### Catalogue affiché « en cache »
Signification : dernière récupération réseau réussie > 15 min ou GitHub inaccessible.
Action : page Explorer → le badge d'origine l'indique ; Paramètres → Données locales →
« Vider le cache » pour forcer un rechargement strict.

### « Le runtime … n'est pas installé sur cet ordinateur »
Cause : carte exécutable dont le runtime (Python, Node, pwsh…) est absent.
Action : installer le runtime indiqué (lien fourni dans Paramètres → Exécution), relancer.
Teralynk n'installe rien sans accord explicite.

### « L'empreinte SHA-256 du script téléchargé ne correspond pas »
Cause : fichier modifié après publication (édition directe sur GitHub sans republication de
la carte), corruption réseau, ou attaque du canal.
Action : **ne pas contourner**. Republier la carte depuis l'admin avec la nouvelle empreinte
calculée localement, ou restaurer le fichier d'origine.

### Sondage centralisé : « Jeton GitHub refusé (401) »
Cause : jeton utilisateur expiré/révoqué, ou scope insuffisant.
Action : Paramètres (app) → jeton GitHub : enregistrer un nouveau PAT `public_repo`.
Le vote est une réaction +1 publique : un second vote sur la même issue est refusé par GitHub
(comportement normal).

### Admin : « Permissions insuffisantes » à la validation du jeton
Cause : scope manquant (`public_repo`/`repo`) ou jeton sans droit d'écriture sur le dépôt.
Action : l'erreur liste les scopes détectés ; régénérer un jeton avec le scope minimal requis
pour le type de dépôt (public/privé).

### Admin : publication échouée à l'étape « upload-assets »
Cause : réseau instable, asset > 2 Go (limite GitHub), rate-limit.
État : la release reste **en brouillon**, le manifeste n'est pas publié → aucun impact
utilisateur. Action : relancer la publication (les assets déjà présents sont revérifiés) ou
supprimer le brouillon depuis Versions → releases.

### Admin : « archive SOURCE » refusée
Cause : ZIP contenant le code du projet au lieu du paquet de publication.
Action : produire le paquet avec `scripts/make-package.mjs` (installateur + latest.yml +
`teralynk.package.json`).

### SmartScreen / avertissement Windows à l'installation
Cause réelle : installateurs non signés par un certificat de code acheté (voir
`docs/updates.md` §Signature de code Windows). L'intégrité est vérifiable via les empreintes
SHA-256 publiées dans le manifeste signé de la release.

## Procédures de récupération

- **Release brouillon orpheline** : Admin → Versions → bouton corbeille sur la ligne brouillon.
- **Manifeste de version incohérent** : republier la version concernée depuis l'admin
  (le commit Contents remplace atomiquement le fichier + `.sig`).
- **Préférences corrompues** : l'app repart des valeurs par défaut et le journalise ;
  Paramètres → Données locales → Réinitialiser pour un état propre.
- **Jeton admin compromis** : Configuration → Effacer le jeton, puis révoquer côté GitHub
  (Settings → Tokens). Aucun autre secret n'est stocké.

## Vérifier l'état du système

Paramètres → Diagnostic donne : version, système, Electron, dépôt configuré, connectivité
GitHub testée à la demande, dernier contrôle de mise à jour et son résultat. Aucune donnée
personnelle n'est collectée ni transmise.
