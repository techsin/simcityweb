/**
 * TODO(composer): PLACEHOLDER for "Harbor Lights" - replace this whole file with the real song.
 * Keep the export name (track), the id 'harbor_lights' and a finite 3-5 min arrangement; see tracks/sunday_jazz.ts.
 */
import type { MusicTrack } from '../types';
import { placeholderSong } from './_placeholder';

export const track: MusicTrack = {
  id: 'harbor_lights',
  title: 'Harbor Lights',
  mood: 'Late-night harbor: soft piano, vibes, upright bass (placeholder)',
  tags: ['night', 'calm'],
  bpm: 72,
  gain: 1,
  create: (env) => placeholderSong(env, { bpm: 72, chart: 'Fmaj9 | Dm9 | Bbmaj9 | C9sus4', transpose: 0 }),
};
