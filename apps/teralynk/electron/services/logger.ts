/**
 * Journalisation locale de Teralynk.
 * - Écrit dans userData/logs/teralynk.log (rotation simple par taille).
 * - Assainit systématiquement les secrets avant écriture.
 * - Aucune télémétrie : les journaux ne quittent jamais l'ordinateur.
 */
import { app } from 'electron';
import { appendFileSync, mkdirSync, existsSync, statSync, renameSync } from 'node:fs';
import path from 'node:path';
import { redactSecrets } from '@teralynk/shared';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const MAX_LOG_BYTES = 2 * 1024 * 1024; // 2 Mo puis rotation

function logFile(): string {
  return path.join(app.getPath('userData'), 'logs', 'teralynk.log');
}

export function log(level: LogLevel, message: string, meta?: unknown): void {
  try {
    const file = logFile();
    mkdirSync(path.dirname(file), { recursive: true });
    if (existsSync(file) && statSync(file).size > MAX_LOG_BYTES) {
      renameSync(file, `${file}.1`);
    }
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${redactSecrets(message)}${
      meta !== undefined ? ` ${redactSecrets(JSON.stringify(meta))}` : ''
    }\n`;
    appendFileSync(file, line, 'utf8');
    if (level === 'error') console.error(line.trim());
  } catch {
    // La journalisation ne doit jamais faire planter l'application.
  }
}

export function logsDirectory(): string {
  const dir = path.dirname(logFile());
  mkdirSync(dir, { recursive: true });
  return dir;
}
