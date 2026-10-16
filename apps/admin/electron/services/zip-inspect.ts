/**
 * Analyse et validation des paquets ZIP de publication (sans extraction aveugle).
 *
 * Règles :
 *  - Lecture des entrées via yauzl (flux, pas de chargement complet en mémoire).
 *  - Refus de tout chemin dangereux (Zip Slip, absolu, lecteur, UNC) AVANT
 *    toute écriture sur le disque.
 *  - Le contenu du ZIP n'est JAMAIS exécuté pendant la validation.
 *  - Le format de paquet est documenté et stable (docs/admin.md §Publication) :
 *      teralynk.package.json + artefacts listés dans `files`.
 *  - Distinction explicite entre paquet de publication complet et archive
 *    source (ex. archive GitHub sans installateur ni métadonnées).
 */
import { open as yauzlOpen, type Entry, type ZipFile } from 'yauzl';
import { createWriteStream, existsSync, mkdirSync, statSync, rmSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import {
  packageMetadataSchema,
  inspectZipEntries,
  safeJoinForExtraction,
  type PackageMetadata
} from '@teralynk/shared';
import { sha256Hex } from '@teralynk/shared/node';

export interface ZipEntryInfo {
  name: string;
  uncompressedSize: number;
  isDirectory: boolean;
}

export interface ZipInspection {
  ok: boolean;
  entries: ZipEntryInfo[];
  totalUncompressedSize: number;
  /** Problèmes de chemins dangereux (archive rejetée si non vide). */
  pathIssues: Array<{ entry: string; reason: string }>;
  /** teralynk.package.json présent ? */
  hasPackageMetadata: boolean;
  /** Métadonnées validées (si présentes et conformes). */
  metadata: PackageMetadata | null;
  metadataError: string | null;
  /** Fichiers déclarés dans les métadonnées mais absents du ZIP. */
  missingFiles: string[];
  /** Signaux d'une archive source plutôt qu'un paquet de publication. */
  looksLikeSourceArchive: boolean;
  /** Explication destinée à l'administrateur. */
  verdict: string;
}

const MAX_ENTRIES = 5000;
const MAX_TOTAL_SIZE = 3n * 1024n * 1024n * 1024n; // 3 Go

function openZip(zipPath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    // decodeStrings: false → yauzl ne valide/décode pas les noms à l'ouverture :
    // c'est NOTRE analyse qui décode et juge chaque chemin (on refuse avant d'agir).
    yauzlOpen(zipPath, { lazyEntries: true, autoClose: false, decodeStrings: false }, (error, zipfile) => {
      if (error || !zipfile) reject(error ?? new Error('Ouverture du ZIP impossible'));
      else resolve(zipfile);
    });
  });
}

/** Décode le nom d'une entrée brute (Buffer quand decodeStrings: false). */
function nameOf(entry: Entry): string {
  return Buffer.isBuffer(entry.fileName) ? entry.fileName.toString('utf8') : String(entry.fileName);
}

/** Étape 2 du wizard : analyse complète de l'archive, sans rien extraire. */
export async function inspectZip(zipPath: string): Promise<ZipInspection> {
  if (!existsSync(zipPath)) throw new Error(`Fichier introuvable : ${zipPath}`);
  const stat = statSync(zipPath);
  if (!stat.isFile()) throw new Error('Le chemin sélectionné n’est pas un fichier.');

  const zipfile = await openZip(zipPath);
  const entries: ZipEntryInfo[] = [];
  let totalUncompressed = 0n;

  try {
    await new Promise<void>((resolve, reject) => {
      zipfile.on('entry', (entry: Entry) => {
        const name = nameOf(entry);
        entries.push({ name, uncompressedSize: entry.uncompressedSize, isDirectory: /\/$/.test(name) });
        totalUncompressed += BigInt(entry.uncompressedSize);
        if (entries.length > MAX_ENTRIES) {
          reject(new Error(`Archive refusée : plus de ${MAX_ENTRIES} entrées.`));
          return;
        }
        if (totalUncompressed > MAX_TOTAL_SIZE) {
          reject(new Error('Archive refusée : taille décompressée totale excessive (> 3 Go).'));
          return;
        }
        zipfile.readEntry();
      });
      zipfile.on('end', resolve);
      zipfile.on('error', reject);
      zipfile.readEntry();
    });
  } finally {
    zipfile.close();
  }

  // 1. Sécurité des chemins — avant tout le reste.
  const pathIssues = inspectZipEntries(entries.map((e) => e.name)).map((i) => ({ entry: i.entry, reason: i.reason }));

  // 2. Métadonnées de paquet.
  const fileEntries = entries.filter((e) => !e.isDirectory);
  const metadataEntry = fileEntries.find((e) => e.name === 'teralynk.package.json');
  let metadata: PackageMetadata | null = null;
  let metadataError: string | null = null;
  if (metadataEntry) {
    const raw = await readEntryText(zipPath, 'teralynk.package.json');
    if (raw === null) {
      metadataError = 'teralynk.package.json illisible dans l’archive.';
    } else {
      try {
        const parsed = packageMetadataSchema.safeParse(JSON.parse(raw));
        if (parsed.success) metadata = parsed.data;
        else metadataError = `teralynk.package.json invalide : ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`;
      } catch {
        metadataError = 'teralynk.package.json n’est pas un JSON valide.';
      }
    }
  }

  // 3. Fichiers déclarés vs présents.
  const names = new Set(fileEntries.map((e) => e.name));
  const missingFiles = metadata ? metadata.files.filter((f) => !names.has(f)) : [];

  // 4. Distinction paquet de publication / archive source.
  const looksLikeSourceArchive =
    !metadataEntry &&
    (fileEntries.some((e) => /^(src|package\.json|tsconfig)/.test(e.name)) ||
      fileEntries.every((e) => e.name.split('/').length > 1) ||
      !fileEntries.some((e) => /\.(exe|msi|zip|yml|AppImage|dmg)$/i.test(e.name)));

  let verdict: string;
  if (pathIssues.length > 0) {
    verdict = `ARCHIVE REJETÉE : ${pathIssues.length} chemin(s) dangereux (tentative d'écriture hors du répertoire cible).`;
  } else if (!metadataEntry) {
    verdict = looksLikeSourceArchive
      ? 'Ce ZIP ressemble à une archive SOURCE (code du projet), pas à un paquet de publication Teralynk. Un paquet doit contenir `teralynk.package.json` à sa racine et les artefacts de distribution (voir docs/admin.md §Publication).'
      : 'ZIP sans métadonnées : `teralynk.package.json` est absent de la racine de l’archive.';
  } else if (metadataError) {
    verdict = `Métadonnées invalides : ${metadataError}`;
  } else if (missingFiles.length > 0) {
    verdict = `Fichiers déclarés mais absents du ZIP : ${missingFiles.join(', ')}.`;
  } else {
    verdict = 'Paquet de publication valide : métadonnées conformes et tous les fichiers déclarés sont présents.';
  }

  return {
    ok: pathIssues.length === 0 && metadata !== null && missingFiles.length === 0,
    entries,
    totalUncompressedSize: Number(totalUncompressed),
    pathIssues,
    hasPackageMetadata: Boolean(metadataEntry),
    metadata,
    metadataError,
    missingFiles,
    looksLikeSourceArchive,
    verdict
  };
}

/** Lit le contenu texte d'une entrée précise (second passage, flux uniquement). */
async function readEntryText(zipPath: string, entryName: string): Promise<string | null> {
  const zipfile = await openZip(zipPath);
  try {
    return await new Promise<string | null>((resolve, reject) => {
      zipfile.on('entry', (entry: Entry) => {
        if (nameOf(entry) !== entryName) {
          zipfile.readEntry();
          return;
        }
        zipfile.openReadStream(entry, (error, stream) => {
          if (error || !stream) {
            reject(error ?? new Error('Flux illisible'));
            return;
          }
          const chunks: Buffer[] = [];
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
          stream.on('error', reject);
        });
      });
      zipfile.on('end', () => resolve(null));
      zipfile.on('error', reject);
      zipfile.readEntry();
    });
  } finally {
    zipfile.close();
  }
}

export interface ExtractedPackage {
  dir: string;
  files: Array<{ name: string; path: string; sha256: string; size: number }>;
  metadata: PackageMetadata;
}

/**
 * Extraction CONTRÔLÉE pour publication : uniquement les fichiers déclarés
 * dans `metadata.files` + `teralynk.package.json`, vers un répertoire de
 * travail temporaire, avec re-vérification des chemins à chaque écriture.
 */
export async function extractPackageForPublish(zipPath: string, inspection: ZipInspection, workDir: string): Promise<ExtractedPackage> {
  if (!inspection.ok || !inspection.metadata) {
    throw new Error('Paquet invalide : extraction refusée. Corrigez l’archive puis relancez l’analyse.');
  }
  const metadata = inspection.metadata;
  const wanted = new Set([...metadata.files, 'teralynk.package.json', ...(metadata.updaterManifest ? [metadata.updaterManifest] : [])]);

  if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  const zipfile = await openZip(zipPath);
  const extracted: ExtractedPackage['files'] = [];

  try {
    await new Promise<void>((resolve, reject) => {
      zipfile.on('entry', (entry: Entry) => {
        const name = nameOf(entry);
        if (/\/$/.test(name) || !wanted.has(name)) {
          zipfile.readEntry();
          return;
        }
        // Re-validation du chemin au moment de l'écriture (défense en profondeur).
        let target: string;
        try {
          target = safeJoinForExtraction(workDir, name, path.sep as '/' | '\\');
        } catch (error) {
          reject(error);
          return;
        }
        if (!target.startsWith(path.resolve(workDir))) {
          reject(new Error(`Chemin d'extraction refusé : ${name}`));
          return;
        }
        mkdirSync(path.dirname(target), { recursive: true });
        zipfile.openReadStream(entry, (error, stream) => {
          if (error || !stream) {
            reject(error ?? new Error('Flux illisible'));
            return;
          }
          const out = createWriteStream(target);
          pipeline(stream, out)
            .then(() => {
              const size = statSync(target).size;
              const hash = createHash('sha256');
              hash.update(readFileSync(target));
              extracted.push({ name, path: target, sha256: hash.digest('hex'), size });
              zipfile.readEntry();
            })
            .catch(reject);
        });
      });
      zipfile.on('end', resolve);
      zipfile.on('error', reject);
      zipfile.readEntry();
    });
  } finally {
    zipfile.close();
  }

  const missing = metadata.files.filter((f) => !extracted.some((e) => e.name === f));
  if (missing.length > 0) {
    throw new Error(`Extraction incomplète, fichiers manquants : ${missing.join(', ')}. Publication abandonnée.`);
  }
  return { dir: workDir, files: extracted, metadata };
}

/** Empreinte SHA-256 d'un fichier sur disque. */
export function fileSha256(filePath: string): string {
  return sha256Hex(readFileSync(filePath));
}
