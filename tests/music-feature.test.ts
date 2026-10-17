/**
 * Tests de la fonctionnalité native « Téléchargeur de musique » :
 * validation stricte des liens Spotify et règles de schéma des cartes
 * à interface native (featureUi).
 */
import { describe, expect, it } from 'vitest';
import { validateSpotifyUrl, featureCardSchema } from '@teralynk/shared';

const NOW = '2025-06-01T10:00:00.000Z';

describe('validateSpotifyUrl', () => {
  it('accepte un lien track https open.spotify.com', () => {
    const result = validateSpotifyUrl('https://open.spotify.com/intl-fr/track/4cOdK2wGLETKBW3PvgPWqT');
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('track');
  });

  it('accepte album, playlist et artist', () => {
    expect(validateSpotifyUrl('https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3').kind).toBe('album');
    expect(validateSpotifyUrl('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M').kind).toBe('playlist');
    expect(validateSpotifyUrl('https://open.spotify.com/artist/06HL4z0CvFAxyc27GXpf02').kind).toBe('artist');
  });

  it('rejette le http non chiffré', () => {
    expect(validateSpotifyUrl('http://open.spotify.com/track/x').ok).toBe(false);
  });

  it('rejette un domaine imitateur (spotify.com.evil.example)', () => {
    expect(validateSpotifyUrl('https://spotify.com.evil.example/track/x').ok).toBe(false);
  });

  it('rejette un autre domaine (youtube, soundcloud…)', () => {
    expect(validateSpotifyUrl('https://www.youtube.com/watch?v=x').ok).toBe(false);
  });

  it('rejette une page spotify sans type de ressource', () => {
    expect(validateSpotifyUrl('https://open.spotify.com/user/xyz').ok).toBe(false);
  });

  it('rejette une chaîne vide ou non-URL', () => {
    expect(validateSpotifyUrl('').ok).toBe(false);
    expect(validateSpotifyUrl('pas un lien').ok).toBe(false);
  });
});

describe('featureCardSchema — cartes à interface native', () => {
  const nativeCard = {
    id: 'spotdl-music',
    slug: 'spotdl-music',
    name: 'Téléchargeur de musique',
    description: 'Télécharge un titre Spotify en MP3 tagué.',
    category: 'Musique',
    status: 'available',
    featureUi: 'music-downloader',
    createdAt: NOW,
    updatedAt: NOW
  };

  it('accepte une carte available AVEC interface native et SANS script', () => {
    expect(featureCardSchema.safeParse(nativeCard).success).toBe(true);
  });

  it('rejette une interface native inconnue', () => {
    expect(featureCardSchema.safeParse({ ...nativeCard, featureUi: 'teleporteur' }).success).toBe(false);
  });

  it('rejette toujours une carte available sans script ET sans interface native', () => {
    const { featureUi, ...rest } = nativeCard;
    void featureUi;
    expect(featureCardSchema.safeParse(rest).success).toBe(false);
  });
});
