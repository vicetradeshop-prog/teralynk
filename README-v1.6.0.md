# Teralynk — README de la version 1.6.0

Date : 2026-10-17 · Base : v1.5.1 · Zip : `teralynk-v1.6.0.zip`

## 1. Corrigé — mise à jour : plus d'assistant « suivant, suivant »

**Demande** : après le clic sur « Installer et redémarrer », l'installateur NSIS s'ouvrait
en mode assisté (écrans Suivant/Suivant).
**Correction** (`apps/teralynk/electron/services/updates.ts`) : `quitAndInstall(true, true)`
systématique — mode **silencieux** (`/S`) : l'installateur réutilise le répertoire
d'installation existant, n'affiche **aucun** écran, puis relance Teralynk automatiquement
(`isForceRunAfter=true`). Le watchdog 12 s/20 s de la 1.5.0 reste actif (retour à un état
actionnable si un antivirus bloque le départ).
Message du gate mis à jour : « l'installation est entièrement automatique (silencieuse,
sans assistant ni “suivant”) ».

## 2. Corrigé — scroll molette impossible dans les fiches/cartes modales

**Cause racine** : `.tl-modal-body` est un enfant flex (`flex: 1`) sans `min-height: 0`.
Un enfant flex ne peut pas descendre sous la hauteur de son contenu (`min-height: auto`) :
le corps débordait de la modale et était rogné par `overflow: hidden` **sans jamais devenir
un conteneur scrollable** → la molette ne faisait rien.
**Correction** (`packages/ui-styles/components.css`) : `min-height: 0` + `overscroll-behavior:
contain` + scrollbar fine assortie (dégradé violet→cyan). Toutes les modales (fiche carte,
musique, consoles, éditeurs admin) en bénéficient.

## 3. Nouveau — cartes de fonctionnalités : mêmes tailles, premium, animées

- **Taille strictement uniforme** : grille `grid-auto-rows: 1fr` + carte `height: 100 %`
  (min 236 px) + description clampée à 2 lignes + pied aimanté (`margin-top: auto`) :
  toutes les cartes font exactement la même hauteur, quel que soit leur contenu.
- **Design premium** : fond double dégradé, coins 16 px, reflet radial suivant le curseur,
  **balayage brillant diagonal** au survol, élévation -5 px + halo violet, socle d'icône
  dégradé qui grossit/pivote au survol, titre tronqué proprement, favoris avec rotation
  au survol, carte mise en avant = **anneau dégradé animé** tout autour (mask-composite).
- Entrée en cascade conservée (stagger) + tap scale.

## 4. Nouveau — barre de navigation et interfaces beaucoup plus stylées

- Sidebar : fond dégradé profond + **aurora** violette/cyan en haut et bas, marque avec
  **halo pulsant**, nom en dégradé de texte, items qui glissent au survol avec icône
  lumineuse, pilule active dégradée + barre latérale néon, badges dégradés, séparateurs
  lumineux, pilule de version à **anneau dégradé animé** + point pulsant.
- Topbar : verre dépoli + **liseré dégradé animé** sous la barre.
- Titres de page en dégradé subtil ; scrollbars principales assorties ; sélection de
  texte aux couleurs de la marque.

## 5. Nouveau — icône d'application VECTORIEL (raccourci bureau)

Fini les rendus approximatifs : l'icône est désormais un **SVG vectoriel** rasterisé
(net à toutes les tailles, y compris 32 px) : tuile sombre arrondie, hexagone néon
épais violet→cyan avec halo, deux nœuds glassy reliés par un faisceau, étincelles.
Variante Admin : hexagone violet→rose + « A ». Sources vectorielles conservées dans le
dépôt : `assets/logo-teralynk.svg`, `assets/logo-admin.svg` (reproductibles, modifiables).
Rappel : si l'ancienne icône reste affichée après installation → cache Windows :
`ie4uinit.exe -show` ou redémarrage.

## 6. Procédure de publication (rappel)

1. Dézipper `teralynk-v1.6.0.zip` → `teralynk-setup.bat` → compile `Teralynk-Setup-1.6.0.exe`
   et produit `teralynk-1.6.0-stable.zip`.
2. Admin → Versions → sélectionner le zip → publier (12 étapes vertes).
3. Utilisateurs : gate → mise à jour → téléchargement → « Installer et redémarrer » →
   installation **silencieuse** → relance automatique → contrôle de version.

## 7. Vérifications exécutées avant zip

`npm run typecheck` · `npx vitest run` (144 tests) · builds renderer+electron des deux apps
(voir `DELIVERY_INFO.txt` et `SHA256SUMS.txt`).
