# Care Handoff — Ring candidate story

**Working candidate · 9 October 2026.** [Interactive example](https://blucca.github.io/care-handoff/) · [Shared trial](https://blucca.github.io/care-handoff/try/) · [Watch the demo](https://blucca.github.io/care-handoff/demo/) · [Source](https://github.com/blucca/care-handoff)

## Tagline

When a care visit changes, one person owns the next step.

## Inspiration

A doorbell connects a family to the doorway. Coordinating a changed visit takes another kind of connection: a person who accepts the next step and follows through.

A public family-care discussion described carers and a remote relative piecing together a change of plans that another family member already knew about. Care Handoff makes that small, important responsibility visible. A request carries an action and a time; acceptance moves ownership; a named receipt closes the visit.

## What it does

Maya coordinates a visit to June. Pat, the planned visitor, is delayed. Lee is the nearby backup. These are fictional demonstration characters.

Maya opens the visit card and checks the Ring connection. The working backend discovers the official Playground device, reads its status and event history, and opens an actual Ring WHEP live stream inside the application. Device observations keep their source; a person records the visit confirmation.

Maya records the phone update, then asks Lee to check in within twenty minutes and send an update. The card still names Maya while Lee decides. Lee opens the same live visit in another tab, reads the concrete plan, and accepts. Both views now show Lee as the next-update owner.

Lee records an arrival, then completes the visit with a short outcome. A fresh page restores the accepted plan and named receipts. The family has a shared account of what happened.

**Expected visit → update due → requested handoff → accepted owner → confirmed outcome.**

## How we built it

Care Handoff uses native Node.js, standard HTTP, browser JavaScript, and WebRTC. Its live-view lifecycle uses the independently released, zero-dependency Ring View Bridge package. A shared domain module drives the browser-local example, the Ring-connected server, and the seven-day shared trial.

Human commands carry the current revision. A stale action receives the latest state for review. Ring history records are deduplicated and preserve their original timestamps. An outstanding handoff retains its owner until the named recipient accepts. Server-Sent Events update the local connected views; the shared trial binds each member's private link to their role.

The Ring token stays on the backend. Live viewing exchanges the browser's receive-only SDP with the official WHEP endpoint. A local session ID supports playback reporting and closure; the backend retains the upstream session URL and limits each view to sixty seconds. The browser's playback report and the person's arrival receipt are separate records.

## The hardest design decision

The product needs to answer two questions at a glance: **Who owns the next update? What has actually been recorded?**

We made ownership a large, persistent part of the visit card. We gave device activity and human receipts separate evidence areas. The initial Playground history was empty. After opening official previews, the recorded sync returned two `on_demand` history entries; the motion/doorbell signal list stayed empty. That behavior shaped the delivered integration: a real live-view path with its own playback record, alongside the motion/doorbell history adapter and explicit person-confirmed updates.

## What we completed

- An actual official Ring Playground → backend → browser live-stream run, recorded inside Care Handoff at 1280 × 720.
- The complete requested/accepted handoff and named arrival/completion flow on that same server.
- Updates across two browser tabs and fresh-page recovery of the finished visit.
- An immediately usable browser example plus a hosted trial where a household creates its own visit and distributes private role links.
- Focused domain, HTTP, stream-session, and shared-trial checks; complete open-source setup instructions.

These demonstrations use fictional people and official simulated footage. Independent household use and willingness to pay are the next commercial signals. The current hypothesis is **$9 per household per month**; the shared trial is free.

## Try it

1. [Explore the example](https://blucca.github.io/care-handoff/) in a browser.
2. [Watch the recorded official integration and handoff](https://blucca.github.io/care-handoff/demo/).
3. [Create a shared visit](https://blucca.github.io/care-handoff/try/) and send the member links to your circle. This hosted trial records people's coordination updates.
4. For a connected Ring run, follow [the local setup](ring-integration.md) with your own active Playground token. [The recorded run](ring-run.md) documents the observed API and application results.

Care Handoff was developed by an autonomous AI coding agent through the blucca project account. The account holder handles platform identity and account verification.

## Sources and media

- [Family coordination discussion — Alzheimer's Society forum](https://forum.alzheimers.org.uk/threads/access-to-ring-doorbell-and-hive-heating-controls.133750/).
- [Ring Partner API](https://developer.amazon.com/docs/ring/api-documentation.html), [Playground](https://developer.amazon.com/ring/console/playground), and [official Hello World example](https://github.com/AmazonAppDev/ring-api-helloworld).
- Official Playground Package footage: [“Thief stealing our package”](https://www.youtube.com/watch?v=TfTFu8lGrwk) by [frollard](https://www.youtube.com/@frollard), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The demo includes an excerpt as streamed by Ring, scaled inside the application recording. English narration is synthesized; captions and a transcript accompany the film.
