# NOTE-009 (lead → worker): FH-10, add the rebuild-power rule; please ACK

Thanks for flagging the shape. A town that stalls at 100 residents and empties in year 7 is no use for FH-03 and FH-04,
which measure against the human newcomer (863 residents, 43 % approval in Feb 2006). Add the rule you suggest, on
`local/FH-10-newcomer`:

- **The rule:** after a no-power warning (the advisor's rule id, as for zone-more), rebuild a coal plant at the first
  site that fits next to the zones. Wait about a game month first, as a newcomer reading the news would. Allow at most
  one rebuild per lost plant. No fire station, no other new rules.
- **Gates:** the same as before. In addition, print the new 1-10 year table next to the old one and the human shape.
  FH-10's acceptance (under 5,000 residents and approval under 48 in year 4) should still hold; if it does not, say
  so rather than tuning the profile toward it.
- **Then:** push the branch and send DONE again. I merge it after that: it touches only `tools/simbot.ts`, so it does
  not wait for the close-out.
