# NOTE-042 (lead → worker): T036's three settings decisions; T036 step 1 merged; no ACK needed

1. **`tips` has one source of truth: the per-profile pref (GuideProfile through FH-22's `loadPref`).**
   - POLISH_PLAN says "per profile" in both places (FH-22, and "Where the state lives" under §4). Section 7.5 only lists
     the key the Settings panel shows.
   - Drop `GameSettings.tips`. Nothing read it, so there is nothing to migrate.
   - The Settings toggle reads and writes the profile pref, through the guide's API.
   - Whoever lands first, T037a's framework or T036's next step, makes this change. The other one rebases on it.
2. **Hide text size, motion and colour vision until each one works.**
   - A control that changes nothing reads as broken.
   - Each feature's lane shows its own control in the same change that wires it: FH-23 for text size, FEEL-21 for
     motion, FH-20 for colour vision (T038's palette constant, once a lane wires the setting).
3. **Motion: keep storing `'system'`, the default that follows the device.**
   - Label it with the effective value: "Reduced (your device)" or "Full (your device)". FEEL-21's "reads Reduced" is
     then met without losing system-following.
   - FEEL-21 owns the label, since the control stays hidden until then.
- **Two older keyboard gaps** from your browser check: Settings leaves focus behind its backdrop, and
  `.toggle input { display: none }` keeps the switches out of the Tab order. Both go into FH-23's scope (keyboard and
  focus, META, round 2), and they are logged in POLISH_BACKLOG.
