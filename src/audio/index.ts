/**
 * Audio public API — import { audio } from '../audio'.
 * See AudioEngine.ts for the full method list. Typical wiring:
 *   audio.attachAutoInit();                      // once at startup (main.ts)
 *   audio.play('click');                         // UI
 *   audio.startAmbience(); audio.setAmbience({ population, zoom, night });   // CityScene, every ~0.5 s
 *   audio.startMusic() / audio.setMusicEnabled(false)
 *   audio.setMusicContext({ screen: 'city', night, population, activity })   // main.ts per screen, CityScene ~2 Hz
 *   audio.music.nowPlaying / list() / next() / prev() / select(id) / shuffle / setEnabled(id, on) / onChange(cb)
 */
import { AudioEngine } from './AudioEngine';

export { AudioEngine, type VolumeKind, type MusicControls, type MusicContext, type NowPlaying, type TrackInfo } from './AudioEngine';
export { SOUND_NAMES, type SoundName, type PlayOptions } from './sfx';
export type { AmbienceParams } from './ambience';

export const audio = new AudioEngine();
