# Guide de développement

## Prérequis

- **Node.js 20+** et npm 10+ (le développement se fait sur Windows, macOS ou Linux ;
  l'application cible Windows).
- **Git** pour publier sur le dépôt officiel via Teralynk Admin.
- Aucun autre prérequis : Electron est installé par npm.

## Installation

```bash
git clone <votre-dépôt> teralynk
cd teralynk
npm install          # workspaces : packages/*, apps/*
```

## Commandes

| Commande | Effet |
|---|---|
| `npm test` | Exécute la suite vitest (logique partagée, sécurité, ZIP, signatures) |
| `npm run typecheck` | `tsc --noEmit` sur shared, app et admin |
| `npm run dev:app` | Teralynk en dev : Vite (port 5173) + Electron (recharge manuelle) |
| `npm run dev:admin` | Teralynk Admin en dev (port 5174) |
| `npm run build -w @teralynk/app` | Compile renderer (Vite) + main/preload (esbuild) |
| `npm run build -w @teralynk/admin` | Idem pour l'admin |
| `npm run dist:app` | Installateur NSIS Windows (`apps/teralynk/release/`) |
| `npm run dist:admin` | Installateur NSIS Windows (`apps/admin/release/`) |
| `npm run gen:keys -- ./keys` | Génère la paire Ed25519 de signature |
| `node scripts/make-package.mjs <dir> <version> [canal] [min]` | Paquet ZIP de publication |
| `teralynk-setup.bat` (Windows, administrateur) | Assistants complet : exclusion Defender, fusion de sources, clé publique, `dist`, `make-package`, push Git, lancement de l'admin |
| `node scripts/make-delivery.mjs <version>` | **Livraison** : typecheck + tests + builds, puis ZIP source versionné (`delivery/teralynk-v<version>.zip`) avec `SHA256SUMS.txt` |

### Routine de livraison (« à chaque fois »)

Chaque livraison suit obligatoirement le même processus, automatisé par
`scripts/make-delivery.mjs` :

1. `npm run typecheck` — TypeScript strict sur shared, app et admin ;
2. `npx vitest run` — suite de tests (logique, sécurité, ZIP, signatures) ;
3. `npm run build -w @teralynk/app` et `-w @teralynk/admin` ;
4. **Si une étape échoue : aucun ZIP n'est produit** (pas de livraison cassée) ;
5. ZIP des sources versionné dans `delivery/`, contenant `SHA256SUMS.txt`
   (empreinte de chaque fichier) et `DELIVERY_INFO.txt` (version, date, vérifications).

Sont exclus du ZIP : `node_modules`, builds, releases, `keys/` (clés privées),
journaux et tout `.pem` autre que la clé publique embarquée. Incrémenter le numéro
de version à chaque livraison (semver).

## Architecture de compilation

- **Renderer** : Vite + React + TypeScript + Framer Motion. Alias :
  `@teralynk/shared` → source TS partagée, `@teralynk/ui-styles` → CSS du design system,
  `@` → `src/` de l'application.
- **Processus principal / preload** : bundle CJS unique par esbuild
  (`scripts/build-electron.mjs`), sorties dans `dist-electron/`. La clé publique de signature
  est copiée à côté du bundle (recherchée au démarrage).
- **Paquets** : electron-builder (NSIS). `apps/teralynk/electron-builder.yml` et
  `apps/admin/electron-builder.yml` sont volontairement séparés : aucun fichier de
  publication n'est mélangé entre les deux applications.

## Flux de travail quotidien

1. Modifier le code dans `apps/teralynk` (ou `apps/admin`).
2. `npm run typecheck` puis `npm test`.
3. `npm run dev:app` pour vérifier visuellement (l'introduction, le gate de mise à jour et le
   tableau de bord s'enchaînent ; en dev, le dépôt distant configuré est interrogé — s'il
   n'existe pas encore, l'écran de vérification affiche honnêtement l'échec, c'est attendu).
4. Compiler : `npm run build -w @teralynk/app`.
5. Pour une release : `npm run dist:app`, puis `scripts/make-package.mjs`, puis publication
   **via Teralynk Admin** (jamais de manipulation GitHub manuelle pour le contenu).

## Tests

La suite (`npm test`) couvre :

- politique de version (`compareSemver`, `decideUpdate` : obligatoire / facultative / à jour) ;
- schémas zod (cartes, annonces, sondages, manifestes, métadonnées de paquet) :
  rejet des données mal formées, des URLs non autorisées, des empreintes invalides ;
- cryptographie : SHA-256 (vecteur connu), comparaison en temps constant,
  signature Ed25519 (aller-retour, falsification d'un octet, mauvaise clé, signature tronquée) ;
- sécurité des chemins ZIP (Zip Slip, absolus, lecteurs, UNC) ;
- analyse de ZIP réels (paquet valide, archive source refusée, fichiers manquants,
  métadonnées invalides) ;
- assainissement des journaux (PAT, en-têtes Authorization, clés PEM) ;
- logique des sondages (fenêtres temporelles, honnêteté local/centralisé) ;
- moteur de recherche et filtres (aucun résultat inventé) ;
- gardes-fous statiques : aucun jeton dans l'app, un seul chemin vers le tableau de bord,
  aucune exécution automatique, liste blanche d'hôtes, séparation app/admin.

Ajouter un test = nouveau fichier `tests/*.test.ts`. Ne jamais « neutraliser » un test qui
échoue : corriger la cause.

## Conventions de code

- TypeScript strict partout (`noUncheckedIndexedAccess` activé).
- Toute donnée distante traverse un schéma zod **partagé** avant usage.
- Aucune opération sensible dans le renderer : IPC minimal, validation dans le main.
- Journaux : `log()` (app) et `addLog()` (admin) assainissent systématiquement les secrets.
- Pas de `catch` vides : chaque échec est journalisé ou remonté à l'UI avec sa cause.
- Design : uniquement les classes du design system (`packages/ui-styles`) ; les couleurs et
  effets sont des variables CSS centralisées (thèmes futurs = nouvelles valeurs de variables).
