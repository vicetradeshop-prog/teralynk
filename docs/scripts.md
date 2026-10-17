# Guide des scripts — cartes exécutables, runtimes et sécurité

## Anatomie d'une carte exécutable

Une carte du catalogue (`content/catalog.json`) devient exécutable lorsqu'elle déclare :

```json
"script": {
  "runtime": "powershell",
  "url": "https://raw.githubusercontent.com/<owner>/<repo>/main/scripts/mon-script.ps1",
  "sha256": "<empreinte hexadécimale 64 caractères du fichier>",
  "args": [],
  "requiresAdmin": false
}
```

Règles imposées par le schéma partagé (refus à la publication sinon) :

- `runtime` ∈ `powershell | pwsh | python | node | batch | info`
  (`info` = carte purement informative, **jamais** exécutable) ;
- `url` en **https** vers un hôte GitHub de distribution uniquement
  (`raw.githubusercontent.com`, `github.com`, `objects.githubusercontent.com`,
  `release-assets.githubusercontent.com`) ;
- `sha256` **obligatoire** dès qu'un runtime réel est déclaré ;
- `status` ∈ `available | new | experimental` pour être exécutable ;
  `soon` / `unavailable` désactivent l'exécution avec explication affichée.

Calcul de l'empreinte :

```bash
# Windows
certutil -hashfile mon-script.ps1 SHA256
# Linux / macOS
sha256sum mon-script.ps1
```

## Runtimes pris en charge

| Runtime | Exécutable (Windows) | Invocation | Prérequis |
|---|---|---|---|
| `powershell` | `powershell.exe` | `-NoProfile -NonInteractive -ExecutionPolicy Bypass -File <script>` | inclus Windows |
| `pwsh` | `pwsh.exe` | `-NoProfile -NonInteractive -File <script>` | PowerShell 7 installé |
| `python` | `python.exe` / `python3` | `-I <script>` (mode isolé) | Python 3 installé |
| `node` | `node.exe` | `<script>` | Node.js installé |
| `batch` | `cmd.exe` | `/d /s /c "<script>"` | inclus Windows |

Détection : Teralynk probe chaque runtime au besoin (`where`/`which` + probe de version).
Un runtime absent → message explicite avec conseil d'installation ; **rien n'est installé
automatiquement**. État visible dans Paramètres → Exécution.

## Cycle d'exécution (rien n'est automatique)

1. **Carte consultée** : aucune téléchargement, aucune exécution.
2. **« Préparer l'exécution »** : le processus principal revalide la carte (schéma), vérifie
   plateforme/statut/runtime, télécharge le script (hôte autorisé), calcule son SHA-256 et le
   compare à l'empreinte du manifeste. Toute divergence → **refus** (message + détail).
3. **Écran de préparation** : objectif, version, origine, systèmes, prérequis, permissions,
   opérations principales, risques connus, **contenu du script**, avertissement si
   `requiresAdmin`. Confirmation explicite obligatoire (« J'ai compris, exécuter ce script »).
4. **Exécution** : jeton de préparation à usage unique ; `spawn(exécutable, args)` **sans
   shell** ; arguments fixes du manifeste uniquement (jamais d'entrée utilisateur concaténée) ;
   environnement nettoyé (variables `*TOKEN*`, `*SECRET*`, `*KEY*`, `*PASSWORD*`… supprimées) ;
   répertoire de travail isolé (`userData/scripts/<slug>@<version>`).
5. **Console de suivi** : stdout et stderr distingués et horodatés, durée mesurée, code de
   sortie affiché, bouton d'arrêt (arbre de processus : `taskkill /T /F` sous Windows,
   groupe de processus POSIX sinon).
6. **Historique local** : exécutions, arrêts et échecs consignés localement (rétention réglable).

## Sécurité — règles absolues

- Provenir du dépôt officiel **ne rend pas un script inoffensif** : l'UI le dit, les risques
  déclarés sont affichés, le contenu est consultable avant confirmation.
- `requiresAdmin: true` est **affiché**, jamais exaucé automatiquement (pas d'élévation).
- Taille maximale d'un script : 2 Mo (au-delà : refus).
- Jeton de préparation : 48 hex, TTL 10 min, usage unique ; une seconde exécution exige une
  nouvelle préparation (donc une nouvelle vérification d'intégrité).
- Aucune exécution au seul affichage d'une carte, au seul téléchargement, ou au seul démarrage
  de l'application (garde-fous testés dans `tests/security-guards.test.ts`).
- Le rendu (renderer) ne peut pas demander d'exécution directe : seul un jeton valide issu de
  `scripts:prepare` (main) permet `scripts:execute`.

## Règles éditoriales des scripts publiés

Un script publié doit : respecter les lois applicables ; ne voler aucune information ;
ne déployer aucun logiciel malveillant ; ne contourner aucune protection ; déclarer ses
opérations sensibles dans `capabilities`/`permissions`/`knownRisks`. Toute carte mentant sur
ses effets doit être dépubliée — l'empreinte SHA-256 lie le fichier publié à sa déclaration.

## Cartes à interface native (`featureUi`)

Une carte peut embarquer une **interface native** livrée avec l'application
(champ `featureUi`), sans script distant : l'ouverture de la carte affiche
l'expérience dédiée au lieu de la fenêtre de détails générique.

- `featureUi: "music-downloader"` : téléchargeur de musique Spotify (spotdl).
  - Prérequis détectés automatiquement : Python 3, spotdl, ffmpeg.
  - Installation de spotdl : `pip install --user spotdl`, fenêtres masquées,
    **uniquement après consentement explicite** (case à cocher dans l'interface).
  - Téléchargement : `python -I -m spotdl <url> --output <dossier>` ; l'URL est
    validée (https, domaine `*.spotify.com`, types track/album/playlist/artist)
    et passée en argument unique, sans shell.
  - Événements streamés vers l'UI (étapes, sortie, erreurs, code de sortie) ;
    arrêt possible ; aucune console ne s'ouvre.
  - FAQ intégrée (MP3, lecteur MP3, MP4, téléphone, ffmpeg, légalité).
- Toute nouvelle interface native = modification du code de l'application
  (donc nouvelle version), conformément à la distinction contenu/code.

## Ajouter un runtime supplémentaire

L'architecture est extensible : ajouter l'identifiant dans `runtimeIdSchema`
(`packages/shared/src/schemas.ts`), une sonde dans
`apps/teralynk/electron/services/scripts/runtimes.ts` et une invocation dans
`buildInvocation()` de `executor.ts`. Aucun autre module n'est impacté.
