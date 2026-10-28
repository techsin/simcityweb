/** The page's synchronous recovery slot. Never imported by SimCore. */
import { LS_BUDGET_BYTES, packBytes, unpackBytes, type RecoveryCity, type RecoveryMarker } from './recoveryCodec';
import type { Journal } from '../worker/protocol';

const LS_MARKER = 'metropolis.recovery';
const LS_DATA = 'metropolis.recovery.data';
const LS_JOURNAL = 'metropolis.recovery.journal';
export const JOURNAL_RESERVE_BYTES = 128 * 1024;
const sameCity = (a: RecoveryCity, b: RecoveryCity) => a.regionId === b.regionId && a.tileKey === b.tileKey;

function removeLs(key: string): void {
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}

/** Store already encoded bytes; local hosts have no journal yet. */
export function storeRecoveryLs(marker: RecoveryMarker, payload: Uint8Array | null, journal?: Journal): boolean {
  let ls = false;
  if (payload && payload.length <= LS_BUDGET_BYTES - (journal ? JOURNAL_RESERVE_BYTES : 0)) {
    try { localStorage.setItem(LS_DATA, packBytes(payload)); ls = true; }
    catch { removeLs(LS_DATA); }
  } else removeLs(LS_DATA);
  marker.ls = ls;
  if (journal) {
    marker.kind = payload ? 'snapshot' : 'journal';
    if (!payload) marker.bytes = 0;
    marker.journalIdbOnly = false;
    const json = JSON.stringify(journal);
    try {
      if (json.length * 2 > JOURNAL_RESERVE_BYTES) throw new Error('Journal exceeds localStorage reserve');
      localStorage.setItem(LS_JOURNAL, json);
    } catch { removeLs(LS_JOURNAL); marker.journalIdbOnly = true; }
  } else {
    removeLs(LS_JOURNAL);
    delete marker.kind;
    delete marker.journalIdbOnly;
  }
  try { localStorage.setItem(LS_MARKER, JSON.stringify(marker)); } catch { /* storage unavailable */ }
  return ls;
}

/** Read only the marker; dirty/save checks must not unpack a multi-MB payload. */
export function peekRecoveryMarker(): RecoveryMarker | null {
  try {
    const raw = localStorage.getItem(LS_MARKER);
    if (!raw) return null;
    const m = JSON.parse(raw) as RecoveryMarker;
    return m && typeof m.at === 'number' && m.regionId && typeof m.tileKey === 'string' ? m : null;
  } catch { return null; }
}

export function readLsSnapshot(): { marker: RecoveryMarker; payload: Uint8Array | null } | null {
  const marker = peekRecoveryMarker();
  if (!marker) return null;
  let payload: Uint8Array | null = null;
  if (marker.ls) {
    try {
      const s = localStorage.getItem(LS_DATA);
      if (s) payload = unpackBytes(s, marker.bytes);
    } catch { /* corrupt or unavailable payload */ }
  }
  return { marker, payload };
}

export function discardRecoverySnapshot(city?: RecoveryCity): void {
  const m = peekRecoveryMarker();
  if (!city || !m || sameCity(m, city)) {
    removeLs(LS_MARKER);
    removeLs(LS_DATA);
    removeLs(LS_JOURNAL);
  }
}

export function clearRecoveryAfterSave(regionId: string, tileKey: string, savedAt: number): boolean {
  const city = { regionId, tileKey }, m = peekRecoveryMarker();
  // IDB cleanup can take time; a snapshot already built against this save is still restorable.
  if (m && sameCity(m, city) && m.baseSavedAt === savedAt && m.at > savedAt) return false;
  const newer = !!m && sameCity(m, city) && m.at > savedAt;
  discardRecoverySnapshot(city);
  return newer;
}
