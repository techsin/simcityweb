import type { SoundName } from '../../src/audio/sfx';
import type { InstrumentName } from '../../src/audio/music/synth';

/**
 * Code audit: [native sources, processing nodes] per unpanned SFX at default intensity.
 * Ranges cover random variations. All SFX had zero JS ended handlers before this change.
 * tone = [1,1], noise = [1,2], bell = [2,2], mallet = [3,3]; add two routing gains per play.
 * fanfare(n) = [2n+4,2n+6]. A nonzero dry pan adds one processing node.
 * Warm reuse eliminates processing allocations; the listed native sources still finish once each.
 */
export type Count = number | readonly [number, number];
export const SFX_COST: Record<SoundName, readonly [Count, Count]> = {
  click: [2, 5], press: [4, 7], tap: [2, 5], hover: [1, 3], tab: [3, 6], tick: [2, 5],
  sliderRelease: [3, 6], toggle: [4, 7], toggleOn: [4, 7], toggleOff: [3, 7],
  open: [3, 6], close: [2, 5], dialogOpen: [7, 10], dialogClose: [3, 6], flyout: [3, 6], flyoutClose: [2, 5],
  grab: [2, 5], drop: [2, 5], confirm: [3, 5], cancel: [2, 4], toolSelect: [6, 9], toolOff: [2, 4],
  rotate: [4, 9], camRotate: [1, 4], overlay: [9, 12], overlayOff: [6, 8], query: [5, 8], pause: [2, 5],
  speed1: [2, 4], speed2: [3, 5], speed3: [4, 6], speed: [3, 5], save: [6, 8], autosave: [4, 6],
  shuffle: [[7, 9], [15, 19]], stepDone: [8, 10], musicPlay: [6, 8], musicPause: [4, 7], whoosh: [1, 4],
  error: [4, 8], zone: [[2, 3], [5, 7]], dezone: [2, 5], road: [[6, 7], [11, 13]], rail: [6, 9], power: [4, 9],
  pipe: [2, 4], bulldoze: [[10, 11], [21, 23]], plop: [4, 7], terraform: [7, 15], tree: [[4, 6], [10, 14]],
  construct: [2, 5], built: [4, 7], cash: [7, 10], notify: [6, 8], news: [4, 6], good: [8, 10], warning: [8, 10],
  bad: [4, 7], advisor: [8, 10], coin: [5, 8], cashLow: [2, 5], bankrupt: [7, 10], reward: [12, 16],
  milestone: [18, 22], found: [25, 29], cityReady: [8, 11], regionEnter: [7, 10], alarm: [1, 5],
  fire: [37, 40], fireBell: [8, 10], tornado: [3, 8], quake: [15, 27], meteor: [12, 24],
};

/**
 * [sources, processing nodes, previous JS ended handlers] per library note, excluding shared channel/FX setup.
 * MIDI 60 (one pitch for chordal voices), velocity .7, duration .5, default options, no per-note pan.
 * Pad/strings scale to 2n sources and 2n+1 / 2n handlers for n pitches. Optional lead vibrato adds one gain/handler;
 * flute/whistle vibrato requires dur > .3. Extra partials, breath, kick click and conga noise depend on options.
 * All per-note JS ended handlers are now zero. Native source Finish tasks are NOT removed by pooling processors.
 */
export const NOTE_COST: Record<InstrumentName | 'brushSwirl', readonly [number, number, number]> = {
  epiano: [3, 3, 0], piano: [3, 3, 0], guitar: [1, 2, 0], harp: [1, 2, 0], clav: [1, 2, 0], pizz: [1, 2, 0],
  pad: [2, 3, 3], strings: [2, 3, 2], organ: [1, 1, 0], bass: [2, 2, 0], upright: [2, 3, 0], slap: [2, 3, 0],
  synthBass: [2, 3, 0], marimba: [2, 2, 0], vibes: [2, 2, 0], bell: [2, 2, 0], glass: [2, 2, 0],
  flute: [2, 4, 1], whistle: [2, 4, 1], lead: [2, 2, 0], arp: [1, 2, 0], brass: [2, 2, 0],
  kick: [2, 2, 0], snare: [2, 2, 0], rim: [2, 1, 0], clap: [1, 1, 0], hat: [1, 1, 0], shaker: [1, 1, 0],
  brush: [1, 1, 0], brushSwirl: [1, 3, 0], tom: [1, 1, 0], triangle: [2, 1, 0], ride: [2, 2, 0],
  cymbal: [1, 1, 0], conga: [1, 1, 0], sweep: [1, 2, 0], vinyl: [1, 1, 0],
};

/**
 * Other code paths (sources / processors / JS ended handlers before pooling):
 * Ambience: bird phrase n=2..7: 2n / (2n+3) / 0; cricket: 1 / 4 / 0; horn b=1..2: 2b / (2b+4) / 0.
 * Construction adds a gain+panner per group to the construct costs above; long-lived beds are not per sound.
 * Fireworks, including dry/wet spatial chain: launch 2/7/0 (+whistle 2/2, +glitter 1/1), burst 2/7/0
 * (+rumble 1/2, +crackle is its own texture), salute 2/7/0, tick 2/3/0, texture 1/6/0.
 * Old fireworks cleanup used one timer per chain or two per countdown tick; these timers are now absent.
 * Track helpers: Blueprint sub 2/2/0, air 1/3/0; Harbor wave 1/3/0; Neon mono bass 2/3/0, mono arp 1/2/0,
 * gated snare 1/1/0 (+five shared FX nodes once). Rush Hour NoiseVoice already uses 1 source + 1 gain per song.
 * Sirens already persist per kind: 2 sources + 4 processors (3 without pan), one ended handler at teardown.
 * Director stop now uses one silent completion source and one shared handler per stop, not per note.
 *
 * Acceptance limit: the trace's 1680 native Finish tasks remain with unchanged native source synthesis.
 * Even eliminating all 2604 deletion tasks would reduce that combined count by only 60.8%, not 90%.
 * Allocation/listener assertions below are structural checks, not a browser task-count or audibility measurement.
 */
