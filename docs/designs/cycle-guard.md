# Cycle guard: no overlapping cycles, and a stuck cycle heals itself

Session 82. Design locked in chat.

## Why

server.js starts runCycle on a fixed 5-minute setInterval without checking
whether the previous cycle finished. A cycle that runs long overlaps the next
one, and two cycles can act on the same lead (two replies). Cycles grow with
every agent, since agents run one after another.

A plain "skip if running" guard creates a worse failure: a cycle that hangs
(a network call that never answers) makes every later tick skip forever.
Nothing crashes, so nothing looks wrong, and the system has stopped.

## Decisions

1. One in-process flag. A tick that finds a cycle running logs one line
   (how long the running cycle has been going) and does nothing else. The
   flag clears when the cycle ends, including when it throws.
2. Every finished cycle logs its duration in one line, so the 5-minute
   budget can be watched as agents are added.
3. Watchdog: a separate timer checks about once a minute. If the current
   cycle has run 30 minutes, it appends one line (timestamp and how long the
   cycle ran) to a restart log on the Volume, logs a loud line, and exits
   the process. Railway restarts it. State lives in files and Gmail labels,
   so the fresh process resumes on its own. The watchdog works because a
   hung network call does not block Node's event loop; a CPU-bound loop
   would, and is not this case.
4. The weekly operator digest counts restart-log lines from the last 7
   days. Count above zero: one line saying how many. Log unreadable for a
   reason other than not existing: one line saying it could not be read.
   No file or zero: nothing.
5. Known costs, accepted: up to 30 minutes before recovery; a lead whose
   reply was sent but not yet marked handled when the process exits can be
   answered twice (the same risk any crash already carries); a signup in
   flight at that second sees an error.

## Requirement outside the code

Railway's restart policy must restart the service when the process exits
with an error. Confirmed by Mo in the Railway dashboard before deploy.

## STATE.md

When this milestone is done, docs/STATE.md records this milestone, and one
parked item: the existing weekly digest plain-text section headers (for
example "Aggregate stats") are wrapped in em dashes; convert them to
hyphens. The new Restarts section already uses hyphens (CLAUDE.md rule 7);
the rest of that renderer predates the rule.
