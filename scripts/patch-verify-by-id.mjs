#!/usr/bin/env node
/**
 * Patch ponctuel v1.1.2 → corrige le faux échec « Fichiers manquants sur GitHub »
 * de l'étape de vérification, directement dans un dossier de travail existant :
 *   1. github.ts  : ajoute getReleaseById() (lecture d'une release par identifiant,
 *                   brouillons inclus — l'endpoint par tag répond 404 sur un brouillon) ;
 *   2. publish.ts : la vérification post-upload utilise getReleaseById(draft.id)
 *                   au lieu de getReleaseByTag(tag).
 * Idempotent : peut être relancé sans risque. Aucune autre modification.
 * Usage : node scripts/patch-verify-by-id.mjs   (depuis la racine du projet)
 */
import { readFileSync, writeFileSync } from 'node:fs';

const GITHUB_TS = 'apps/admin/electron/services/github.ts';
const PUBLISH_TS = 'apps/admin/electron/services/publish.ts';

const FN = [
  'export async function getReleaseById(token: string, releaseId: number): Promise<GitHubRelease | null> {',
  '  const { repoOwner, repoName } = getConfig();',
  '  const { status, data } = await request<GitHubRelease>(`${API}/repos/${repoOwner}/${repoName}/releases/${releaseId}`, token);',
  '  if (status === 404) return null;',
  '  if (status !== 200 || !data) throw new GitHubApiError(`Lecture de la release ${releaseId} impossible (HTTP ${status}).`, status);',
  '  return data;',
  '}',
  '',
  ''
].join('\n');

const marker = 'export async function getReleaseByTag(';
let g = readFileSync(GITHUB_TS, 'utf8');
if (!g.includes('getReleaseById')) {
  if (!g.includes(marker)) {
    console.error('ECHEC : marqueur introuvable dans ' + GITHUB_TS);
    process.exit(1);
  }
  g = g.replace(marker, FN + marker);
  writeFileSync(GITHUB_TS, g);
  console.log('github.ts : getReleaseById ajoute');
} else {
  console.log('github.ts : deja correct');
}

const oldVerify = 'const afterUpload = await getReleaseByTag(token, conflictingTag);';
const newVerify = 'const afterUpload = await getReleaseById(token, draft.id);';
let p = readFileSync(PUBLISH_TS, 'utf8');
if (p.includes(oldVerify)) {
  p = p.replace(oldVerify, newVerify);
  writeFileSync(PUBLISH_TS, p);
  console.log('publish.ts : verification par identifiant');
} else if (p.includes(newVerify)) {
  console.log('publish.ts : deja correct');
} else {
  console.error('ECHEC : ligne de verification introuvable dans ' + PUBLISH_TS);
  process.exit(1);
}

console.log('PATCH OK — relancez : npm run start -w @teralynk/admin');
