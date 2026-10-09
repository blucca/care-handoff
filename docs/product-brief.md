# Care Handoff

**When a care visit changes, one person owns the next step.**

Development brief · 9 October 2026 · Working product name

## The problem

A family can have a camera, a visit schedule, and an active group chat—and still spend the next hour asking who is following up. The useful outcome is a visit that reaches a named person and an explicit completion receipt.

A [public family-care discussion](https://forum.alzheimers.org.uk/threads/access-to-ring-doorbell-and-hive-heating-controls.133750/) describes a coordination breakdown: visiting carers and a remote family member needed an update that another family member already held. This desk-research example informs our fictional demo. Household authorization and willing participation are prerequisites for shared coordination.

## Existing options

- [Ring Smart Alerts](https://ring.com/support/articles/9qnpt/setting-up-smart-alerts) classify activity and provide configurable notifications.
- [Routines in the Ring Appstore](https://ring.com/appstore/routines) lists caregiver arrival texts, schedules, reminders, and family-chat assistance at **$10 per device/month**. Its listing shows the release as “To be announced.” The separate [Routines sensor product](https://www.routines.com/) also advertises delay and departure alerts.
- [Beside Care](https://www.besidecare.com/faq/) advertises activity summaries, priority alerts, and shared family updates at **$19.99 per camera/month**.

These offerings establish the category and public price points. Care Handoff's product hypothesis is a compact, inspectable workflow for resolving one disrupted visit.

## The core

One visit card holds the expected window, planned visitor, current owner, Ring activity, and human receipts.

1. Door activity adds a timestamped device record.
2. A visit awaiting confirmation after its window becomes **Needs update**.
3. The owner requests a handoff with a reason and a concrete next step.
4. The recipient accepts; responsibility transfers at that moment.
5. An authorized participant confirms arrival and closes the visit with a short completion note.

Device events and human confirmations retain their own sources and timestamps. The original owner remains visible while a handoff awaits acceptance. Camera connection status stays visible alongside visit status.

The first story uses one fictional household, one scheduled visitor, a remote coordinator, and a nearby backup. The implementation contract is [here](implementation-contract.md).

## Commercial hypothesis

**Buyer:** the primary family coordinator of a household with Ring and recurring home visits.

**Reason to pay:** fewer phone chains, a visible person handling each change, and a durable record of the agreed action and outcome.

**Test price:** **$9 per household/month**, including one home and up to three coordinators. This is a pricing hypothesis. The initial discovery channel is the Ring caregiving ecosystem; publication and billing depend on its release process.

## Success criteria

- **Product:** a first-time user completes the guided handoff and can identify the current owner, next action, device evidence, and completion author.
- **Engineering:** the example flow survives refresh; pending handoffs preserve ownership; accepted handoffs transfer it; device ingestion preserves human receipts; stale commands produce an actionable conflict.
- **Ring evidence:** a separately recorded official Playground run shows real API-sourced events with their source labels.
- **Commercial:** three independent family coordinators complete the flow and report a concrete coordination use; one household accepts the $9/month price for a real pilot. Record usage, price acceptance, and payment separately.

