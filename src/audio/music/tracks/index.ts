/**
 * Track registry: ALL_TRACKS is the director's playlist (order = sequential play order when shuffle is off).
 * One file per track; each exports `track: MusicTrack` with id === file name.
 */
import type { MusicTrack } from '../types';
import { track as sunday_jazz } from './sunday_jazz';
import { track as avenida_bossa } from './avenida_bossa';
import { track as blueprint_ambient } from './blueprint_ambient';
import { track as rush_hour_funk } from './rush_hour_funk';
import { track as neon_skyline } from './neon_skyline';
import { track as greenbelt_pastoral } from './greenbelt_pastoral';
import { track as harbor_lights } from './harbor_lights';

export const ALL_TRACKS: MusicTrack[] = [sunday_jazz, avenida_bossa, blueprint_ambient, rush_hour_funk, neon_skyline, greenbelt_pastoral, harbor_lights];
