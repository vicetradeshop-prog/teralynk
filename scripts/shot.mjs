#!/usr/bin/env node
/**
 * Outil de capture d'écran DESIGN (développement uniquement).
 * Sert le renderer compilé (apps/teralynk/dist) en local et injecte un mock de
 * window.teralynk AVANT le chargement de la page : le code produit n'est pas
 * modifié et aucune donnée fictive n'entre dans l'application livrée.
 *
 * Usage : node scripts/shot.mjs [dossier-sortie]
 * Prérequis : npm run build:renderer -w @teralynk/app
 *             npm i --no-save puppeteer   (outil local, non livré aux utilisateurs)
 */
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'apps/teralynk/dist');
const outDir = path.resolve(process.argv[2] ?? path.join(root, 'shots'));
mkdirSync(outDir, { recursive: true });

if (!existsSync(path.join(distDir, 'index.html'))) {
  console.error('Renderer non compilé : npm run build:renderer -w @teralynk/app');
  process.exit(1);
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(distDir, urlPath === '/' ? 'index.html' : urlPath);
  if (!file.startsWith(distDir) || !existsSync(file)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(4173, r));

/* ---------------- Données de capture (design uniquement) ---------------- */
const NOW = '2026-10-17T10:00:00.000Z';
const SHA = 'a'.repeat(64);
const card = (over) => ({
  id: 'c', slug: 'c', name: 'Carte', description: 'Description.', category: 'Divers',
  icon: 'sparkles', tags: [], status: 'soon', platforms: ['windows'], requirements: [],
  permissions: [], capabilities: [], knownRisks: [], riskLevel: 'low', featured: false,
  enabled: true, createdAt: NOW, updatedAt: NOW, ...over
});

const DATA = {
  now: NOW,
  info: { appVersion: '1.3.0', electronVersion: '31.7.7', platform: 'win32', arch: 'x64', osRelease: '10.0.26200', locale: 'fr-FR', packaged: true, repoUrl: 'https://github.com/vicetradeshop-prog/teralynk', releasesUrl: 'https://github.com/vicetradeshop-prog/teralynk/releases', remote: { owner: 'vicetradeshop-prog', repo: 'teralynk', branch: 'main' } },
  githubStatus: { reachable: true, latencyMs: 42 },
  updateGate: {
    outcome: { state: 'up-to-date', offline: false, manifest: { schemaVersion: 1, channel: 'stable', latest: { version: '1.3.0', channel: 'stable', title: 'Teralynk 1.3.0', notes: 'Nouvelle interface.', publishedAt: NOW, tag: 'v1.3.0', minSupportedVersion: '1.0.0', files: [] }, history: [] } },
    installedVersion: '1.3.0', channel: 'stable', checkedAt: NOW, canAutoInstall: true,
    releasesUrl: 'https://github.com/vicetradeshop-prog/teralynk/releases'
  },
  catalog: { ok: true, source: 'network', fetchedAt: NOW, stale: false, data: { schemaVersion: 1, generatedAt: NOW, cards: [
    card({ id: 'spotdl-music', slug: 'spotdl-music', name: 'Téléchargeur de musique Spotify', description: 'Collez un lien Spotify : Teralynk télécharge, convertit en MP3 tagué avec pochette, dans le dossier de votre choix. Installation de spotdl intégrée.', category: 'Musique', tags: ['musique', 'spotify', 'mp3'], status: 'available', featured: true, icon: 'sparkles', featureUi: 'music-downloader', version: '1.0.0', updatedAt: '2026-10-17T09:00:00.000Z', createdAt: '2026-10-17T09:00:00.000Z' }),
    card({ id: 'net-clean', slug: 'net-clean', name: 'Nettoyage réseau avancé', description: 'Réinitialise la pile réseau Windows (Winsock, DNS, cache) et rétablit les adaptateurs sans redémarrage.', category: 'Réseau', tags: ['réseau', 'winsock', 'dns'], status: 'available', featured: true, icon: 'globe', version: '2.1.0', script: { runtime: 'powershell', url: 'https://raw.githubusercontent.com/vicetradeshop-prog/teralynk/main/scripts/net-clean.ps1', sha256: SHA }, capabilities: ['Vidage du cache DNS', 'Réinitialisation Winsock'], permissions: ['Modification des adaptateurs réseau'], updatedAt: '2026-10-12T10:00:00.000Z' }),
    card({ id: 'disk-health', slug: 'disk-health', name: 'Rapport de santé disque', description: 'Génère un rapport lisible de l’état S.M.A.R.T, de l’usure et de l’espace réel de vos volumes.', category: 'Système', tags: ['disque', 'smart'], status: 'new', icon: 'layers', version: '1.3.0', script: { runtime: 'powershell', url: 'https://raw.githubusercontent.com/vicetradeshop-prog/teralynk/main/scripts/disk.ps1', sha256: SHA }, featured: true, createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z' }),
    card({ id: 'vault-backup', slug: 'vault-backup', name: 'Sauvegarde chiffrée des documents', description: 'Archive et chiffre vos dossiers choisis (AES-256) vers un emplacement local ou un disque externe.', category: 'Sécurité', tags: ['sauvegarde', 'chiffrement'], status: 'available', icon: 'shield', version: '3.0.2', script: { runtime: 'python', url: 'https://raw.githubusercontent.com/vicetradeshop-prog/teralynk/main/scripts/vault.py', sha256: SHA }, riskLevel: 'medium', permissions: ['Lecture des dossiers choisis', 'Écriture sur le disque cible'], knownRisks: ['Un mot de passe perdu rend l’archive illisible'], updatedAt: '2026-10-10T10:00:00.000Z' }),
    card({ id: 'gh-watch', slug: 'gh-watch', name: 'Veille du dépôt GitHub', description: 'Surveille releases, issues et commits du dépôt officiel et résume les changements chaque semaine.', category: 'GitHub', tags: ['github', 'veille'], status: 'soon', icon: 'star', unavailableReason: 'En finalisation : gestion des dépôts privés prévue pour la 1.4.', updatedAt: '2026-10-08T10:00:00.000Z' }),
    card({ id: 'boot-opt', slug: 'boot-opt', name: 'Optimiseur de démarrage', description: 'Analyse les programmes au démarrage et propose des désactivations sûres, mesurées chronomètre en main.', category: 'Système', tags: ['démarrage', 'performance'], status: 'experimental', icon: 'flask', version: '0.9.1', script: { runtime: 'powershell', url: 'https://raw.githubusercontent.com/vicetradeshop-prog/teralynk/main/scripts/boot.ps1', sha256: SHA }, knownRisks: ['Certaines désactivations sont réversibles uniquement manuellement'], updatedAt: '2026-10-16T10:00:00.000Z' }),
    card({ id: 'log-sift', slug: 'log-sift', name: 'Analyseur de journaux', description: 'Filtre et colore les journaux Windows (EVTX) pour isoler les erreurs réelles en quelques secondes.', category: 'Système', tags: ['journaux', 'diagnostic'], status: 'unavailable', icon: 'terminal', unavailableReason: 'Retiré temporairement : changement d’API Windows en cours d’adaptation.', updatedAt: '2026-09-28T10:00:00.000Z' }),
    card({ id: 'hosts-guard', slug: 'hosts-guard', name: 'Garde du fichier hosts', description: 'Verrouille et audite le fichier hosts contre les modifications silencieuses de logiciels tiers.', category: 'Sécurité', tags: ['hosts', 'audit'], status: 'available', icon: 'shield', version: '1.1.4', script: { runtime: 'batch', url: 'https://raw.githubusercontent.com/vicetradeshop-prog/teralynk/main/scripts/hosts.cmd', sha256: SHA }, updatedAt: '2026-10-05T10:00:00.000Z' }),
    card({ id: 'snap-ui', slug: 'snap-ui', name: 'Captures d’écran annotées', description: 'Capture une zone, annotez flèches et textes, exportez en PNG propre — sans outil externe.', category: 'Productivité', tags: ['capture', 'annotation'], status: 'soon', icon: 'sparkles', unavailableReason: 'Interface d’annotation en cours de polish.', updatedAt: '2026-10-14T10:00:00.000Z' })
  ] } },
  announcements: { ok: true, source: 'network', fetchedAt: NOW, stale: false, data: { schemaVersion: 1, generatedAt: NOW, announcements: [
    { id: 'a1', title: 'Teralynk 1.3 : nouvelle interface', summary: 'Refonte visuelle complète : surfaces plus propres, accent maîtrisé, hiérarchie clarifiée.', body: 'La version 1.3 introduit le design system v3 :\n\n— surfaces neutres haute lisibilité\n— accent violet utilisé avec parcimonie\n— cartes et modales retravaillées\n— animations plus courtes et amorties\n\nMettez à jour depuis le vérificateur de version.', category: 'release', priority: 'high', publishedAt: '2026-10-16T08:00:00.000Z', published: true },
    { id: 'a2', title: 'Maintenance du service de publication', summary: 'Une maintenance GitHub est prévue samedi 02:00-04:00 (UTC).', body: 'Pendant la fenêtre, le catalogue sera servi depuis le cache local signé. Aucune action requise.', category: 'maintenance', priority: 'normal', publishedAt: '2026-10-14T08:00:00.000Z', published: true }
  ] } },
  polls: { ok: true, source: 'network', fetchedAt: NOW, stale: false, data: { schemaVersion: 1, generatedAt: NOW, polls: [
    { id: 'p1', title: 'Quelle fonctionnalité en priorité pour la 1.4 ?', description: 'Vote centralisé via GitHub : réaction +1 publique sur l’issue de votre choix.', options: [{ id: 'o1', label: 'Planificateur de tâches', issueNumber: 12 }, { id: 'o2', label: 'Profils de configuration', issueNumber: 13 }, { id: 'o3', label: 'Thèmes clairs', issueNumber: 14 }], mode: 'github', startsAt: '2026-10-10T00:00:00.000Z', endsAt: '2026-11-10T00:00:00.000Z', status: 'open', createdAt: '2026-10-09T00:00:00.000Z' },
    { id: 'p2', title: 'Préférez-vous les animations complètes ?', description: 'Sondage local : votre choix reste sur cet appareil.', options: [{ id: 'o1', label: 'Oui, toujours' }, { id: 'o2', label: 'Seulement si fluides' }], mode: 'local', startsAt: '2026-10-01T00:00:00.000Z', endsAt: '2026-10-30T00:00:00.000Z', status: 'open', createdAt: '2026-09-30T00:00:00.000Z' }
  ] } },
  prefs: {
    theme: 'dark', accent: 'violet', reduceMotion: 'system', visualIntensity: 'balanced',
    skipIntro: true, updateChannel: 'stable', windowStart: 'default', historyRetentionDays: 90,
    favorites: ['disk-health'], lastFilters: { query: '', category: null, status: null, platform: null, sort: 'featured' },
    localPollVotes: {}, userGithubTokenExists: false,
    history: [
      { id: 'h1', at: '2026-10-17T09:12:00.000Z', type: 'script-run', cardId: 'net-clean', detail: 'Windows PowerShell 5.1', exitCode: 0 },
      { id: 'h2', at: '2026-10-16T18:40:00.000Z', type: 'poll-voted', pollId: 'p1', optionId: 'o2', detail: 'via GitHub (réaction +1)' }
    ],
    lastUpdateCheck: { at: NOW, result: 'up-to-date', installedVersion: '1.3.0', latestVersion: '1.3.0' },
    seenCardVersions: {}
  },
  runtimes: [
    { id: 'powershell', label: 'Windows PowerShell', detected: true, version: '5.1.26100', executablePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', installHint: '' },
    { id: 'pwsh', label: 'PowerShell 7+', detected: false, installHint: 'Installez PowerShell 7 depuis github.com/PowerShell.' },
    { id: 'python', label: 'Python', detected: true, version: '3.12.4', executablePath: 'C:\\Python312\\python.exe', installHint: '' },
    { id: 'node', label: 'Node.js', detected: false, installHint: 'Installez Node.js LTS depuis nodejs.org.' },
    { id: 'batch', label: 'Invite de commandes (Batch)', detected: true, version: '10.0', executablePath: 'C:\\Windows\\System32\\cmd.exe', installHint: '' }
  ]
};

/* ---------------- Injection du mock ---------------- */
const MOCK_FN = `(dataJson) => {
  const D = JSON.parse(dataJson);
  window.teralynk = {
    system: {
      info: async () => D.info,
      githubStatus: async () => D.githubStatus,
      openLogs: async () => ({ ok: true, dir: 'logs' }),
      openExternal: async () => ({ ok: true })
    },
    updates: {
      check: async () => D.updateGate,
      download: async () => ({ started: true }),
      installNow: async () => ({ ok: true })
    },
    content: {
      catalog: async () => D.catalog,
      announcements: async () => D.announcements,
      polls: async () => D.polls,
      clearCache: async () => ({ ok: true })
    },
    prefs: {
      get: async () => D.prefs,
      patch: async (p) => Object.assign(D.prefs, p),
      reset: async () => D.prefs
    },
    scripts: {
      runtimes: async () => D.runtimes,
      prepare: async () => ({ ok: false, stage: 'runtime', message: 'capture design uniquement' }),
      execute: async () => ({ ok: false, message: 'capture design uniquement' }),
      stop: async () => ({ ok: false }),
      onEvent: () => () => undefined
    },
    music: {
      status: async () => ({ python: true, pythonVersion: '3.12.4', spotdl: true, ffmpeg: true, platform: 'win32' }),
      defaultFolder: async () => ({ ok: true, folder: 'C:\\\\Users\\\\lger3\\\\Music\\\\Teralynk' }),
      pickFolder: async () => ({ ok: true, folder: 'C:\\\\Users\\\\lger3\\\\Music\\\\Teralynk' }),
      install: async () => ({ ok: true }),
      download: async () => ({ ok: true, runId: 'capture' }),
      stop: async () => ({ ok: true }),
      onEvent: () => () => undefined
    },
    polls: {
      results: async (poll) => ({ ok: true, results: { pollId: poll.id, mode: 'github', fetchedAt: D.now, options: poll.options.map((o, i) => ({ optionId: o.id, issueNumber: o.issueNumber || 0, plusOne: [14, 9, 5][i] || 3, totalReactions: [14, 9, 5][i] || 3, url: 'https://github.com/vicetradeshop-prog/teralynk/issues/12' })) } }),
      voteGithub: async () => ({ ok: true, message: 'Vote enregistré.' }),
      tokenStatus: async () => ({ exists: false, encryptionAvailable: true }),
      storeToken: async () => ({ ok: true }),
      clearToken: async () => ({ ok: true })
    },
    events: { onUpdates: () => () => undefined }
  };
}`;

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: process.env.CHROME_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined),
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--force-color-profile=srgb', '--font-render-hinting=none']
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument(new Function('return ' + MOCK_FN)(), JSON.stringify(DATA));

const shot = async (name) => {
  await page.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log('capture :', name);
};
const clickText = async (selector, text) => {
  await page.evaluate(
    (sel, txt) => {
      const nodes = [...document.querySelectorAll(sel)];
      const target = nodes.find((n) => (n.textContent ?? '').includes(txt));
      if (!target) throw new Error(`introuvable : ${sel} contenant « ${txt} »`);
      target.click();
    },
    selector,
    text
  );
};
const settle = (ms = 900) => new Promise((r) => setTimeout(r, ms));

await page.goto('http://localhost:4173/', { waitUntil: 'networkidle0' });

/* Intro (prefs.skipIntro forcé à false pour la capture) */
await page.evaluate(() => { /* l'intro est skipped par le mock ; capture du gate directement */ });
await page.waitForSelector('.tl-gate-card', { timeout: 15000 });
await settle(700);
await shot('01-gate');

await clickText('button', 'Entrer dans Teralynk');
await page.waitForSelector('.tl-hero', { timeout: 15000 });
await settle(1100);
await shot('02-home');

await clickText('.tl-nav-item', 'Explorer');
await page.waitForSelector('.tl-feature-card', { timeout: 15000 });
await settle(1000);
await shot('03-explore');

await page.hover('.tl-feature-card');
await settle(500);
await shot('04-explore-hover');

await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.tl-feature-card')];
  const generic = cards.find((c) => (c.textContent ?? '').includes('Nettoyage réseau'));
  (generic ?? cards[0]).click();
});
await page.waitForSelector('.tl-modal', { timeout: 15000 });
await settle(800);
await shot('05-card-detail');
await page.keyboard.press('Escape');
await settle(600);

await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.tl-feature-card')];
  const music = cards.find((c) => (c.textContent ?? '').includes('Téléchargeur de musique'));
  if (!music) throw new Error('carte musique introuvable dans le rendu');
  music.click();
});
try {
  await page.waitForSelector('.tl-faq', { timeout: 8000 });
} catch {
  const debug = await page.evaluate(() => ({
    modal: Boolean(document.querySelector('.tl-modal')),
    modalText: (document.querySelector('.tl-modal')?.innerText || '').slice(0, 300),
    faq: document.querySelectorAll('.tl-faq').length,
    modals: document.querySelectorAll('.tl-modal').length
  }));
  console.log('DIAG MUSIC MODAL :', JSON.stringify(debug, null, 2));
  throw new Error('modale musique non rendue');
}
await settle(1000);
await shot('09-music');
await page.keyboard.press('Escape');
await settle(600);

await clickText('.tl-nav-item', 'Annonces');
await settle(1000);
await shot('06-announcements');

await clickText('.tl-nav-item', 'Sondages');
await settle(1200);
await shot('07-polls');

await clickText('.tl-nav-item', 'Paramètres');
await settle(1000);
await shot('08-settings');

await clickText('.tl-nav-item', 'Accueil');
await settle(600);

await browser.close();
server.close();
console.log('Captures terminées →', outDir);
