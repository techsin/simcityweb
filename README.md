# Lead notes (fast channel)

The cloud lead posts NOTEs to the desktop worker here first, so they do not wait for the merge lock on dev.
- One NOTE per commit, numbered like `docs/dev/queue/NOTE-0xx-*.md` on dev. A copy goes to dev later, for the record.
- Only the lead pushes to this branch.
- The desktop polls it every 30 s (`git fetch origin cloud/lead-notes`), reads new files with
  `git show origin/cloud/lead-notes:<file>`, and treats them exactly like NOTEs in docs/dev/queue.
- Replies go to the lead by send_message, as before.
