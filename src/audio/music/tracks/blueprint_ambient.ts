/**
 * TODO(composer): PLACEHOLDER for "Blueprint" - replace this whole file with the real song.
 * Keep the export name (track), the id 'blueprint_ambient' and a finite 3-5 min arrangement; see tracks/sunday_jazz.ts.
 */
import type { MusicTrack } from '../types';
import { placeholderSong } from './_placeholder';

export const track: MusicTrack = {
  id: 'blueprint_ambient',
  title: 'Blueprint',
  mood: 'Slow ambient drafting-table haze: pads, glass, bells (placeholder)',
  tags: ['menu', 'region', 'calm', 'night'],
  bpm: 68,
  gain: 1,
  create: (env) => placeholderSong(env, { bpm: 68, chart: 'Cmaj9 | Am9 | Fmaj7s11 | G9sus4', transpose: -2 }),
};
