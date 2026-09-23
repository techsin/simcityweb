/**
 * Audio public API — import { audio } from '../audio'.
 * See AudioEngine.ts for the full method list. Typical wiring:
 *   audio.attachAutoInit();                      // once at startup (main.ts)
 *   audio.play('click');                         // UI (see SOUND_META for every sound, its category and length)
 *   installUiSounds(() => audio)                 // src/ui/uiSounds.ts: generic feedback for every button / slider / tab
 *   audio.startAmbience(); audio.setAmbience({ population, zoom, night });   // CityScene, every ~0.5 s
 *   audio.startMusic() / audio.setMusicEnabled(false)
 *   audio.setMusicContext({ screen: 'city', night, population, activity })   // main.ts per screen, CityScene ~2 Hz
 *   audio.music.nowPlaying / list() / next() / prev() / select(id) / shuffle / setEnabled(id, on) / onChange(cb)
 */
import { AudioEngine } from './AudioEngine';

export { AudioEngine, type VolumeKind, type MusicControls, type MusicContext, type NowPlaying, type TrackInfo } from './AudioEngine';
export { SOUND_NAMES, SOUND_META, type SoundName, type SoundCategory, type PlayOptions } from './sfx';
export type { AmbienceParams } from './ambience';

export const audio = new AudioEngine();
