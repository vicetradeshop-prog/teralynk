/**
 * Validation stricte des liens Spotify acceptés par la fonctionnalité
 * native « Téléchargeur de musique ». Aucune autre origine n'est acceptée :
 * l'URL est transmise comme argument unique à spotdl, sans shell.
 */
export interface SpotifyUrlCheck {
  ok: boolean;
  reason?: string;
  kind?: 'track' | 'album' | 'playlist' | 'artist';
}

export function validateSpotifyUrl(url: string): SpotifyUrlCheck {
  const trimmed = (url ?? '').trim();
  if (!trimmed) return { ok: false, reason: 'Collez un lien Spotify (track, album ou playlist).' };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'Lien invalide : ce n’est pas une URL.' };
  }
  if (parsed.protocol !== 'https:') return { ok: false, reason: 'Seuls les liens https sont acceptés.' };
  if (!/(^|\.)spotify\.com$/.test(parsed.hostname)) {
    return { ok: false, reason: 'Domaine non autorisé : open.spotify.com uniquement.' };
  }
  const kindMatch = /^\/(?:intl-[a-z]{2}(?:-[a-zA-Z]{2})?\/)?(track|album|playlist|artist)\//.exec(parsed.pathname);
  if (!kindMatch) {
    return { ok: false, reason: 'Lien Spotify attendu : track, album, playlist ou artist.' };
  }
  return { ok: true, kind: kindMatch[1] as 'track' | 'album' | 'playlist' | 'artist' };
}
