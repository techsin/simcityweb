/**
 * TODO(composer): PLACEHOLDER for "Avenida" - replace this whole file with the real song.
 * Keep the export name (track), the id 'avenida_bossa' and a finite 3-5 min arrangement; see tracks/sunday_jazz.ts.
 */
import type { MusicTrack } from '../types';
import { placeholderSong } from './_placeholder';

export const track: MusicTrack = {
  id: 'avenida_bossa',
  title: 'Avenida',
  mood: 'Sunny bossa nova: nylon guitar, flute, shaker (placeholder)',
  tags: ['day', 'calm', 'region'],
  bpm: 128,
  gain: 1,
  create: (env) => placeholderSong(env, { bpm: 128, chart: 'Dmaj9 | Dmaj9 | Em9 | A13 | F#m7 | B7b9 | Em9 | A7sus4', transpose: 0 }),
};
