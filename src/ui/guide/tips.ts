/** First-time tips belong to the profile, shared by the guide and Settings. */
import { loadGuideProfile, saveGuideProfile } from './progress';

const listeners = new Set<(on: boolean) => void>();

export function getGuideTips(): boolean { return loadGuideProfile().tips; }

export function setGuideTips(on: boolean): void {
  const profile = loadGuideProfile();
  if (profile.tips === on) return;
  profile.tips = on;
  saveGuideProfile(profile);
  for (const listener of listeners) listener(on);
}

/** Same-page changes reach the active city; its AbortSignal releases the subscription. */
export function watchGuideTips(listener: (on: boolean) => void, signal: AbortSignal): () => void {
  const change = (on: boolean) => listener(on);
  const off = () => { listeners.delete(change); signal.removeEventListener('abort', off); };
  if (!signal.aborted) {
    listeners.add(change);
    signal.addEventListener('abort', off, { once: true });
  }
  return off;
}
