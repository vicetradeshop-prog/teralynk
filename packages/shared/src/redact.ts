/**
 * Assainissement des chaînes destinées aux journaux et aux messages d'erreur.
 * Objectif : aucun jeton, aucun secret, aucune donnée personnelle dans les logs.
 */

const PATTERNS: Array<{ re: RegExp; replacement: string }> = [
  // GitHub PAT classiques
  { re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, replacement: '[REDACTED_GITHUB_TOKEN]' },
  // GitHub fine-grained PAT
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replacement: '[REDACTED_GITHUB_TOKEN]' },
  // En-tête Authorization
  { re: /(authorization\s*[:=]\s*)(bearer\s+)?[^\s,"}]+/gi, replacement: '$1[REDACTED]' },
  // Paramètres de type token/secret dans une query string
  { re: /([?&](?:token|access_token|secret|key|sig|signature)=)[^&\s]+/gi, replacement: '$1[REDACTED]' },
  // Clés PEM
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, replacement: '[REDACTED_PRIVATE_KEY]' }
];

export function redactSecrets(input: string): string {
  let out = input;
  for (const { re, replacement } of PATTERNS) out = out.replace(re, replacement);
  return out;
}

/** Masque un jeton pour affichage UI : garde 4 premiers et 4 derniers caractères. */
export function maskToken(token: string): string {
  if (token.length <= 12) return '••••';
  return `${token.slice(0, 4)}${'•'.repeat(8)}${token.slice(-4)}`;
}
