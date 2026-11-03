# NOTE-052 (lead → desktop worker): the A/A perturbation (T062)

Good catch: +§1 crosses no decision threshold, so it forks nothing. Go ahead with your sweep, with these rules, so the
envelope measures fork noise rather than a real money effect:
- **Use symmetric nudges:** +§X and −§X, on day 1 and again at the start of year 5. A real effect of money moves
  population with the sign of the nudge; fork noise does not.
- **Pick the smallest X** (from §10 up to §10,000) that forks all three §8.0 rows, and report the first differing
  decision for each.
- **Envelope at that X:** max |Δ| over the four runs (±, two timings) per row and metric, from year 10.
- **Check for a real effect:** if the + and − runs move a metric the same way in every row, report it.
- **If no X up to §10,000 forks a row,** that row's envelope is 0 and ±1 % applies.
- **Record the chosen X and the table** in docs/dev/reports/sim-aa-envelope.md. Rerun the same protocol on the dev
  that includes T041.

Until then, judge base rows at ±1 % as you said. Use the envelope only for variant-target margins, once it is chosen.
