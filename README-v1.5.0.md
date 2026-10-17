# Teralynk — README de la version 1.5.0

Date : 2026-10-17 · Base : v1.4.1 · Zip : `teralynk-v1.5.0.zip`

## 1. Corrigé — mise à jour : « l'appli va redémarrer »… mais ne redémarrait pas

**Cause racine identifiée** : `quitAndInstall()` ré-importait `electron-updater` et pouvait
s'adresser à une **instance différente** de celle qui avait téléchargé la mise à jour
(voire une instance jamais initialisée) → le clic ne produisait strictement rien.
De plus, le message « Teralynk va redémarrer » s'affichait dès la **fin du téléchargement**,
avant toute action, et aucun filet de sécurité n'existait si l'installateur ne prenait pas la main.

**Corrections (`apps/teralynk/electron/services/updates.ts`, `UpdateGate.tsx`, `ipc.ts`, `preload.ts`)** :

- Instance **unique** d'electron-updater mémorisée pour toute la session : le téléchargement
  et l'installation utilisent la même.
- Nouveau message honnête après téléchargement : « Cliquez sur “Installer et redémarrer” :
  Teralynk se ferme, l'installateur s'exécute, puis l'application rouvre ce contrôle de version. »
- Événement IPC `updates:installing` émis **uniquement quand electron-updater confirme
  qu'il quitte pour installer** (`before-quit-for-update`) → écran animé
  « Redémarrage de Teralynk… » (triple anneau orbital) au lieu d'un texte prometteur.
- **Watchdog** : 2e tentative silencieuse à 12 s ; à 20 s sans départ, retour à un état
  **actionnable** (message clair + « Installer et redémarrer » réactivé + rappel que
  l'installation se lance automatiquement à la fermeture + page des versions).
  Plus jamais d'écran figé.
- `updates:install-now` renvoie désormais un vrai statut `{ ok, error }` au lieu d'un `ok` systématique.

## 2. Corrigé — spotdl : installation et bouton dossier morts dans l'interface utilisateur

**Cause racine identifiée** : les fonctions musique étaient **importées mais JAMAIS enregistrées**
dans `apps/teralynk/electron/ipc.ts` → chaque appel du renderer (`music:install`,
`music:pick-folder`, `music:status`, `music:download`, `music:stop`, `music:default-folder`)
échouait en « No handler registered ». D'où : spotdl qui ne s'installe pas, bouton
« Dossier… » inerte, statut vide.

**Corrections** : les 8 canaux IPC musique sont enregistrés, chacun avec validation zod
du payload (même niveau de sécurité que le reste de la surface IPC).

## 3. Nouveau — dépendances installables en un clic (obligatoire)

- Panneau « Dépendances requises » : trois cartes animées **Python / spotdl / ffmpeg**
  avec statut réel (pastille pulsante), et un **bouton d'installation par dépendance** :
  rien n'est jamais installé sans un clic volontaire de l'utilisateur.
  - Python : bouton « Télécharger Python » (page officielle) + consigne « Add to PATH ».
  - spotdl : case de consentement explicite + bouton « Installer spotdl » (pip --user).
  - ffmpeg : bouton « Installer ffmpeg (auto) » → téléchargement du **build statique
    officiel** (releases GitHub BtbN/FFmpeg-Builds, ~90 Mo) avec **progression réelle**,
    décompression dans `%LOCALAPPDATA%\Teralynk\tools`, utilisation automatique par spotdl
    (injecté en tête du PATH des processus). Aucun changement système, aucun admin.
- Journal en direct ouvert automatiquement pendant une installation (sortie réelle pip / téléchargement).

## 4. Corrigé + nouveau — dossiers

- « Dossier… » : vraie boîte de dialogue système (fonctionne désormais).
- Nouveau bouton « Ouvrir le dossier » (Explorateur Windows) dans la ligne dossier
  **et** dans l'écran de célébration après un téléchargement réussi.

## 5. Nouveau — interface musique beaucoup plus animée

- Scène de fond : orbes dérivants flous + notes de musique flottantes.
- Cartes de dépendances : entrée en cascade, respiration pendant installation,
  halo vert quand prêt, survol surélevé.
- Étapes : transitions spring, reflet qui balaie la ligne active.
- Succès : panneau de célébration (check spring + confettis animés) + ouverture du dossier.
- Barres de progression scintillantes, points de suspension animés, égaliseur conservé.

## 6. Nouveau — panel admin : carte spotdl préremplie

- Choisir « Téléchargeur de musique (spotdl) » dans « Interface native dédiée »
  **préremplit immédiatement TOUTE la carte** : nom, descriptions courte/longue, catégorie,
  icône, statut `available`, plateformes, prérequis, permissions, capacités, risques,
  tags, notes de version.
- Bouton « (Ré)appliquer le modèle complet spotdl » sur toute carte spotdl existante
  (permet de corriger en un clic l'ancienne carte « musique1 » puis de republier le catalogue).

## 7. Nouveau — logo redessiné (application + admin)

- Nouvel icône premium : hexagone de verre iridescent violet→cyan, nœuds lumineux reliés
  par un faisceau, reflets et halo (`assets/logo-teralynk.png`, `apps/teralynk/build/icon.png`,
  `apps/admin/build/icon.png` en variante magenta « A »).
- Marque SVG inline (`TeralynkMark`) redessinée avec dégradés, halo et étincelles :
  identique à l'icône dans l'intro, la sidebar et le pied de l'écran de vérification.
- Intro enrichie : aurora conique tournante + deux particules en orbite autour du logo.

## 8. Procédure de publication (inchangée, rappel)

1. Dézipper `teralynk-v1.5.0.zip` (ou laisser le `.bat` fusionner depuis Downloads).
2. Double-cliquer `teralynk-setup.bat` → compilation → `teralynk-1.5.0-stable.zip` produit.
3. Teralynk Admin → Versions → Parcourir → sélectionner `teralynk-1.5.0-stable.zip` →
   Confirmer et publier (12 étapes vertes).
4. Utilisateurs : le gate propose la mise à jour ; installation + redémarrage désormais fiables.

## 9. Vérifications exécutées avant zip

`npm run typecheck` · `npx vitest run` · build renderer+electron des deux apps
(voir `DELIVERY_INFO.txt` et `SHA256SUMS.txt` dans ce zip).
