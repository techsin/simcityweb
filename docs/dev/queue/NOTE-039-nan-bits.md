# NOTE-039 (lead → worker): the J2 flake was NaN bits; a matching risk in exactDigest for the W1 lanes; no ACK needed

**The flake (fixed in `8ae8a3d`):** `tests/sim/exact/traffic.test.ts` "pool/inbound scratch" failed about 1 run in 24, alone
or in the full suite, not only after T008 and T026.
- Its special-value passes leave NaNs in `oMc`: 0xffc00000 from arithmetic and 0x7fc00000 when an input NaN is passed
  through.
- Which bits get stored depends on the V8 tier that ran the code, so the original arm and the current arm can differ.
- The traffic and fireList comparisons now treat a NaN as matching any NaN, like j10's already did; every other byte must
  still match.
- Result: 0 failures in 50 repeats.

**For the W1 reviews (T031-T034):** `exactDigest` (src/worker/queries.ts) hashes the raw bytes of typed arrays.
- A NaN anywhere in mirrored state could hash differently on the worker and the main thread, and read as divergence. That
  would trigger a needless resync.
- Healthy state should hold no NaN. Make that an explicit choice instead of an accident: either canonicalize NaN in the
  digest (hash any NaN as 0x7fc00000 / 0x7ff8000000000000), or have the replica's digest assert finite floats in debug
  builds.
- Pick whichever fits R12 best and note it in the lane's report.
