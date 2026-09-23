/**
 * TODO(composer): PLACEHOLDER for "Neon Skyline" - replace this whole file with the real song.
 * Keep the export name (track), the id 'neon_skyline' and a finite 3-5 min arrangement; see tracks/sunday_jazz.ts.
 */
import type { MusicTrack } from '../types';
import { placeholderSong } from './_placeholder';

export const track: MusicTrack = {
  id: 'neon_skyline',
  title: 'Neon Skyline',
  mood: 'Night-drive synthwave: arps, lead, gated drums (placeholder)',
  tags: ['night', 'busy'],
  bpm: 96,
  gain: 1,
  create: (env) => placeholderSong(env, { bpm: 96, chart: 'Am9 | Fmaj9 | Cmaj9 | G9sus4', transpose: 0 }),
};
