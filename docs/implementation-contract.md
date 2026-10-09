# Care Handoff — build contract

A narrow household coordination tool: a scheduled visit, Ring door activity, a named owner for the next update, an accepted handoff, and an explicit completion receipt. Ring events and human confirmations keep distinct records. Public demo households and people are fictional.

The [shared trial](shared-trial.md) also accepts user-created visits through `createVisitState(input, {now, householdId, visitId})`. Its `mode` is `trial`, with member IDs `coordinator`, `visitor`, and `backup`; the initial device source and status are `unconnected`. The server binds each private member credential to its actor. Trial API and storage are isolated from the local trusted-workspace server below.

## Shared domain interface
`web/domain.mjs` exports `createDemoState({now} = {})`, `applyCommand(state, command, now = state.clock)`, `ingestRingEvents(state, events, {now, device} = {})`, `runDemoAction(state, action)`, and `deriveView(state, now = state.clock)`. Pure functions return a fresh state; `DomainError` has `code` and `message`. A successful write increments `revision`.

State: `{schema, revision, mode: "example" | "ring-playground", clock: ISO, household:{id,name,timeZone}, members:[{id,name,role}], device:{id,name,status,lastCheckedAt,source}, visit:{id,title,startsAt,endsAt,scheduledVisitor,owner,arrival,completion,pendingHandoff,backupPlan,cancelled,notes:[]}, signals:[], audit:[]}`. Members: `maya` / Maya / Family coordinator; `lee` / Lee / Nearby backup; `pat` / Pat / Planned visitor. Household: June’s home, fictional. Initial visit 12:00–12:30 UTC, demo now 12:05. `now` changes the anchored date/time while preserving a 30-minute visit.

Commands: `{type, actor, revision, payload}`. `record_contact` takes `{note}`; `request_handoff` takes `{to,plan,reason}`; `accept_handoff`, `decline_handoff`; `confirm_arrival` takes `{note}`; `complete_visit` takes `{note}`; `cancel_visit` takes `{note}`. Requesting a handoff retains the current owner until the recipient accepts. Owner and planned visitor can confirm an arrival or completed visit; completion needs a short note. Mutations after a completed/cancelled visit produce a clear domain error. Revision conflict uses `code: "conflict"`.

Normalized Ring events: `{id,type,deviceId,occurredAt,source}` plus optional `subType`. Supported types: `motion_detected`, `button_press`, `device_online`, `device_offline`. Sources `example`, `ring-playground`, `ring-api`. Ingestion deduplicates source/event id and keeps a timestamped activity record. Human visit confirmation fields change through deliberate commands.

`runDemoAction(state, "doorbell" | "overdue" | "offline")`: add a clearly labeled example doorbell event, move the demo clock to 5 minutes after the visit window, or add an offline device event. Reset via `createDemoState()`.

`deriveView` returns `{status, title, detail, overdue, owner, plannedVisitor, pendingRecipient, lastSignal, cameraStatus}`; people are member objects. Status: `complete`, `cancelled`, `handoff_pending`, `in_progress`, `needs_update`, `scheduled`.

Audit item `{id,at,actor,type,text}`. Human receipts `{actor,at,note}`. Pending handoff `{from,to,requestedAt,plan,reason}`. Backup plan `{actor,acceptedAt,plan}`.

## UI and run modes
Static Pages defaults to browser-local example mode with localStorage and cross-tab sync. Role switcher identifies demo roles. A short guided scenario walks through Ring activity → visit update due → Maya requests Lee → Lee accepts → Lee confirms and closes the visit. Show the latest owner and the separate device / human evidence columns at all times. Keyboard/mobile-friendly, large calm typography and a distinctive editorial layout.

`?live=1` uses GET `/api/state` returning `{state, view, ring:{mode,configured}}`; POST `/api/commands` sends a command and returns the same envelope; GET `/api/stream` emits SSE `state` with that envelope; POST `/api/ring/sync` synchronizes the official API. Error JSON `{error:{code,message},state}` (409 conflicts). `/api/demo/action` accepts `{action}`, `/api/demo/reset` resets examples; these example endpoints are enabled for example state. Live UI shows Ring source and token state from the returned envelope.

Official API calls run in a local Node backend. Access token stays server-side. The published example mode and a recorded live Playground run form separate evidence. The simulator login is a one-time human account step; engineering continues through the public documented HTTP contract.
