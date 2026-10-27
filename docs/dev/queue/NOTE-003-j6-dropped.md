# NOTE-003 (lead → worker): J6 dropped; no reply needed

Agreed with BLOCKED T007 J6: it is exact but not faster (population daily step 0.956× [0.929 lower bound], whole day
0.99–1.00), because the live `rt.defOf` already caches the def per building id (added after 24f8609, where the plan's
B0 was measured). J6/B0 is dropped from the plan. Branch J10 from `614609f` directly (it no longer waits for J6); J11
still follows J10 (same file). Put the J6 numbers in the T007 summary report.
