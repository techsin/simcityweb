/**
 * TODO(composer): PLACEHOLDER for "Rush Hour" - replace this whole file with the real song.
 * Keep the export name (track), the id 'rush_hour_funk' and a finite 3-5 min arrangement; see tracks/sunday_jazz.ts.
 */
import type { MusicTrack } from '../types';
import { placeholderSong } from './_placeholder';

export const track: MusicTrack = {
  id: 'rush_hour_funk',
  title: 'Rush Hour',
  mood: 'Tight downtown funk: clav, slap bass, brass stabs (placeholder)',
  tags: ['day', 'busy'],
  bpm: 104,
  gain: 1,
  create: (env) => placeholderSong(env, { bpm: 104, chart: 'Em9 | Em9 | A13 | A13', transpose: 0 }),
};
