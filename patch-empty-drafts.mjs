#!/usr/bin/env node
/**
 * Patch ponctuel v1.1.4 — corrige les boutons « Nouvelle carte / Nouvelle annonce /
 * Nouveau sondage » du panel admin qui ne réagissaient pas.
 *
 * Cause : les gabarits vides passaient par schema.parse() avec des champs vides ;
 * zod LÈVE une exception sur champ requis vide → le clic mourait silencieusement.
 * Correctif : gabarits en objets bruts ; la validation stricte reste assurée en
 * direct dans les éditeurs et à l'enregistrement (inchangée).
 *
 * Idempotent : relançable sans risque. Usage (racine du projet) :
 *   node patch-empty-drafts.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';

const NEW = {
  emptyCard: `function emptyCard(): FeatureCard {
  const now = new Date().toISOString();
  // Objet brut : la validation stricte se fait en direct dans l'éditeur et à
  // l'enregistrement. Un .parse() sur champs vides lèverait une exception et
  // tuerait silencieusement le clic sur « Nouvelle carte ».
  return {
    id: '',
    slug: '',
    name: '',
    description: '',
    category: '',
    icon: 'sparkles',
    tags: [],
    status: 'soon',
    platforms: ['windows'],
    requirements: [],
    permissions: [],
    capabilities: [],
    knownRisks: [],
    riskLevel: 'low',
    featured: false,
    enabled: false,
    createdAt: now,
    updatedAt: now
  } as FeatureCard;
}
`,
  emptyAnnouncement: `function emptyAnnouncement(): Announcement {
  // Objet brut : la validation stricte se fait en direct dans l'éditeur.
  return {
    id: \`a-\${Date.now().toString(36)}\`,
    title: '',
    summary: '',
    body: '',
    category: 'general',
    priority: 'normal',
    publishedAt: new Date().toISOString(),
    published: true
  } as Announcement;
}
`,
  emptyPoll: `function emptyPoll(): Poll {
  const now = new Date();
  const start = new Date(now.getTime() + 3600_000);
  const end = new Date(now.getTime() + 14 * 86400_000);
  // Objet brut : la validation stricte se fait en direct dans l'éditeur.
  return {
    id: \`poll-\${now.getTime().toString(36)}\`,
    title: '',
    description: '',
    options: [
      { id: 'opt-1', label: '' },
      { id: 'opt-2', label: '' }
    ],
    mode: 'github',
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    status: 'draft',
    createdAt: now.toISOString()
  } as Poll;
}
`
};

const FILES = {
  emptyCard: 'apps/admin/src/pages/CatalogPage.tsx',
  emptyAnnouncement: 'apps/admin/src/pages/AnnouncementsPage.tsx',
  emptyPoll: 'apps/admin/src/pages/PollsPage.tsx'
};

let patched = 0;
for (const [fn, file] of Object.entries(FILES)) {
  let s = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const start = s.indexOf(`function ${fn}(`);
  if (start === -1) {
    console.error(`ECHEC : fonction ${fn} introuvable dans ${file}`);
    process.exit(1);
  }
  const end = s.indexOf('\n}\n', start) + 3;
  const region = s.slice(start, end);
  if (region.includes('.parse({')) {
    s = s.slice(0, start) + NEW[fn] + s.slice(end);
    writeFileSync(file, s);
    console.log(`${file} : ${fn} corrigé`);
    patched++;
  } else {
    console.log(`${file} : déjà correct`);
  }
}
console.log(`PATCH OK (${patched} correction(s)) — relancez : npm run start -w @teralynk/admin`);
