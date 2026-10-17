# Teralynk — README de la version 1.5.1

Date : 2026-10-17 · Base : v1.5.0 · Zip : `teralynk-v1.5.1.zip`

## 1. Corrigé — spotdl « Successfully installed » mais toujours proposé à l'installation

**Cause racine identifiée** : le service sondait et lançait spotdl avec
`python -I -m spotdl …`. Or le mode **isolé** de Python (`-I`) **exclut le
site-packages utilisateur** de `sys.path` — exactement l'endroit où
`pip install --user` installe spotdl (`%APPDATA%\Python\Python310\…`).
Résultat : pip installait correctement, Teralynk ne voyait rien, et
l'exécution réelle aurait échoué de la même façon.

**Corrections (`apps/teralynk/electron/services/music/spotdl.ts`)** :

- Plus **aucun `-I`** : sondage, installation et téléchargement utilisent le
  Python normal (le site user est visible). L'environnement reste nettoyé
  (secrets retirés, fenêtre masquée, sans shell).
- Détection du module via `importlib.util.find_spec` : **rapide** (pas
  d'import lourd de spotdl) et **fiable** ; la version affichée vient des
  métadonnées pip (`importlib.metadata`), pas d'un `--version` lent.
- Détection Python **rafraîchie à chaque vérification** (`force=true`) : un
  Python installé après le lancement de l'app est vu au clic suivant.

## 2. Nouveau — processus d'installation « intelligent »

- **Pré-vérification** : si le module spotdl existe déjà pour CE Python, rien
  n'est réinstallé ; retour immédiat « déjà installé » et carte qui passe au vert.
- **Post-vérification** sur le même exécutable après pip : si pip sort 0 mais
  que le module reste introuvable, message actionnable (plusieurs Python
  installés → lequel est premier dans le PATH), au lieu d'un faux succès.
- **Transparence** : la carte Python affiche version + chemin de l'exécutable
  (survol), la carte spotdl affiche la version du module installé.
- pip lancé sans `-I` : il voit désormais correctement les paquets déjà
  présents (utilisateur + système) et ne réinstalle plus tout.

## 3. Nouveau — icônes d'application redessinées (flat bold)

Le rendu « verre sombre » de la 1.5.0 était illisible en icône de bureau
(32-48 px). Nouveaux icônes **flat bold** : fond dégradé plein cadre
(violet→cyan pour Teralynk, violet→rose pour Teralynk Admin) + marque
blanche épaisse (hexagone + nœuds reliés / « A »), lisibles dès 32 px.
Fichiers : `assets/logo-teralynk.png`, `apps/teralynk/build/icon.png`,
`apps/admin/build/icon.png`.

> Astuce Windows : si l'ancienne icône reste affichée sur le bureau après
> installation, c'est le cache d'icônes de l'Explorateur : exécutez
> `ie4uinit.exe -show` (ou redémarrez) pour le rafraîchir.

## 4. Régression verrouillée par test

`tests/music-feature.test.ts` interdit désormais tout `-I` dans le service
musique et exige la sonde `find_spec` : ce bug ne peut pas réapparaître
silencieusement dans une version future.

## 5. Procédure de publication (rappel)

1. Dézipper `teralynk-v1.5.1.zip`, double-cliquer `teralynk-setup.bat`
   → compile `Teralynk-Setup-1.5.1.exe` et produit `teralynk-1.5.1-stable.zip`.
2. Teralynk Admin → Versions → sélectionner `teralynk-1.5.1-stable.zip` → publier.
3. Côté utilisateur : gate → mise à jour → installation → redémarrage fiable (v1.5.0).

## 6. Vérifications exécutées avant zip

`npm run typecheck` · `npx vitest run` · build renderer+electron des deux apps
(voir `DELIVERY_INFO.txt` et `SHA256SUMS.txt` dans ce zip).
