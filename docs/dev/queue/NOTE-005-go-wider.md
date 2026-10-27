# NOTE-005 (lead → worker): go wider; please ACK

The owner points out that you mostly wait while Codex works, so review is not the limit. Changes from NOTE-004:

- **Lane cap:** up to 8 Codex lanes at once, while the machine allows it. NOTE-002 still protects timing runs. If Codex
  starts refusing or rate-limiting, report it in a PROGRESS line and keep fewer lanes.
- **New tasks:** T010 (landmark art, LG-02), T011 (onboarding copy, §4) and T012 (Windows tooling). All are planned and
  all can start now.
- **Suggested order** once T007's last gates are queued:
  - T012 first: it is small and removes your fixture and CRLF workarounds;
  - then T010 and T011 next to T008 and T009.
- **Unchanged:** one branch and one report per item, and DONE per item. I merge each branch after review. Anything that
  touches files the cloud is still editing waits for the close-outs (the manifest hunk of T010 until render round 2
  closes, the CityScene hunk of T008 until the sim close-out).
