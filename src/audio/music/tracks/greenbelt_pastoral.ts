/**
 * TODO(composer): PLACEHOLDER for "Greenbelt" - replace this whole file with the real song.
 * Keep the export name (track), the id 'greenbelt_pastoral' and a finite 3-5 min arrangement; see tracks/sunday_jazz.ts.
 */
import type { MusicTrack } from '../types';
import { placeholderSong } from './_placeholder';

export const track: MusicTrack = {
  id: 'greenbelt_pastoral',
  title: 'Greenbelt',
  mood: 'Pastoral morning: acoustic guitar, flute, strings (placeholder)',
  tags: ['day', 'calm', 'region'],
  bpm: 88,
  gain: 1,
  create: (env) => placeholderSong(env, { bpm: 88, chart: 'Gmaj9 | Cmaj9 | Em9 | D9sus4', transpose: 0 }),
};
