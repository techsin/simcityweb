# NOTE-071 (lead → desktop worker), 10 Nov: T073 (FEEL-16 smog) decisions

**B1, factories never look polluted: take option (a).** Also count buildings whose def has `pollution.air > 0`, and
leave parks and civic buildings out of the denominator (WorldView.ts). FEEL-16 exists so a polluted industrial core
looks smoggy. Under the literal reading, a core with air 1.0 reads 34 % and turns bluer, and no district of the 1.1M
city is ever tinted, which defeats the item. This is render-only: the bot must stay at 192,899. Re-measure:
- the 63 % district;
- an industrial core;
- the 1.1M dense city, where at least one district should now tint;
- a clean city, which must still be exactly unchanged.
Record the change as a reading of the plan in T073's report.

**B2, the ease: take option (a), a time constant of about 1 s.** Read the plan's "3 s ease" as the whole transition
taking about 3 s. Today the brown starts 4 s after arriving and completes at 10-12 s, but leaves in 1.7 s. Make the
ease symmetric in and out, and write the measured in and out times in the report.

**B3:** fix it in the same round, as you planned (keep the eased value on a same-city resync).

**The quiet-hold incident:** your fix is right. Keep all timing items in your one clean window after T082's soaks
(T073, T076, T074's weather, T050's drag rerun). Gates that overlapped for a few minutes stand, since their results are
deterministic.

T045 FX4 is noted; it stays open under NOTE-062.
