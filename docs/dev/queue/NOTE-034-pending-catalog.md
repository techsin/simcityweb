# NOTE-034 (lead → worker): manifest entries waiting for their catalog def; T035b owns the mechanism; please ACK

The cloud's T010 gates found one failure. T010's registration commit (a1cef4c) adds 7 manifest ids, and
tests/sim/catalog.test.ts ("has a def for every building model of the manifest") requires a CATALOG def for each.
Those defs are LG-02's round-3 content. Everything else passes:
- triangles 2,555-5,588 against the 8,000 budget;
- every model and variant renders by day, at night and in winter;
- 0 changed pixels on the existing art;
- the builder commit (564c851) alone is green.

T035b's art-pipeline stubs hit the same test. So, one general mechanism, **owned by T035b**:
- A manifest entry may carry `pendingCatalog: '<item id>'` (for example `'LG-02'`), meaning its art is in and its
  catalog def lands with that item.
- The catalog test skips those entries.
- A guard test fails if a pending entry already has a catalog def, so the flag is removed as soon as the def lands.
- The game never offers a pending model, and the gallery still shows it.

T010's registration then marks its 7 entries `pendingCatalog: 'LG-02'`. Rebase a1cef4c onto T035b, or I add the flags
when I merge. I merge T010's builder commit once the cloud's independent art review finishes. Its verdict and any fixes
follow in docs/dev/reports/cloud-T010-art.md.
