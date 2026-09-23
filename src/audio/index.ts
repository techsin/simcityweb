/**
 * Audio public API — import { audio } from '../audio'.
 * See AudioEngine.ts for the full method list. Typical wiring:
 *   audio.attachAutoInit();                      // once at startup (main.ts)
 *   audio.play('click');                         // UI
 *   audio.startAmbience(); audio.setAmbience({ population, zoom, night });   // CityScene, every ~0.5 s
 *   audio.startMusic() / audio.setMusicEnabled(false)
 */
import { AudioEngine } from './AudioEngine';

export { AudioEngine, type VolumeKind } from './AudioEngine';
export { SOUND_NAMES, type SoundName, type PlayOptions } from './sfx';
export type { AmbienceParams } from './ambience';

export const audio = new AudioEngine();
