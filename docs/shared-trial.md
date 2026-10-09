# One visit, your own circle

[Start a shared trial](https://blucca.github.io/care-handoff/try/)

The trial makes a single visit usable by three people on separate devices. One private link belongs to the original coordinator, one to the planned visitor, and one to the backup. The coordinator owns the next update at creation. The invited recipient accepts a concrete plan to take responsibility.

## What the links do

- Each 256-bit random link opens one member’s role. The server binds commands to that member; role selection belongs to the separate fictional example.
- The coordinator receives all three links at creation. Send each link directly to its named recipient. The holder can perform that member’s permitted actions.
- Keep or bookmark your own link to return from another device. The public entry resolves the current preview-service address, so the same saved entry can follow a hosting-address update.
- After a page reload, the original coordinator can generate a fresh visitor or backup link. That action replaces the selected person’s previous link.
- Acceptance moves visit responsibility. The original coordinator keeps link-management and erasure permissions for the trial’s lifetime.

First names or distinct aliases and general visit plans fit the trial. Each action is attributed to the member-specific link used for it. The UI keeps arrival, acceptance, and completion as deliberate participant actions.

## Data and lifetime

The service stores the visit, timestamped member actions, and optional trial feedback in private server files. It stores SHA-256 digests of member credentials. Links carry their credential in the URL fragment; requests send it in the Authorization header. Pages use a no-referrer policy, and the API returns private, uncached responses.

Records and optional feedback, including a follow-up email when supplied, expire **seven days after creation**. The expiry worker runs once per minute. Access ends at the expiry timestamp. The original coordinator can erase the visit and its feedback earlier, which disables every member link. Copy the plain-text summary to keep a portable outcome.

Preview hosting uses a Cloudflare development tunnel. The public entry remains at the URL above; service-address changes are published through `web/try/endpoint.json`. The current service runs in a private workspace, with up to 100 active visits and bounded requests. The Ring-connected local prototype is a separate service and state store.

## Run the shared service locally

Node.js 22+ supplies the complete runtime.

```sh
CARE_TRIAL_DIR=/your/private/care-handoff-trials npm run trial
```

Open **http://127.0.0.1:4320/?trial=1**. The app refreshes shared state every five seconds while visible and when a device returns to the page. Every command includes a revision; a conflicting update returns the latest authenticated visit for review.

For HTTPS preview hosting, keep Node bound to loopback and set the exact origin:

```sh
HOST=127.0.0.1 PORT=4320 \
CARE_TRIAL_DIR=/your/private/care-handoff-trials \
CARE_TRIAL_ORIGIN=https://your-preview.trycloudflare.com \
npm run trial
```

`CARE_TRIAL_TTL_SECONDS` supports a shorter development lifetime, up to 604800 seconds. The published trial uses the full seven days. A visit ends after the current time and within its trial lifetime.

## API outline

| Route | Access | Result |
| --- | --- | --- |
| `GET /api/trial/health` | Public | Version and configured lifetime |
| `POST /api/trial/visits` | Same-origin JSON | New visit, coordinator credential, two invitations |
| `GET /api/trial/state` | Member bearer credential | Shared state and the authenticated member |
| `POST /api/trial/commands` | Member bearer credential | Versioned domain action |
| `POST /api/trial/invites` | Original coordinator | Replacement link for visitor or backup |
| `POST /api/trial/feedback` | Member bearer credential | Private, optional use-case and price feedback |
| `DELETE /api/trial/visit` | Original coordinator | Erase visit, feedback, and credentials |

Creation fields: `householdName`, `title`, `coordinatorName`, `visitorName`, `backupName`, `startsAt`, `endsAt`, `timeZone`. Dates include a UTC offset; the browser supplies its local time zone. Commands reuse the [domain contract](implementation-contract.md).

## Evidence and commercial question

Internal acceptance used fictional people in two isolated browser contexts, including a 390-pixel mobile view. It exercised creation, the pending owner, cross-device acceptance, arrival, completion, fresh-page recovery, a private feedback receipt, replacement links, and erasure. The test records were erased after acceptance.

The next signal is an independent person completing a useful visit with their circle. A future **$9/household/month** plan is the commercial hypothesis; the optional feedback form asks whether the participant would like a paid pilot. Usage, stated interest, and payment remain separate records.

The shared trial records human coordination. The [Ring adapter](ring-integration.md) supplies device discovery, status, history, and verified webhooks in the separate local integration. The official Playground recording follows account sign-in.
