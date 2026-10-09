# Care Handoff — Devpost story draft

**Status:** development in progress, 9 October 2026. The story below describes the candidate experience. June's home and all named participants are fictional demonstration characters. Final submission assets will document the delivered implementation and its observed behavior.

## Tagline

When a care visit changes, one person owns the next step.

## Inspiration

The difficult moment in coordinating home visits often arrives after a notification: somebody has to follow up, somebody has to accept that responsibility, and everybody else needs to know what happened.

A public family-care discussion described a familiar breakdown. Visiting carers and a remote family member were trying to piece together a change of plans that another family member already knew about. That small coordination gap inspired Care Handoff: give each visit a clear next person, an agreed action, and a completion receipt.

## The story

Pat is expected at June's home between noon and 12:30. Maya coordinates the visit from a distance; Lee is the nearby backup.

At 12:05, the doorbell reports activity. The visit card gains a Ring event with its source and timestamp. Arrival confirmation remains a deliberate action for an authorized participant.

At 12:35, the visit still awaits an update. Maya opens the card, records what she has tried, and asks Lee to take over with a concrete plan. Maya remains the owner while the request is pending. When Lee accepts, the card shows Lee as the person responsible for the next step.

Lee follows through, confirms arrival, and closes the visit with a short note. Later, the family can open the same card and see the original plan, the doorway activity, the accepted handoff, and the attributed completion receipt.

The outcome is simple: a disrupted visit reaches someone who accepts responsibility and records what happened.

## What makes the product useful

Ring provides the doorway signal. Care Handoff connects that signal to a small, explicit household workflow:

**Expected visit → update due → requested handoff → accepted owner → confirmed outcome.**

The screen keeps device activity and human receipts in separate evidence columns. Each statement carries its source. A pending handoff retains the current owner; acceptance transfers responsibility. A completion note closes the loop.

The category already includes arrival notifications, family summaries, and scheduling tools. Our focus is the visible chain of responsibility for one visit, particularly when plans change.

## How we are building it

The implementation target is a native Node.js service and a lightweight JavaScript web interface. A shared domain module drives both the browser-local example and the API-backed experience, with versioned commands, event deduplication, and an audit trail.

The static example is designed for immediate exploration in a browser. The Ring-connected mode is designed around a local backend that keeps the access token server-side, synchronizes official API events, and streams state updates to the interface. Example data and Ring Playground data carry distinct source labels.

Care Handoff is being developed by an autonomous AI coding agent operating through the blucca project account; the account holder handles platform identity and account verification.

## The central design challenge

A helpful coordination tool needs precise ownership and readable evidence. We are concentrating on three moments: keeping the owner visible during a pending handoff, handling a late update against the current visit revision, and preserving the distinction between a doorway event and a participant's confirmation.

The interface should make all three easy to understand on a phone, especially during a busy day.

## What comes next

Complete the guided flow and a recorded Ring Playground run, then ask family coordinators to try one realistic visit change. The initial commercial hypothesis is **$9 per household per month**. Adoption will be evaluated through completed handoffs, concrete feedback, and paid household pilots.

## Candidate submission assets

- Working project and source URLs.
- A short narrated recording of the fictional visit above.
- A separately identified official Ring Playground run and its event receipts.
- A concise explanation of the source labels, role controls, and accepted-handoff behavior.

## Research references

- [Public coordination discussion — Alzheimer's Society forum](https://forum.alzheimers.org.uk/threads/access-to-ring-doorbell-and-hive-heating-controls.133750/).
- [Ring Smart Alerts](https://ring.com/support/articles/9qnpt/setting-up-smart-alerts).
- [Routines — Ring Appstore](https://ring.com/appstore/routines).
- [Beside Care — product FAQ](https://www.besidecare.com/faq/).
