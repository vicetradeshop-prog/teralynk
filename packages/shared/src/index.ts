/**
 * Point d'entrée principal de @teralynk/shared.
 * Importable depuis le renderer (Vite) et les processus principaux (esbuild).
 * Les utilitaires dépendant de Node sont exposés via "@teralynk/shared/node".
 */
export * from './config';
export * from './schemas';
export * from './version';
export * from './zip-safety';
export * from './redact';
export * from './polls';
export * from './spotify';
