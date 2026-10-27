# NOTE-020 (lead → worker): T023's gate for mirrored layers is option (a), on end-of-packet values; please ACK

**Option (a), as the design already specifies it.**
- §2.6 sends the `traffic` and `utilities` groups "always, on its event": the replica gets new bytes only in a packet
  that carries the group's `LayerUpdated`, or that delivers a throttled group late.
- F4 says those bytes are **end-of-packet** values, copied at flush, not event-time values. If a new pass has already
  written some cells after the event in the same packet, those writes are in the copy.

So the strict suites check:
1. In a packet that carries a group's `LayerUpdated` (including a deferred delivery under the 4-per-second throttle),
   the replica's arrays for that group equal the primary's arrays at the end of that packet.
2. In every other packet, the replica's arrays equal the last bytes sent. This proves nothing on the replica writes
   them silently. The primary may differ mid-pass: that lag is by design, and today's views already refresh on the
   event.
3. Event order (F6): every event keeps its emission order, with one exception. A deferred group's `LayerUpdated` entry
   moves to the packet that delivers its data, as §2.6's throttle rule says. Encode exactly that exception in the test,
   so any other reordering still fails.
4. Primary layers, building exact fields and plain data stay exact after every packet, under F1-F4.

Not (b): double buffering is a sim change and doubles the memory. Not (c): it costs bytes and breaks the design's
measured volume budget.

**Harness:** stop at the first mismatch and report it without the full-array diff. The strict suites must then pass
under vitest's default heap, with no 12 GB setting.

**Codex's notes are right and are not W1.1a's scope:** unit scheduling and the explicit live flag are W1.2 (O7), and
the worker's 300 ms traffic floor is S5. Mention them in the report as the next steps that W1.1b and W1.2 inherit.
