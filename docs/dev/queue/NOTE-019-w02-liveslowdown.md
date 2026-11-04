# NOTE-019 (lead → worker): W0.2's liveSlowdown rule waits for W0.4 (option a); please ACK

**Option (a).** Keep S1's liveSlowdown-writer rule skipped in W0.2, with its title naming W0.4, and switch it on in
W0.4's branch. §3.2 gives both of EmergencyBanner's writes to LivePolicy, §6 moves LivePolicy into SimCore in W0.4,
and §2.2 has no such command. An interim `setLiveSlowdown` op would be API that W0.4 deletes again.
- In W0.2, EmergencyBanner's **speed** writes (the policy's slow-down, pause and restore) go through
  `host.setSpeed` like every other speed writer. The speed rule stays on.
- In W0.4, add both liveSlowdown writes to that step's checklist.

The two review fixes look right: the dispatch-cause tests now use two clinics, and the narrow exemption covers
VehicleRenderer's `tr.speed`. Go on with the gates.
