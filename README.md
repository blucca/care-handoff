# Care Handoff

**When a care visit changes, one person owns the next step.**

[Open the interactive example](https://blucca.github.io/care-handoff/) · [Product brief](docs/product-brief.md) · [Ring integration](docs/ring-integration.md)

Care Handoff connects a scheduled household visit, Ring door activity, an accepted handoff, and a human completion receipt. The original owner keeps responsibility while a replacement decides. Acceptance transfers it. A named person records the outcome.

## Try one disrupted visit

June’s home, the visit, and the three participants are fictional example data.

1. Press the example doorbell. A timestamped device event appears beside the visit.
2. Move the example clock to 12:35. Maya owns the overdue update.
3. As Maya, ask Lee to cover the visit with a concrete plan.
4. Switch to Lee and accept. The visible owner changes to Lee.
5. Confirm arrival, then close the visit with a short note.
6. Refresh or open a second tab. The accepted handoff and completion receipt remain visible.

Device activity and participant confirmations retain separate sources and timestamps. Late events preserve the existing human receipts. A declined handoff keeps the original owner. Camera status stays visible during each stage.

![Maya remains responsible while Lee reviews the requested handoff; device activity and human receipts are shown separately.](web/preview.png)

## Run locally

Node.js **22+** provides the runtime. The app uses native JavaScript and Node HTTP APIs, with zero package dependencies.

```sh
git clone https://github.com/blucca/care-handoff.git
cd care-handoff
npm start
```

Open **http://127.0.0.1:4319/**. This serves the shared local-server example. Each browser tab can act as a different example participant. `/index.html` opens the browser-local version, which uses localStorage and cross-tab synchronization.

The backend is a **local trusted-workspace prototype**. Its role selector is for demonstration participants. Household account provisioning and production member authentication belong to the hosted-pilot phase.

To preserve server state across restarts, point `CARE_HANDOFF_STATE_FILE` at a local state file:

```sh
CARE_HANDOFF_STATE_FILE=/your/workspace/temp/care-handoff/state.json npm start
```

## Connect the official Ring Playground

1. Sign in to the [Ring Developer Playground](https://developer.amazon.com/ring/console/playground).
2. Generate a short-lived token and choose a simulated device.
3. Store the token in a private local file; give the backend its file path through `RING_TOKEN_FILE`.
4. Set `RING_DEVICE_ID` when the token exposes several devices, then start the backend.
5. Open the app’s connected mode and select **Sync Ring** to discover the device, read its status, and ingest history.

```sh
RING_TOKEN_FILE=/your/private/ring-token.txt \
RING_DEVICE_ID=your-playground-device-id \
CARE_HANDOFF_STATE_FILE=/your/workspace/temp/care-handoff/ring-state.json \
npm start
```

`RING_ACCESS_TOKEN` is an alternative environment variable. The token stays on the backend. Playground tokens last approximately 30 minutes; replacing the file supports a fresh session. `RING_SOURCE=ring-api` labels a separately configured Ring API connection. [Detailed API mapping, token lifecycle, and webhook setup](docs/ring-integration.md).

**Current evidence:** the published example exercises the complete coordination workflow. The Ring adapter is tested against local fixtures shaped from the official API contract. A recorded official Playground session is the next integration milestone.

## Architecture

```text
web/domain.mjs   Pure visit state machine, versioned commands, device-event ingestion
web/app.mjs      Browser-local and local-server UI, roles, refresh and cross-tab recovery
src/server.mjs   Local HTTP service, optional state file, server-sent updates
src/ring.mjs     Official Ring REST client, normalization, webhook HMAC verification
test/           Focused domain and HTTP-contract checks
```

The same domain functions drive both run modes. Incoming Ring events carry their original event time plus reception time. Every human mutation supplies the current revision; a stale action receives the latest visit for review. A handoff request leaves the owner in place until its named recipient accepts.

```sh
npm test
```

## Scope and status

This prototype coordinates **planned visits and participant-reported updates**. Household members choose the next action and record the completion receipt. The initial commercial hypothesis is $9 per household/month, to be tested with family coordinators.

Built during the 2026 Amazon Developer Hackathon for the Ring track. [Candidate story](docs/submission-draft.md). Care Handoff has its own user problem, workflow, source repository, and submission assets.

Development is performed by an autonomous AI coding agent through the blucca account; the account holder handles platform identity and account verification.

## License and sources

Original implementation: [MIT](LICENSE). Ring endpoint and event contracts follow the [official Ring Partner API documentation](https://developer.amazon.com/docs/ring/api-documentation.html). The [official Hello World project](https://github.com/AmazonAppDev/ring-api-helloworld) informed integration setup. [Research and existing offerings](docs/product-brief.md#existing-options).
