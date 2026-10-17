# RAPPORT COMPLET — Teralynk v1.5.1

Date : 2026-10-17 · Auteur : Qwen (analyse + modifications) · Base de départ : v1.4.1
Versions livrées : **v1.5.0** puis **v1.5.1** · Zip final : `teralynk-v1.5.1.zip`
État : **aucune erreur** — typecheck 3 packages OK, 144/144 tests OK, builds app + admin OK.

---

## 1. Analyse complète du projet (état initial v1.4.1)

### 1.1 Architecture

Monorepo npm workspaces :

| Paquet | Rôle |
|---|---|
| `apps/teralynk` | Application utilisateur : Electron 31 + React 18 + Vite + Framer Motion. Intro animée → gate de mise à jour OBLIGATOIRE → shell (accueil, explorer, favoris, annonces, sondages, historique, paramètres). |
| `apps/admin` | Teralynk Admin : panel de publication indépendant (catalogue, annonces, sondages, versions) ; jeton GitHub chiffré (safeStorage), publication signée Ed25519. |
| `packages/shared` | Contrats zod (cartes, annonces, sondages, manifestes de version, paquet ZIP), semver, crypto Ed25519, zip-safety, validation URL Spotify, config centrale du dépôt GitHub (`REMOTE_CONFIG`). |
| `packages/ui-styles` | Design system CSS partagé (boot, components, layout, design-system). |
| `scripts/` | build-electron (esbuild), ensure-electron, generate-signing-keys, make-package (ZIP de publication), make-delivery (ZIP source versionné), patchs ponctuels. |
| `tests/` | Suite vitest (logique, sécurité, ZIP, signatures, IPC, musique). |

Sécurité (confirmée à l'analyse) : `contextIsolation: true`, `nodeIntegration: false`,
`sandbox: true`, CSP stricte en production, navigation sur liste blanche, IPC validé par zod
côté main, contenus distants signés Ed25519 vérifiés AVANT usage, scripts exécutés uniquement
après téléchargement + comparaison SHA-256 + confirmation explicite, aucun jeton admin dans
l'app utilisateur.

### 1.2 Chaîne de contenu et de versions

- `content/catalog.json` + `.sig`, `versions/stable.json` + `.sig` : publiés UNIQUEMENT via
  Teralynk Admin (commit signés sur `main`).
- Gate de démarrage : téléchargement du manifeste signé → vérification Ed25519 avec la clé
  publique embarquée → validation zod → décision (`decideUpdate`) : à jour / facultative /
  obligatoire / bloqué (hors-ligne sans cache, signature invalide…).
- Installation des mises à jour : electron-updater (provider GitHub) en mode empaqueté.

### 1.3 Fonctionnement du `teralynk-setup.bat` (analysé ligne à ligne)

1. `WORKDIR` = `Downloads\teralynk-v1.1.0` si présent (dossier historique contenant `keys\`),
   sinon le dossier du .bat.
2. `[1/8]` taskkill des process Electron résiduels.
3. `[2/8]` exclusion Defender du dossier release + diagnostic Smart App Control (UAC).
4. `[3/8]` fusion (robocopy) du dossier source le plus récent (`C:\v120` ou `Downloads\teralynk-v1.*`)
   vers WORKDIR, sans node_modules/.git/keys/release ni zips.
5. `[4/8]` copie de `keys\teralynk-signing-public.pem` vers `apps\teralynk\electron\signing-public-key.pem`
   (échec bloquant si la clé privée/publique locale est absente).
6. `[5/8]` `npm install` + purge anti-build-périmé du dossier `release\`.
7. `[6/8]` `npm run dist -w @teralynk/app` → `Teralynk-Setup-<VER>.exe` (VER lu dans
   `apps\teralynk\package.json`) ; contrôle de présence de l'exe nommé avec la bonne version.
8. `[7/8]` `node scripts\make-package.mjs … <VER> stable 1.0.0` → **`teralynk-<VER>-stable.zip`**
   (paquet de publication : métadonnées + installateur + latest.yml, empreintes SHA-256) +
   artefact portable si `win-unpacked` existe.
9. `[8/8]` commit + push git, puis lancement de Teralynk Admin pour publier le zip.

Amélioration apportée (bat v5) : la détection du dossier source le plus récent triait par
ordre alphabétique inversé (`dir /o-n`) → `teralynk-v1.10.0` serait passé AVANT `teralynk-v1.9.0`.
Remplacé par un tri **numérique** de version via PowerShell (clé = M×10⁸ + m×10⁴ + p),
structuré par `goto` pour éviter les pièges d'échappement cmd.

### 1.4 Flux de publication de l'utilisateur (confirmé)

zip source livré (ex. `teralynk-v1.5.1.zip`) → `.bat` → compilation → `teralynk-1.5.1-stable.zip`
→ Admin → Versions → sélection du zip → publication GitHub (12 étapes) → les apps reçoivent
la mise à jour via le manifeste signé.

---

## 2. Version 1.5.0 — diagnostics et corrections

### 2.1 BUG : « nouvelle version → installée → “l'appli va redémarrer” → rien »

**Cause racine** : `quitAndInstall()` ré-importait `electron-updater` et pouvait s'adresser à
une instance différente de celle ayant téléchargé (voire jamais initialisée via le repli
`new AppUpdater()`) → clic sans effet. Le message « Teralynk va redémarrer » s'affichait dès
la fin du téléchargement (promesse prématurée), sans watchdog ni retour d'état.

**Corrections** (`updates.ts`, `UpdateGate.tsx`, `ipc.ts`, `preload.ts`) :
- instance updater **unique** mémorisée (`cachedUpdater`) pour téléchargement ET installation ;
- message honnête après téléchargement (« Cliquez sur Installer et redémarrer… ») ;
- événement IPC `updates:installing` émis **seulement** quand electron-updater confirme le
  départ (`before-quit-for-update`) → écran animé « Redémarrage de Teralynk… » (triple anneau) ;
- **watchdog** : 2ᵉ tentative silencieuse à 12 s ; à 20 s sans départ, retour à un état
  actionnable (réessayer / fermer pour installer à la fermeture via `autoInstallOnAppQuit` /
  page des versions) — plus aucun écran figé ;
- `updates:install-now` renvoie un vrai statut `{ ok, error }`.

### 2.2 BUG : spotdl ne s'installait pas + bouton « Dossier… » inerte

**Cause racine** : dans `apps/teralynk/electron/ipc.ts`, les fonctions musique étaient
**importées mais JAMAIS enregistrées** : aucun `ipcMain.handle('music:*')` → chaque appel du
renderer échouait en « No handler registered » (silencieux côté UI).

**Corrections** : enregistrement des 8 canaux (`music:status`, `music:default-folder`,
`music:pick-folder`, `music:open-folder`, `music:install`, `music:install-ffmpeg`,
`music:download`, `music:stop`) avec validation zod de chaque payload + test de régression
`tests/ipc-surface.test.ts` (toute chaîne `invoke` du preload doit avoir son `handle`).

### 2.3 Nouveautés fonctionnelles 1.5.0

- **Dépendances en 1 clic obligatoire** : cartes animées Python / spotdl / ffmpeg ; ffmpeg
  installable automatiquement (build statique officiel BtbN/FFmpeg-Builds, téléchargement avec
  progression réelle, décompression tar/Expand-Archive, dossier géré
  `%LOCALAPPDATA%\Teralynk\tools`, injecté en tête du PATH des processus ; zéro modification système).
- **Boutons dossier** : « Dossier… » réparé + nouveau « Ouvrir le dossier » (Explorateur),
  aussi sur l'écran de succès.
- **Animations** : scène orbes + notes flottantes, étapes spring + reflet balayant, célébration
  confettis, barres scintillantes, points de suspension, journal en direct.
- **Admin** : sélection « spotdl » = carte **entièrement préremplie** (modèle complet : nom,
  descriptions, statut available, prérequis, permissions, capacités, risques, tags, notes) +
  bouton « (Ré)appliquer le modèle complet spotdl » pour corriger l'ancienne carte `musique1`.
- **Logo v1** (verre iridescent) + marque SVG redessinée + intro aurora/orbites.
- **Livraison** : `make-delivery.mjs` exige désormais un `README-v<version>.md` (aucun zip
  sans readme de version).

---

## 3. Version 1.5.1 — diagnostics et corrections

### 3.1 BUG : spotdl « Successfully installed » mais toujours proposé

**Cause racine** : sondage et lancement avec `python -I -m spotdl …`. Le mode **isolé** `-I`
EXCLUT le site-packages **utilisateur** de `sys.path` — exactement où `pip install --user`
installe (`%APPDATA%\Python\Python310\…`). pip installait correctement ; Teralynk ne voyait
rien ; l'exécution réelle aurait échoué de même.

**Corrections** (`spotdl.ts`, `runtimes.ts`, `api.ts`, `MusicDownloader.tsx`) :
- plus **aucun `-I`** (sondage, installation, exécution) ; environnement toujours nettoyé ;
- détection du module via `importlib.util.find_spec` (rapide, fiable) ; version lue via
  `importlib.metadata` ; détection Python rafraîchie à chaque vérification (`force=true`) ;
- **installation intelligente** : pré-vérification « déjà installé » (rien n'est réinstallé),
  post-vérification sur le même exécutable après pip, diagnostic explicite en cas de
  multi-Python, statut qui passe réellement au vert via l'événement `exit` → refresh ;
- transparence UI : version du module spotdl, version + chemin du Python (survol),
  provenance ffmpeg (système / géré).

### 3.2 Icônes d'application refaites (flat bold)

Le rendu « verre sombre » de la 1.5.0 était illisible en icône bureau (32-48 px).
Nouveaux icônes plein cadre : dégradé violet→cyan + marque blanche épaisse (Teralynk),
violet→rose + « A » (Admin) — lisibles dès 32 px.
Fichiers : `assets/logo-teralynk.png`, `apps/teralynk/build/icon.png`, `apps/admin/build/icon.png`.
Note Windows : si l'ancienne icône persiste sur le bureau → cache d'icônes Explorateur :
`ie4uinit.exe -show` ou redémarrage.

### 3.3 Verrou de régression

`tests/music-feature.test.ts` : interdit tout `-I` dans le service musique + exige la sonde
`find_spec`. Ce bug ne peut plus réapparaître silencieusement.

---

## 4. Fichiers modifiés / ajoutés

**v1.5.0** : `apps/teralynk/electron/services/updates.ts` · `apps/teralynk/electron/ipc.ts` ·
`apps/teralynk/electron/preload.ts` · `apps/teralynk/electron/services/music/spotdl.ts` ·
`apps/teralynk/src/lib/api.ts` · `apps/teralynk/src/pages/UpdateGate.tsx` ·
`apps/teralynk/src/features/MusicDownloader.tsx` (refonte) · `apps/teralynk/src/components/Icons.tsx` ·
`apps/teralynk/src/pages/IntroScreen.tsx` · `apps/admin/src/pages/CatalogPage.tsx` ·
`packages/ui-styles/boot.css` · `packages/ui-styles/components.css` · `scripts/make-delivery.mjs` ·
`teralynk-setup.bat` (v5) · `README.md` · `docs/updates.md` · `tests/ipc-surface.test.ts` (nouveau) ·
`README-v1.5.0.md` (nouveau) · icônes (3 fichiers).

**v1.5.1** : `apps/teralynk/electron/services/music/spotdl.ts` ·
`apps/teralynk/electron/services/scripts/runtimes.ts` · `apps/teralynk/src/lib/api.ts` ·
`apps/teralynk/src/features/MusicDownloader.tsx` · `tests/music-feature.test.ts` (+2 tests) ·
icônes regénérées (3 fichiers) · `README-v1.5.1.md` (nouveau) · `RAPPORT-v1.5.1.md` (ce fichier).

---

## 5. Vérifications exécutées avant production du zip final

| Vérification | Résultat |
|---|---|
| `npm run typecheck` (shared, app, admin — TS strict) | ✅ OK |
| `npx vitest run` — 12 fichiers, **144 tests** | ✅ 144/144 |
| `npm run build -w @teralynk/app` (renderer Vite + electron esbuild) | ✅ OK |
| `npm run build -w @teralynk/admin` | ✅ OK |
| Contrôle du zip : `.bat` présent à la racine, readmes de version, icônes, aucun `node_modules`, aucune clé privée, aucun jeton | ✅ OK |

Suite de tests : schemas-validation (28) · security-guards (24) · zip-inspect (6) ·
search-engine (20) · version-policy (9) · polls-logic (7) · crypto-signing (11) ·
music-feature (12 dont 2 régressions `-I`) · redaction (8) · zip-safety (10) ·
content-errors (5) · ipc-surface (4).

---

## 6. Procédure de publication (rappel opérationnel)

1. Dézipper `teralynk-v1.5.1.zip` ; double-cliquer `teralynk-setup.bat`
   → compile `Teralynk-Setup-1.5.1.exe` et produit `teralynk-1.5.1-stable.zip`.
2. Teralynk Admin → Versions → Parcourir → `teralynk-1.5.1-stable.zip` → Confirmer et publier
   (12 étapes vertes).
3. Utilisateurs : gate → mise à jour proposée → téléchargement progressif réel →
   « Installer et redémarrer » → redémarrage fiable (watchdog) → contrôle repris.
4. Recommandation : Admin → Catalogue → Modifier la carte musique →
   « (Ré)appliquer le modèle complet spotdl » → Publier le catalogue (l'ancienne carte
   publiée contient encore des libellés saisis à la main).

## 7. Limites honnêtes (inchangées, documentées)

- Installateurs non signés par certificat acheté → SmartScreen possible (contournements :
  artefact portable, exclusions Defender posées par le bat).
- Python ne s'installe pas automatiquement (bouton vers python.org + consigne « Add to PATH »).
- Téléchargement ffmpeg ≈ 90 Mo (build statique officiel), installé hors système.
- Cache d'icônes Windows peut nécessiter `ie4uinit.exe -show` après changement d'icône.
- Mode développement : pas d'installation automatique (limite réelle d'electron-updater).

---

*Fin du rapport — Teralynk v1.5.1, livré sans erreur.*
