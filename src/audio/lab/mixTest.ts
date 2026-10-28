/**
 * FEEL-11 measurements through tools/render-audio.mjs (no tool changes needed):
 *   "duck=milestone&wav=1"                matched music stems, fanfare, ambience; -6 / -3 dB and recovery
 *   "duck=milestone&db=14&hold=6"         explicit music duck API (the New Year caller lives elsewhere)
 *   "background=1" / "background=1&muteInBackground=0"   live fade / suspend / resume, simulated visibility
 * Duck stems: &stem=music|reference|ambience|mix (default mix), &track=<id>&seed=<n>.
 */
import { AudioDucking } from '../ducking';
import { BackgroundMute } from '../background';
import { instantiateTrack } from '../music/director';
import { makeNoiseBuffer, makeReverb } from '../music/fx';
import { ALL_TRACKS } from '../music/tracks';
import { playVoice, SOUND_META, type SoundName } from '../sfx';
import { round } from './analysis';

function ratioDb(reference: Float32Array[], measured: Float32Array[], sr: number, from: number, to: number): number {
  let a = 0, b = 0;
  for (let ch = 0; ch < reference.length; ch++) {
    for (let i = Math.floor(from * sr), end = Math.min(reference[ch].length, Math.floor(to * sr)); i < end; i++) {
      a += reference[ch][i] ** 2;
      b += measured[ch][i] ** 2;
    }
  }
  return a > 1e-15 && b > 0 ? 10 * Math.log10(b / a) : NaN;
}

export async function renderDuck(q: URLSearchParams, timed: (ctx: OfflineAudioContext) => Promise<AudioBuffer>) {
  const name = q.get('duck') as SoundName;
  const meta = SOUND_META[name];
  if (!meta || meta.dur < 0.6) throw new Error('duck requires a sound lasting at least 0.6 s (e.g. milestone)');
  const track = ALL_TRACKS.find((t) => t.id === (q.get('track') ?? 'sunday_jazz'));
  if (!track) throw new Error('unknown duck test track');
  const explicit = q.has('db');
  const db = explicit ? Number(q.get('db')) : 6;
  const hold = explicit ? Number(q.get('hold') ?? meta.dur) : meta.dur;
  const release = explicit ? Number(q.get('release') ?? 0.6) : 0.6;
  if (![db, hold, release].every(Number.isFinite) || db <= 0 || hold < 0 || release < 0) throw new Error('invalid duck envelope');
  const sr = 44100, at = 3;
  const seconds = at + Math.max(meta.dur, 0.06 + hold + release) + 2;
  // Stems share the same notes. Separate linear reverbs let us measure music without counting the fanfare.
  const ctx = new OfflineAudioContext({ numberOfChannels: 8, length: Math.ceil(seconds * sr), sampleRate: sr });
  const merger = ctx.createChannelMerger(8);
  merger.connect(ctx.destination);
  const record = (node: AudioNode, channel: number) => {
    const split = ctx.createChannelSplitter(2);
    node.connect(split);
    split.connect(merger, 0, channel);
    split.connect(merger, 1, channel + 1);
  };
  const d = new AudioDucking(ctx);
  const reference = ctx.createGain(), music = ctx.createGain(), sfx = ctx.createGain();
  record(reference, 0);
  record(music, 2);
  record(sfx, 6);
  const dry = ctx.createGain(), wet = ctx.createGain();
  dry.gain.value = wet.gain.value = 0.55 ** 2 * 0.9;
  dry.connect(reference);
  dry.connect(d.music).connect(music);
  const refRv = makeReverb(ctx), duckRv = makeReverb(ctx), sfxRv = makeReverb(ctx);
  wet.connect(refRv.input);
  refRv.output.connect(reference);
  wet.connect(d.reverb).connect(duckRv.input);
  duckRv.output.connect(music);
  sfxRv.output.connect(sfx);
  const sfxDry = ctx.createGain();
  sfxDry.gain.value = 0.8 ** 2;
  sfxDry.connect(sfx);
  const noise = makeNoiseBuffer(ctx);
  const bed = ctx.createBufferSource(), bedGain = ctx.createGain();
  bed.buffer = noise;
  bed.loop = true;
  bedGain.gain.value = 0.04 * 0.7 ** 2;
  bed.connect(bedGain);
  bedGain.connect(merger, 0, 4);
  bedGain.connect(d.ambience).connect(merger, 0, 5);
  bed.start();
  const ti = instantiateTrack(track, ctx, dry, wet, noise, Number(q.get('seed') ?? 1) | 0, { live: false });
  ti.player.start(0.05);
  ti.player.scheduleUntil(1.5);
  let duckAt = at;
  for (let t = 0.5; t < seconds - 0.01; t += 0.5) {
    void ctx.suspend(t).then(() => {
      if (t === at) {
        duckAt = ctx.currentTime;
        if (explicit) d.duck(db, hold, release);
        else d.sound(meta.dur);
        playVoice({ ctx: ctx as unknown as AudioContext, out: sfxDry, wet: sfxRv.input, noise }, name, sfxDry, { exact: true });
      }
      ti.player.scheduleUntil(ctx.currentTime + 1.5);
      void ctx.resume();
    });
  }
  const stems = await timed(ctx);
  const channels = Array.from({ length: 8 }, (_, i) => stems.getChannelData(i));
  const ref = channels.slice(0, 2), ducked = channels.slice(2, 4);
  const heldUntil = duckAt + 0.06 + hold;
  const window = [duckAt + Math.min(0.5, (0.06 + hold) / 2), heldUntil];
  const musicDb = ratioDb(ref, ducked, sr, window[0], window[1]);
  const ambienceDb = ratioDb([channels[4]], [channels[5]], sr, window[0], window[1]);
  let recoveredAfterHold: number | null = null;
  for (let t = heldUntil; t + 0.05 < seconds; t += 0.05) {
    if (Math.abs(ratioDb(ref, ducked, sr, t, t + 0.05)) <= 1) {
      recoveredAfterHold = t + 0.05 - heldUntil;
      break;
    }
  }
  const stem = q.get('stem') ?? 'mix';
  if (!['mix', 'music', 'reference', 'ambience'].includes(stem)) throw new Error('unknown duck stem');
  const buf = ctx.createBuffer(2, stems.length, sr);
  for (let ch = 0; ch < 2; ch++) {
    const out = buf.getChannelData(ch);
    for (let i = 0; i < out.length; i++) out[i] = stem === 'reference' ? ref[ch][i] : stem === 'music' ? ducked[ch][i]
      : stem === 'ambience' ? channels[5][i] : ducked[ch][i] + channels[5][i] + channels[6 + ch][i];
  }
  return {
    buf, from: 0, to: buf.duration,
    title: `Duck: ${name} over ${track.id} (${stem})`,
    markers: [{ t: duckAt, name: 'fanfare / duck' }, { t: heldUntil, name: 'release' }, { t: heldUntil + release, name: 'unity gain' }],
    extra: {
      mode: 'duck', sound: name, track: track.id, stem, explicit, expectedMusicDb: -db,
      duckAtSec: round(duckAt, 4), measurementWindow: window.map((t) => round(t, 4)),
      musicDb: round(musicDb, 3), ambienceDb: round(ambienceDb, 3),
      recoveredAfterHoldSec: recoveredAfterHold === null ? null : round(recoveredAfterHold, 3),
      recoveredAfterFanfareSec: recoveredAfterHold === null ? null : round(heldUntil + recoveredAfterHold - (duckAt + 0.005 + meta.dur), 3),
      acceptance: {
        musicDrop: explicit ? musicDb <= -12 : Math.abs(musicDb + 6) <= 1,
        ambienceDrop: Math.abs(ambienceDb + (explicit ? 0 : 3)) < 0.1,
        recovery: recoveredAfterHold !== null && 0.06 + recoveredAfterHold <= 1,
      },
    },
  };
}

export async function runBackgroundTest(q: URLSearchParams, log: (s: string) => void) {
  const ctx = new AudioContext();
  await ctx.resume();
  const master = ctx.createGain(), tone = ctx.createOscillator(), level = ctx.createGain();
  const an = ctx.createAnalyser();
  an.fftSize = 2048;
  level.gain.value = 0.04;
  tone.connect(level).connect(master).connect(ctx.destination);
  master.connect(an);
  tone.start();
  const background = new BackgroundMute(ctx, master.gain);
  background.setVolume(0.64, true);
  const enabled = q.get('muteInBackground') !== '0';
  background.setEnabled(enabled);
  const seconds = 5, start = performance.now();
  let hiddenAt: number | null = null, shownAt: number | null = null;
  const samples: { t: number; audioTime: number; gain: number; state: string }[] = [];
  const events: { t: number; id: string }[] = [];
  const levels: number[] = [];
  const data = new Float32Array(an.fftSize);
  ctx.addEventListener('statechange', () => events.push({ t: (performance.now() - start) / 1000, id: ctx.state }));
  log(`background test: mute ${enabled ? 'on' : 'off'}, hide at 1 s, show at 3 s (simulated visibility)`);
  try {
    while ((performance.now() - start) / 1000 < seconds) {
      const t = (performance.now() - start) / 1000;
      if (hiddenAt === null && t >= 1) {
        hiddenAt = t;
        events.push({ t, id: 'hidden' });
        background.setHidden(true);
      }
      if (shownAt === null && t >= 3) {
        shownAt = t;
        events.push({ t, id: 'visible' });
        background.setHidden(false);
      }
      an.getFloatTimeDomainData(data);
      let power = 0;
      for (const v of data) power += v * v;
      levels.push(round(10 * Math.log10(power / data.length + 1e-12), 1));
      samples.push({ t, audioTime: ctx.currentTime, gain: master.gain.value, state: ctx.state });
      await new Promise((r) => setTimeout(r, 50));
    }
    const hidden = samples.filter((s) => s.t >= hiddenAt! && s.t < shownAt!);
    const zero = hidden.find((s) => s.gain === 0);
    const last = samples.at(-1)!;
    return {
      mode: 'background', seconds, muteInBackground: enabled, simulatedVisibility: true,
      hiddenAt, shownAt, events: [...events], levels, samples,
      zeroAfterHiddenSec: zero ? round(zero.t - hiddenAt!, 3) : null,
      acceptance: {
        silence: enabled ? !!zero && zero.t - hiddenAt! <= 1 : hidden.every((s) => Math.abs(s.gain - 0.64) < 1e-5),
        suspension: enabled ? hidden.some((s) => s.state === 'suspended') : hidden.every((s) => s.state === 'running'),
        restored: last.state === 'running' && Math.abs(last.gain - 0.64) < 1e-5,
      },
    };
  } finally {
    tone.stop();
    await ctx.close();
  }
}
