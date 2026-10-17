/**
 * Détection des runtimes disponibles sur l'ordinateur.
 * Aucun runtime n'est supposé installé ; rien n'est installé automatiquement.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import type { RuntimeId } from '@teralynk/shared';

const execFileAsync = promisify(execFile);

export interface RuntimeInfo {
  id: RuntimeId;
  label: string;
  detected: boolean;
  /** Chemin de l'exécutable détecté, le cas échéant. */
  executablePath?: string;
  version?: string;
  /** Instructions affichées à l'utilisateur si manquant. */
  installHint: string;
}

interface RuntimeProbe {
  id: RuntimeId;
  label: string;
  candidates: Array<{ command: string; args: string[] }>;
  installHint: string;
}

const IS_WINDOWS = os.platform() === 'win32';

const PROBES: RuntimeProbe[] = [
  {
    id: 'powershell',
    label: 'Windows PowerShell',
    candidates: [{ command: IS_WINDOWS ? 'powershell.exe' : 'powershell', args: ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'] }],
    installHint: 'Inclus avec Windows. Si absent, réparez l’installation de Windows PowerShell.'
  },
  {
    id: 'pwsh',
    label: 'PowerShell 7+',
    candidates: [{ command: IS_WINDOWS ? 'pwsh.exe' : 'pwsh', args: ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'] }],
    installHint: 'Installez PowerShell 7 depuis https://github.com/PowerShell/PowerShell (facultatif).'
  },
  {
    id: 'python',
    label: 'Python',
    candidates: [
      { command: IS_WINDOWS ? 'python.exe' : 'python3', args: ['--version'] },
      { command: 'python', args: ['--version'] }
    ],
    installHint: 'Installez Python 3 depuis https://www.python.org/downloads/ (cochez « Add to PATH » sur Windows).'
  },
  {
    id: 'node',
    label: 'Node.js',
    candidates: [{ command: IS_WINDOWS ? 'node.exe' : 'node', args: ['--version'] }],
    installHint: 'Installez Node.js LTS depuis https://nodejs.org (requis uniquement pour les scripts JavaScript).'
  },
  {
    id: 'batch',
    label: 'Invite de commandes (Batch)',
    candidates: IS_WINDOWS ? [{ command: 'cmd.exe', args: ['/c', 'ver'] }] : [],
    installHint: 'Inclus avec Windows.'
  }
];

async function which(command: string): Promise<string | null> {
  try {
    const finder = IS_WINDOWS ? 'where.exe' : 'which';
    const { stdout } = await execFileAsync(finder, [command], { timeout: 5000, windowsHide: true });
    const first = stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0];
    return first ?? null;
  } catch {
    return null;
  }
}

async function probeRuntime(probe: RuntimeProbe): Promise<RuntimeInfo> {
  const base: RuntimeInfo = { id: probe.id, label: probe.label, detected: false, installHint: probe.installHint };
  if (probe.candidates.length === 0) return base;
  for (const candidate of probe.candidates) {
    const resolved = await which(candidate.command);
    if (!resolved) continue;
    try {
      const { stdout } = await execFileAsync(candidate.command, candidate.args, { timeout: 8000, windowsHide: true });
      const version = stdout.trim().split(/\r?\n/)[0]?.replace(/^Python\s*/i, '').slice(0, 60);
      return { ...base, detected: true, executablePath: resolved, version };
    } catch {
      // Exécutable présent mais probe échouée : considéré comme détecté sans version.
      return { ...base, detected: true, executablePath: resolved };
    }
  }
  return base;
}

let cached: RuntimeInfo[] | null = null;

export async function detectRuntimes(force = false): Promise<RuntimeInfo[]> {
  if (cached && !force) return cached;
  cached = await Promise.all(PROBES.map(probeRuntime));
  return cached;
}

export async function findRuntime(id: RuntimeId, force = false): Promise<RuntimeInfo | null> {
  const all = await detectRuntimes(force);
  return all.find((r) => r.id === id && r.detected) ?? null;
}
