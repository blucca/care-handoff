# Ring View Bridge: independent open-source contribution

Care Handoff **0.3.1** adopts [Ring View Bridge **0.1.1**](https://github.com/blucca/ring-view-bridge/releases/tag/v0.1.1), an independent MIT library created during the Amazon Developer Hackathon.

## What moved into the reusable project

- A server-only Ring WHEP client with token providers, SDP bounds, and origin/device validation for upstream session Locations.
- A session pool that covers pending creates, explicit deadlines, duplicate closes, shutdown, and retryable cleanup failures.
- A native-browser receive-only viewer with first-frame callbacks and application-owned HTTP transport.
- A standalone Node + HTML app, TypeScript declarations, and focused lifecycle contracts.

Care Handoff retains device discovery, event history, visit state, named participants, the live-view dialog, and business receipts. Its backend imports the package's Node entry; its browser module is generated from the installed browser entry by `npm run vendor:bridge`.

## Reproducible adoption

`package.json` points to the public Release tarball. `package-lock.json` pins its SHA-512 integrity. Run `npm ci`, or `npm ci --allow-remote=root` with npm 12+, to install the versioned package and execute the vendor step. The generated browser module includes the package version and its MIT license.

## Official run: October 9, 2026, 12:43 UTC

Using the installed **0.1.1** package and an official Ring Playground token:

1. The application created an upstream WHEP session: **HTTP 201**.
2. The live dialog displayed **1280 × 720** video, with decoded frames advancing from **1 to 50**.
3. `video-frame-callback` triggered the application playback report: **HTTP 200**.
4. Closing the dialog deleted the upstream session: **HTTP 200**, with **0 active sessions** afterward.
5. Arrival and completion stayed empty. Those receipts are created by named participants.

Page errors: **0**. [Structured version, integrity, frame, and API observations](ring-view-bridge-run.json). The previous full Maya → Lee handoff and completion run remains in [ring-run.md](ring-run.md); its business-flow checks carry forward.

## Why other Ring developers can use it

The integration needs a video element, a server-authorized device ID, and two HTTP callbacks. The same package runs in the independent minimal viewer and this care application. Developers can keep their own framework, account-linking layer, and user workflow while reusing the streaming lifecycle.

Contribution URL: https://github.com/blucca/ring-view-bridge/releases/tag/v0.1.1  
Project repository: https://github.com/blucca/ring-view-bridge  
GitHub username: **blucca**
