/**
 * Tests de sécurité des chemins d'archive (Zip Slip) et de l'analyse de ZIP.
 * (Exigence §18 : contrôler les chemins, rejeter les chemins dangereux,
 *  ne pas extraire aveuglément, distinguer paquet de publication et archive source.)
 */
import { describe, expect, it } from 'vitest';
import { inspectZipEntryPath, inspectZipEntries, safeJoinForExtraction } from '@teralynk/shared';

describe('inspectZipEntryPath', () => {
  it('accepte des chemins relatifs simples', () => {
    expect(inspectZipEntryPath('teralynk.package.json')).toBeNull();
    expect(inspectZipEntryPath('files/app.exe')).toBeNull();
    expect(inspectZipEntryPath('a/b/c.txt')).toBeNull();
  });

  it('REJETTE la traversée vers le parent', () => {
    expect(inspectZipEntryPath('../evil.exe')?.reason).toBe('traversal');
    expect(inspectZipEntryPath('a/../../evil.exe')?.reason).toBe('traversal');
  });

  it('REJETTE les chemins absolus Unix', () => {
    expect(inspectZipEntryPath('/etc/passwd')?.reason).toBe('absolute');
  });

  it('REJETTE les lecteurs Windows', () => {
    expect(inspectZipEntryPath('C:/Windows/System32/x.dll')?.reason).toBe('drive');
  });

  it('REJETTE les chemins UNC', () => {
    expect(inspectZipEntryPath('\\\\server\\share\\x.exe')?.reason).toBe('unc');
  });

  it('REJETTE les antislashs (ambigus sous Windows)', () => {
    expect(inspectZipEntryPath('a\\b.exe')?.reason).toBe('backslash');
  });

  it('REJETTE les noms vides et les caractères de contrôle', () => {
    expect(inspectZipEntryPath('')?.reason).toBe('empty');
    expect(inspectZipEntryPath('a\u0000b')?.reason).toBe('traversal');
  });

  it('inspecte une liste complète', () => {
    const issues = inspectZipEntries(['ok.txt', '../evil', 'C:/x']);
    expect(issues).toHaveLength(2);
  });
});

describe('safeJoinForExtraction', () => {
  it('résout un chemin sûr dans le répertoire cible', () => {
    expect(safeJoinForExtraction('/tmp/target', 'a/b.txt')).toBe('/tmp/target/a/b.txt');
  });

  it('lève une erreur pour un chemin dangereux', () => {
    expect(() => safeJoinForExtraction('/tmp/target', '../evil')).toThrow();
  });
});
