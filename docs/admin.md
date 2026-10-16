# Guide d'administration — Teralynk Admin

Teralynk Admin est une application desktop **indépendante** de Teralynk. Elle ne contient
aucune donnée de l'app utilisateur et n'est jamais distribuée avec elle.

## Première configuration

1. `npm run gen:keys -- ./keys` à la racine du monorepo.
   - `keys/teralynk-signing-private.pem` : **reste sur cet ordinateur** (gitignoré).
   - Copier `keys/teralynk-signing-public.pem` vers
     `apps/teralynk/electron/signing-public-key.pem` **avant** de compiler l'app utilisateur.
2. Créer un jeton GitHub : Settings → Developer settings → Personal access tokens.
   - Dépôt public : scope `public_repo`. Dépôt privé : scope `repo`.
   - Durée de vie limitée ; périmètre restreint au dépôt officiel.
3. Lancer `npm run dev:admin` (ou l'installateur compilé), coller le jeton (champ masqué),
   valider : l'admin vérifie l'identité, les scopes et les droits d'écriture sur le dépôt
   configuré, puis chiffre le jeton via safeStorage (DPAPI sur Windows).
4. Configuration → Clé de signature : sélectionner `teralynk-signing-private.pem`.
   Sans clé, toute publication est refusée (l'app utilisateur exige des contenus signés).

Le jeton n'est jamais affiché en clair après enregistrement, jamais écrit dans les journaux
(assainissement), jamais transmis au renderer (IPC : statuts uniquement).

## Rubriques

### Vue d'ensemble
Manifestes publiés par canal, releases récentes, activité locale (journal).

### Catalogue
- Créer / modifier / dupliquer / supprimer / dépublier des cartes.
- Validation en direct par le schéma partagé : une carte `available`/`new` exige un script avec
  empreinte SHA-256 ; une URL de script hors hôtes GitHub est refusée ; etc.
- « Publier sur GitHub » : validation finale zod côté main, signature Ed25519, commit de
  `content/catalog.json` + `content/catalog.json.sig`. Les applications reçoivent le nouveau
  catalogue sans recompilation.
- Échec de publication : cause affichée (HTTP GitHub, scopes), rien n'est écrasé silencieusement.
  Si le JSON est committé mais pas le `.sig`, l'app rejette le contenu (échec sûr) : republier.

### Annonces
Même flux : éditeur complet (catégorie, priorité, expiration, illustration https GitHub),
publication signée de `content/announcements.json`. Une annonce retirée disparaît des apps
(cache écrasé à chaque récupération réussie).

### Sondages
- Mode **github** (centralisé) : à la publication, l'admin crée une issue par option et
  enregistre les `issueNumber`. Fermer un sondage = statut `closed` (publication requise) ;
  les issues peuvent être fermées manuellement sur GitHub pour geler les votes.
- Mode **local** : publication simple ; l'app affiche que le vote n'est pas agrégé.
- Le panel n'affiche aucun résultat global inventé.

### Versions et mises à jour — publier depuis un ZIP

**Format du paquet (stable, documenté)** — ZIP à racine plate :

```
teralynk.package.json        # métadonnées (packageMetadataSchema)
Teralynk-Setup-X.Y.Z.exe     # installateur NSIS (electron-builder)
latest.yml                   # manifeste electron-updater (recommandé)
```

`teralynk.package.json` :

```json
{
  "packageFormat": 1,
  "app": "teralynk",
  "version": "1.2.0",
  "channel": "stable",
  "files": ["Teralynk-Setup-1.2.0.exe", "latest.yml"],
  "updaterManifest": "latest.yml",
  "minSupportedVersion": "1.0.0",
  "title": "Teralynk 1.2.0",
  "notes": "…notes de version…",
  "builtAt": "2025-06-01T10:00:00.000Z"
}
```

Production du paquet :

```bash
npm run dist -w @teralynk/app
# OPTIONNEL : placer un fichier RELEASE_NOTES.md dans le dossier release
node scripts/make-package.mjs apps/teralynk/release 1.2.0 stable 1.0.0
```

Wizard de publication (5 étapes) :

1. **Sélection** via la boîte de dialogue système (nom, taille, date de modification).
2. **Analyse** : entrées listées sans extraction ; chemins dangereux (Zip Slip, absolus,
   lecteurs, UNC) → archive rejetée ; archive source détectée et expliquée ; fichiers déclarés
   vs présents ; métadonnées validées.
3. **Métadonnées** : version, titre, notes, canal, `minSupportedVersion`, pré-release.
   Conflits détectés : tag existant, version non supérieure à la dernière du canal → refus.
4. **Récapitulatif** + confirmation explicite (opérations listées).
5. **Publication** : jeton validé → release brouillon → upload (progression réelle en octets) →
   vérification des assets → publication → commit du manifeste signé → contrôle final
   (relecture + empreinte). Étapes affichées en direct ; échec = état récupérable documenté
   (release brouillon supprimable depuis l'admin ; manifeste non publié).

### Ressources
Lecture seule des fichiers publiés (validation de schéma affichée, blob sha, lien GitHub).

### Journaux
Historique local des opérations (statuts en attente/en cours/réussie/échouée), assaini,
vidable. Aucun secret.

### Configuration
Dépôt (owner/repo/branche), clé de signature, état du jeton et scopes, effacement du jeton,
emplacement des données locales.

## Ce que l'admin ne fait pas

- Il ne stocke aucun brouillon sur GitHub (brouillons locaux uniquement, `userData`).
- Il n'élève aucun privilège, n'exécute aucun contenu de ZIP pendant la validation.
- Il ne publie jamais ses propres artefacts dans les releases de Teralynk (builders séparés).
- Il ne journalise jamais le jeton (redaction systématique).
