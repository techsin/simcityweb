import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioEngine } from '../../src/audio/AudioEngine';
import { BackgroundMute } from '../../src/audio/background';
import { DEFAULT_SETTINGS, loadSettings } from '../../src/game/settings';
import { MockContext, MockNode } from './mockAudio';

class Visibility extends EventTarget {
  hidden = false;
  show(hidden: boolean): void {
    this.hidden = hidden;
    this.dispatchEvent(new Event('visibilitychange'));
  }
}

function setup() {
  const ctx = new MockContext();
  const master = ctx.createGain();
  const background = new BackgroundMute(ctx.audio, master.gain as unknown as AudioParam);
  background.setVolume(0.64, true);
  const suspend = vi.spyOn(ctx, 'suspend');
  const resume = vi.spyOn(ctx, 'resume');
  const finish = async () => {
    const completion = ctx.nodes.filter((n) => n.kind === 'constant').at(-1)!;
    ctx.currentTime = completion.stops[0];
    completion.dispatchEvent(new Event('ended'));
    await Promise.resolve();
    await Promise.resolve();
  };
  return { ctx, master, background, suspend, resume, finish };
}

describe('background audio', () => {
  beforeEach(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() }));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reaches exactly zero within 1 s, suspends after the fade, and restores the latest volume on return', async () => {
    const { ctx, master, background, suspend, resume, finish } = setup();
    background.setHidden(true);
    expect(master.gain.valueAt(0)).toBeCloseTo(0.64);
    expect(master.gain.valueAt(0.25)).toBeCloseTo(0.32);
    expect(master.gain.valueAt(0.5)).toBe(0);
    expect(master.gain.valueAt(1)).toBe(0);
    expect(suspend).not.toHaveBeenCalled();
    background.setVolume(0.25);
    expect(master.gain.valueAt(1)).toBe(0);
    await finish();
    expect(suspend).toHaveBeenCalledTimes(1);
    expect(ctx.state).toBe('suspended');
    background.setHidden(false);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(ctx.state).toBe('running');
    expect(master.gain.valueAt(ctx.currentTime)).toBe(0);
    expect(master.gain.valueAt(ctx.currentTime + 0.5)).toBeCloseTo(0.25);
  });

  it('does nothing on visibility changes with the setting off', () => {
    const { ctx, master, background, suspend, resume } = setup();
    background.setEnabled(false);
    const events = [...master.gain.events];
    background.setHidden(true);
    ctx.currentTime = 10;
    background.setHidden(false);
    expect(master.gain.events).toEqual(events);
    expect(ctx.nodes.filter((n) => n.kind === 'constant')).toHaveLength(0);
    expect(suspend).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it('cancels a pending suspension on a quick return without a gain jump', async () => {
    const { ctx, master, background, suspend, finish } = setup();
    background.setHidden(true);
    ctx.currentTime = 0.2;
    const before = master.gain.valueAt(ctx.currentTime);
    background.setHidden(false);
    expect(master.gain.valueAt(ctx.currentTime)).toBeCloseTo(before);
    await finish();
    expect(suspend).not.toHaveBeenCalled();
    expect(master.gain.valueAt(1)).toBeCloseTo(0.64);
  });

  it('applies setting changes while hidden and keeps a user mute on return', async () => {
    const { ctx, master, background, finish } = setup();
    background.setEnabled(false);
    background.setHidden(true);
    background.setEnabled(true);
    await finish();
    expect(ctx.state).toBe('suspended');
    background.setVolume(0);
    background.setEnabled(false);
    expect(ctx.state).toBe('running');
    expect(master.gain.valueAt(ctx.currentTime + 1)).toBe(0);
    background.setHidden(false);
    expect(master.gain.valueAt(ctx.currentTime + 1)).toBe(0);
  });

  it('resumes if visibility returns before an asynchronous suspend resolves', async () => {
    const { ctx, background, suspend, resume, finish } = setup();
    let resolve!: () => void;
    suspend.mockImplementation(() => new Promise<void>((done) => { resolve = () => { ctx.setState('suspended'); done(); }; }));
    background.setHidden(true);
    await finish();
    background.setHidden(false);
    expect(resume).not.toHaveBeenCalled();
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.state).toBe('running');
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('silences a resume that completes after the tab is hidden again', async () => {
    const { ctx, master, background, resume, finish } = setup();
    background.setHidden(true);
    await finish();
    let resolve!: () => void;
    resume.mockImplementation(() => new Promise<void>((done) => { resolve = () => { ctx.setState('running'); done(); }; }));
    background.setHidden(false);
    background.setHidden(true);
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.state).toBe('suspended');
    expect(master.gain.valueAt(ctx.currentTime)).toBe(0);
  });

  it('loads both default-on flags and preserves saved opt-outs', () => {
    expect(DEFAULT_SETTINGS.musicPauses).toBe(true);
    expect(DEFAULT_SETTINGS.muteInBackground).toBe(true);
    expect(loadSettings()).toMatchObject({ musicPauses: true, muteInBackground: true });
    vi.stubGlobal('localStorage', { getItem: () => '{"musicPauses":false,"muteInBackground":false}' });
    expect(loadSettings()).toMatchObject({ musicPauses: false, muteInBackground: false });
  });

  it.each([true, false])('wires real visibility events through AudioEngine (muteInBackground=%s)', async (muteInBackground) => {
    vi.useFakeTimers();
    const doc = new Visibility();
    vi.stubGlobal('document', doc);
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => key === 'metropolis.settings.v1' ? JSON.stringify({ muteInBackground }) : null,
      setItem: vi.fn(),
    });
    const ctx = new MockContext();
    ctx.sampleRate = 8000;
    vi.stubGlobal('window', { AudioContext: function () { return ctx; } });
    const audio = new AudioEngine();
    expect(audio.init()).toBe(true);
    const master = ctx.nodes[0];
    audio.startMusic();
    const suspend = vi.spyOn(ctx, 'suspend'), resume = vi.spyOn(ctx, 'resume');
    const masterEvents = [...master.gain.events];
    doc.show(true);
    if (muteInBackground) {
      expect(vi.getTimerCount()).toBe(0);
      expect(master.gain.valueAt(0.5)).toBe(0);
      expect(audio.getSfxOutput()).toBeNull();
      const end = ctx.nodes.findLast((n) => n.kind === 'constant' && n.offset.value === 0)!;
      ctx.currentTime = 0.5;
      end.dispatchEvent(new Event('ended'));
      await Promise.resolve();
      await Promise.resolve();
      expect(suspend).toHaveBeenCalledTimes(1);
      expect(ctx.state).toBe('suspended');
      audio.init();
      audio.resume();
      expect(resume).not.toHaveBeenCalled();
      audio.setVolume('master', 0.5);
    } else {
      expect(vi.getTimerCount()).toBe(1);
      expect(master.gain.events).toEqual(masterEvents);
      expect(audio.getSfxOutput()).not.toBeNull();
    }
    doc.show(false);
    expect(ctx.state).toBe('running');
    expect(vi.getTimerCount()).toBe(1);
    if (muteInBackground) {
      expect(resume).toHaveBeenCalledTimes(1);
      expect(master.gain.valueAt(1)).toBeCloseTo(0.25);
    } else {
      expect(master.gain.events).toEqual(masterEvents);
      expect(suspend).not.toHaveBeenCalled();
      expect(resume).not.toHaveBeenCalled();
    }
    audio.stopMusic();
  });

  it('initializes silently in a hidden tab and starts the deferred music on return', () => {
    vi.useFakeTimers();
    const doc = new Visibility();
    doc.hidden = true;
    vi.stubGlobal('document', doc);
    const ctx = new MockContext();
    ctx.sampleRate = 8000;
    ctx.state = 'suspended';
    const resume = vi.spyOn(ctx, 'resume');
    vi.stubGlobal('window', { AudioContext: function () { return ctx; } });
    const audio = new AudioEngine();
    audio.startMusic();
    audio.init();
    expect(resume).not.toHaveBeenCalled();
    expect((ctx.nodes[0] as MockNode).gain.valueAt(0)).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    doc.show(false);
    expect(resume).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    audio.stopMusic();
  });
});
