# Teralynk

**Teralynk** est une application desktop premium (Windows) permettant de découvrir, consulter et
exécuter des scripts et des outils organisés en cartes interactives. Son contenu — catalogue,
annonces, sondages, versions — est distribué **exclusivement via GitHub** : aucun serveur
personnel, aucune base de données, aucun compte utilisateur.

**Teralynk Admin** est une application desktop indépendante réservée à la publication :
gestion du catalogue, des annonces, des sondages et création de releases GitHub depuis un ZIP.

---

## Ce que fait réellement le projet

| Fonction | État | Où |
|---|---|---|
| Introduction animée au lancement (logo, marque, transition) | ✅ implémentée | `apps/teralynk/src/pages/IntroScreen.tsx` |
| Vérification **obligatoire** des mises à jour (manifeste signé Ed25519) | ✅ implémentée | `apps/teralynk/electron/services/updates.ts` |
| Mise à jour automatique via electron-updater (releases GitHub) | ✅ implémentée (empaqueté) | idem |
| Tableau de bord premium (sidebar, topbar, transitions) | ✅ implémenté | `apps/teralynk/src/components/Shell.tsx` |
| Catalogue dynamique distant (cartes publiées sans recompilation) | ✅ implémenté | `content/catalog.json` signé |
| Recherche + filtres + tris réels sur le catalogue | ✅ implémentés | `apps/teralynk/src/lib/search.ts` |
| Détails de carte (prérequis, permissions, risques, notes de version) | ✅ implémentés | `apps/teralynk/src/features/CardDetail.tsx` |
| Exécution de scripts contrôlée (SHA-256, confirmation, console, arrêt) | ✅ implémentée | `apps/teralynk/electron/services/scripts/executor.ts` |
| Détection des runtimes (PowerShell, pwsh, Python, Node, Batch) | ✅ implémentée | `apps/teralynk/electron/services/scripts/runtimes.ts` |
| Annonces distantes (bannières, priorités, expiration) | ✅ implémentées | `content/announcements.json` signé |
| Sondages : centralisés (issues GitHub + réactions) **et** locaux (assumés non agrégés) | ✅ implémentés | `apps/teralynk/src/pages/PollsPage.tsx` |
| Favoris, préférences, historique — 100 % locaux | ✅ implémentés | `apps/teralynk/electron/services/prefs.ts` |
| Panel admin indépendant (jeton chiffré safeStorage, publication signée) | ✅ implémenté | `apps/admin/` |
| Publication de version depuis un ZIP (analyse, conflits, upload progressif, vérification) | ✅ implémentée | `apps/admin/electron/services/publish.ts` |
| Tests automatisés (logique, sécurité, ZIP, signatures) | ✅ exécutés (`npm test`) | `tests/` |

## Ce que le projet ne fait PAS (limites honnêtes)

- **Pas de votes anonymes centralisés.** Un JSON statique ne peut pas agréger des votes.
  Le mode centralisé utilise des **issues GitHub par option** : voter = réaction « +1 » publique,
  avec un jeton GitHub **personnel** de l'utilisateur (jamais le jeton administrateur).
  Le mode local est affiché comme **non agrégé**.
- **Pas de synchronisation entre appareils** (aucun compte) : favoris et préférences restent
  propres à chaque installation.
- **Pas d'installation automatique de runtimes** : si Python/Node manque, l'app l'explique.
- **Pas de mise à jour automatique en mode développement** (electron-updater n'opère que sur
  une application empaquetée) : l'écran de mise à jour le dit explicitement.
- **Pas de signature de code Windows (certificat EV/OV)** : les installateurs ne sont pas signés
  par un certificat acheté ; l'intégrité repose sur les empreintes SHA-256 + signatures Ed25519
  des manifestes. Voir `docs/updates.md`.

## Organisation du monorepo

```
teralynk/
├── packages/
│   ├── shared/        # Contrats zod, versionnement, crypto, zip-safety, redaction (source TS partagée)
│   └── ui-styles/     # Design system CSS centralisé (les 2 apps)
├── apps/
│   ├── teralynk/      # Application utilisateur (Electron + React + Vite + Framer Motion)
│   │   ├── electron/  #   Processus principal sécurisé + preload minimal
│   │   └── src/       #   Renderer : intro, gate, dashboard, pages
│   └── admin/         # Teralynk Admin (panel de publication indépendant)
├── scripts/           # Outils : build Electron, génération de clés, packaging ZIP
├── tests/             # Tests automatisés (vitest)
└── docs/              # Documentation (développement, GitHub, mises à jour, admin, scripts, dépannage)
```

## Démarrage rapide

```bash
npm install                 # dépendances + binaire Electron (postinstall ensure-electron)
npm test                    # suite de tests (logique + sécurité + ZIP + signatures)
npm run typecheck           # vérification TypeScript des 3 packages
npm run dev:app             # Teralynk en développement (Vite + Electron)
npm run dev:admin           # Teralynk Admin en développement
```

Compilation & distribution Windows :

```bash
npm run dist:app            # installateur NSIS dans apps/teralynk/release/
npm run dist:admin          # installateur NSIS dans apps/admin/release/
node scripts/make-package.mjs apps/teralynk/release <version> stable <min>
                            # paquet ZIP prêt pour Teralynk Admin
```

Publication (depuis Teralynk Admin, jamais à la main) :

```bash
npm run gen:keys -- ./keys  # paire Ed25519 (privée = admin uniquement, publique = app)
```

> ⚠️ La clé publique embarquée (`apps/teralynk/electron/signing-public-key.pem`) est un
> **placeholder de développement** : générez votre propre paire et remplacez-la AVANT toute
> distribution réelle, sinon quiconque posséderait une ancienne clé privée de dev pourrait
> signer des manifestes acceptés par votre build. Aucune clé privée n'est fournie avec ce dépôt.
```

Puis dans Teralynk Admin : connexion (jeton GitHub `public_repo`), Configuration → clé de
signature, puis Catalogue / Annonces / Sondages / Versions → Publier.

## Documentation

- [Guide de développement](docs/development.md)
- [Guide GitHub](docs/github.md) — dépôt, ressources publiées, sondages centralisés
- [Guide des mises à jour](docs/updates.md) — contrôle obligatoire, signature, distribution
- [Guide d'administration](docs/admin.md) — jeton, publication, format du paquet ZIP
- [Guide des scripts](docs/scripts.md) — cartes exécutables, runtimes, sécurité
- [Guide de dépannage](docs/troubleshooting.md)

## Sécurité (résumé)

- Electron : `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, CSP stricte,
  navigation et fenêtres externes sur liste blanche, permissions web refusées.
- IPC : chaque payload validé par zod dans le processus principal ; API preload figée.
- Contenu distant : signature Ed25519 vérifiée **avant** usage + schémas zod ; cache signé ;
  aucune donnée de démonstration.
- Scripts : hôtes GitHub uniquement, SHA-256 obligatoire, contenu montré, confirmation
  explicite, `spawn` sans shell, environnement nettoyé, arrêt contrôlé, historique local.
- Jetons : admin chiffré (safeStorage/DPAPI), jamais dans le renderer ni les journaux ;
  l'app utilisateur ne contient **aucun** jeton administrateur.
