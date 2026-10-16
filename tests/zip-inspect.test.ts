/**
 * Tests d'analyse de ZIP réels (yauzl) : paquet valide, archive source,
 * chemins dangereux, fichiers manquants, métadonnées invalides.
 * (Exigence §18 + §25 : refus des archives incorrectes avec explication.)
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectZip } from '../apps/admin/electron/services/zip-inspect';

const SHA = 'a'.repeat(64);

/* ------------------------------------------------------------------ */
/* Constructeur ZIP minimal (entrées « stored », sans compression).    */
/* Nécessaire pour les tests de sécurité : yazl refuse légitimement    */
/* de créer des entrées dangereuses, or nous devons vérifier que       */
/* NOTRE analyse les rejette. Contrôle total du répertoire central.    */
/* ------------------------------------------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]!) & 0xff]!;
  return (crc ^ -1) >>> 0;
}

function makeRawZip(entries: Array<{ name: string; content: string }>): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const dataBuf = Buffer.from(entry.content, 'utf8');
    const crc = crc32(dataBuf);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: stored
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date (1980-01-01)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dataBuf.length, 18); // compressed
    local.writeUInt32LE(dataBuf.length, 22); // uncompressed
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    chunks.push(local, nameBuf, dataBuf);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4); // made by
    cd.writeUInt16LE(20, 6); // needed
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(dataBuf.length, 20);
    cd.writeUInt32LE(dataBuf.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30); // extra
    cd.writeUInt16LE(0, 32); // comment
    cd.writeUInt16LE(0, 34); // disk
    cd.writeUInt16LE(0, 36); // internal attrs
    cd.writeUInt32LE(0, 38); // external attrs
    cd.writeUInt32LE(offset, 42); // local header offset
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + dataBuf.length;
  }

  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, cdBuf, eocd]);
}

let workDir: string;
let zipCounter = 0;

function writeZip(entries: Array<{ name: string; content: string }>): string {
  const buffer = makeRawZip(entries);
  const file = path.join(workDir, `test-${zipCounter++}.zip`);
  writeFileSync(file, buffer);
  return file;
}

const validMetadata = JSON.stringify({
  packageFormat: 1,
  app: 'teralynk',
  version: '1.2.0',
  channel: 'stable',
  files: ['Teralynk-Setup-1.2.0.exe', 'latest.yml'],
  updaterManifest: 'latest.yml',
  minSupportedVersion: '1.0.0',
  title: 'Teralynk 1.2.0',
  notes: 'Corrections et nouveautés.',
  builtAt: '2025-06-01T10:00:00.000Z'
});

beforeAll(() => {
  workDir = mkdtempSync(path.join(tmpdir(), 'teralynk-zip-tests-'));
});

afterAll(() => {
  rmSync(workDir, { recursive: true, force: true });
});

describe('inspectZip', () => {
  it('accepte un paquet de publication complet', async () => {
    const zip = await writeZip([
      { name: 'teralynk.package.json', content: validMetadata },
      { name: 'Teralynk-Setup-1.2.0.exe', content: 'MZ-fake-installer' },
      { name: 'latest.yml', content: 'version: 1.2.0\n' }
    ]);
    const result = await inspectZip(zip);
    expect(result.ok).toBe(true);
    expect(result.pathIssues).toHaveLength(0);
    expect(result.metadata?.version).toBe('1.2.0');
    expect(result.missingFiles).toHaveLength(0);
    expect(result.verdict).toContain('valide');
  });

  it('REJETTE une archive source (code du projet, sans métadonnées)', async () => {
    const zip = await writeZip([
      { name: 'package.json', content: '{"name":"teralynk"}' },
      { name: 'src/main.ts', content: 'console.log(1)' },
      { name: 'src/App.tsx', content: 'export default () => null' }
    ]);
    const result = await inspectZip(zip);
    expect(result.ok).toBe(false);
    expect(result.looksLikeSourceArchive).toBe(true);
    expect(result.hasPackageMetadata).toBe(false);
    expect(result.verdict).toContain('SOURCE');
  });

  it('REJETTE une archive contenant un chemin dangereux (Zip Slip)', async () => {
    const zip = await writeZip([
      { name: 'teralynk.package.json', content: validMetadata },
      { name: '../evil.txt', content: 'evil' },
      { name: 'Teralynk-Setup-1.2.0.exe', content: 'MZ' },
      { name: 'latest.yml', content: 'y' }
    ]);
    const result = await inspectZip(zip);
    expect(result.ok).toBe(false);
    expect(result.pathIssues.length).toBeGreaterThan(0);
    expect(result.verdict).toContain('dangereux');
  });

  it('REJETTE un paquet dont un fichier déclaré est absent', async () => {
    const zip = await writeZip([
      { name: 'teralynk.package.json', content: validMetadata },
      { name: 'latest.yml', content: 'y' }
    ]);
    const result = await inspectZip(zip);
    expect(result.ok).toBe(false);
    expect(result.missingFiles).toContain('Teralynk-Setup-1.2.0.exe');
  });

  it('REJETTE des métadonnées JSON invalides avec explication', async () => {
    const zip = await writeZip([
      { name: 'teralynk.package.json', content: '{"packageFormat": 99, "app": "autre"}' }
    ]);
    const result = await inspectZip(zip);
    expect(result.ok).toBe(false);
    expect(result.metadataError).toBeTruthy();
    expect(result.verdict).toContain('invalide');
  });

  it('signale une version de paquet non sémantique', async () => {
    const metadata = JSON.parse(validMetadata);
    metadata.version = '1.2';
    const zip = await writeZip([
      { name: 'teralynk.package.json', content: JSON.stringify(metadata) },
      { name: 'Teralynk-Setup-1.2.0.exe', content: 'MZ' },
      { name: 'latest.yml', content: 'y' }
    ]);
    const result = await inspectZip(zip);
    expect(result.ok).toBe(false);
    expect(result.metadataError).toContain('invalide');
  });
});
