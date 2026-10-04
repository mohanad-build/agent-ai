# Agent phone: valid at signup, loud when a text fails

Session 82. Design locked in chat.

## Why

Onboarding stores the phone exactly as typed (trim only) into agentPhone and
copies it into operatorPhone. The agent created by Google's OAuth reviewer
stored 10 digits with no "+". Twilio rejected every daily brief text for six
days, and the only trace was a log file nobody reads.

agentPhone carries five texts: the daily brief, the hot-lead alert, the urgent
needs_review alert, the Path 1B question and the Path 1B reminder. When any of
them fails, nobody is told, and the hot-lead path still reports ok. A bad
number, an empty Twilio balance, a Twilio outage or a carrier block would all
fail silently, for every agent at once.

## Decisions

1. One pure helper: src/agentPhone.js, normalizeAgentPhone(raw). Returns
   { ok: true, phone } with phone as "+1" plus 10 digits, or
   { ok: false, reason }. Never throws, because it sits on a form path.
   - null, undefined, or blank after trimming: empty. Any other non-string:
     invalid_input.
   - Allowed characters: digits, spaces, hyphens, dots, parentheses, and one
     "+" only as the first character. Anything else: invalid_characters.
   - With a leading "+": exactly 11 digits starting with 1. Without one:
     10 digits, or 11 digits starting with 1. Otherwise: wrong_length.
   - Of the 10-digit number: the area code's first digit must be 2 to 9
     (else invalid_area_code), and the exchange's first digit (the fourth
     digit) must be 2 to 9 (else invalid_exchange).
   - North American numbers only in v1. leadImport's normalizePhone does a
     different job (leads may be international) and is not touched.
2. Onboarding and the dashboard phone edit both run the submitted number
   through the helper. The onboarding phone field's label becomes "Mobile
   number (for texts)" and its placeholder becomes "416-555-0123" (the old
   placeholder, +16471234567, fails the new exchange rule). On refusal, both
   forms show the same message regardless of reason code: "That number
   doesn't look right. Enter your 10-digit mobile number, like
   416-555-0123." The reason code goes to the server log only, never the
   typed number (rule 8), and nothing is written. Onboarding re-renders the
   form with every other typed value still in the fields, HTML-escaped, so
   one phone typo does not cost the rest of the form; the dashboard edit
   keeps its existing plain 400 response, matching the other field
   validations already on that route. Onboarding stops writing the
   per-agent operatorPhone. The daily brief dry-run is left alone: it is
   never called in production, and once onboarding stops writing
   operatorPhone, a new agent's dry-run simply skips the SMS there, the
   same as a missing field does today.
3. When any agent-facing text fails, Mo gets an email, the same channel as
   the session 81 Sheet alert. Email, not SMS: if Twilio is what failed, an
   SMS alert fails too. Single-attempt send, no retry: the task is "log it
   and move on," not another delay on an already-degraded path. hot_lead is
   exempt from the daily limit: every hot-lead text failure alerts. Every
   other kind keeps at most one email per agent per kind per calendar day in
   the agent's timezone, recorded only after the email actually sends, so a
   failed alert email does not silence the next failure. Kinds: daily_brief,
   hot_lead, needs_review, path1b_question, path1b_reminder, welcome. One
   place in the code does this (src/textFailureAlert.js), not five copies.
   The lead paths' return values do not change: the lead was handled, only
   the text failed, and flipping ok could trigger reprocessing.

   Every alert email includes the exact text that failed to send.
   Subject: GetKlosed: a text to <agent name> didn't send (<kind label>).
   Body, hot_lead only, first line:
     A hot lead came in and <agent name> wasn't told. Worth a call.
   Body, every kind:
     Twilio said: <error code> <error message>
     The text they didn't get:
     <the SMS body>
   Body, every kind except hot_lead, last line:
     You'll get at most one of these a day for this kind of text.
   Subject and body use agentConfig.agentName, falling back to agentId when
   the name is missing. Kind labels: daily_brief "daily brief", hot_lead
   "hot-lead alert", needs_review "urgent review alert", path1b_question
   "property question", path1b_reminder "2-hour reminder" (welcome arrives
   in commit 4).

   checkStaleQuestions's reminder branch (src/index.js) splits its SMS send
   into its own try/catch, separate from the Sheet-write try/catch that
   follows it. The two used to share one catch, so a Sheet-write failure
   after a successful text would have been misreported as a failed text.
4. A welcome text at the end of signup, and again when the dashboard edit
   changes the number:
   "GetKlosed here. This is the number your morning brief and hot-lead alerts
   will come from. Save it as a contact so you never miss one."
   Signup done page, when Twilio accepted the send: "We've sent a welcome text
   to <number>. If it hasn't arrived in a minute, let Mo know." When Twilio
   refused it: "We couldn't send a text to that number. Mo has been notified
   and will follow up." That failure goes through decision 3 as kind welcome.
   The page says sent, not delivered: Twilio accepting a message is not
   delivery.

## Commits

1. src/agentPhone.js and its tests. Light care.
2. Onboarding and dashboard use the helper; operatorPhone; dry-run. Full care.
3. The failure email to Mo with the daily limit. Full care.
4. The welcome text and the done page lines. Full care.

When the milestone is done, docs/STATE.md records: the session 81 deploy was
verified live (brief sent by SMS and email, no digest failures, no false
Sheet alert); unella-bolton (the agent Google's reviewer created) was deleted
from the Volume; this milestone; and three parked items:
- An inactive agent logs "skipped (inactive)" followed by "sms=n/a
  email=n/a" every cycle for about an hour after its brief time, and the
  second line contradicts the first.
- server.js's setInterval does not wait for the previous orchestrator cycle
  to finish before starting the next one, and nothing elsewhere (runCycle,
  main()) guards against it either. Overlapping cycles are possible when a
  cycle runs past 5 minutes; the risk is two cycles acting on the same lead.
- Pre-existing, kept as-is by the reminder split: when the reminder text
  sends but the Sheet write fails, reminderSent is never recorded, so the
  reminder is sent again every cycle until the Sheet recovers.

## Test numbers

Tests use 555-01XX numbers, which are reserved for fiction (for example
+14165550123). Never a real number.
