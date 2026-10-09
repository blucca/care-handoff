# Ring integration

Care Handoff uses the official [Ring Partner API](https://developer.amazon.com/docs/ring/api-documentation.html) from its Node backend. Ring activity and human visit confirmations have separate records.

## Playground setup

1. Open the [Ring Developer Playground](https://developer.amazon.com/ring/console/playground) and sign in to Amazon Developer.
2. Select a simulated device and generate an access token. The Playground token lasts approximately 30 minutes.
3. Set `RING_ACCESS_TOKEN` in the backend environment. Set the household’s device ID when the token exposes multiple devices.
4. Run a live sync. The backend discovers devices, reads the selected device’s status, and fetches its event history.
5. Generate a new Playground token when the live session expires and restart the backend with the updated environment.

The [May 28, 2026 release notes](https://developer.amazon.com/docs/ring/release-notes.html#developers-playground) document synthetic Package, Vehicle, and Motion sessions plus the API explorer. Playground setup is available before app creation, account linking, and a paid Ring subscription. The canonical [Ring API Hello World](https://github.com/AmazonAppDev/ring-api-helloworld) demonstrates external applications using the Playground token.

## Backend interface

```js
import { RingClient, normalizeRingEvents, verifyWebhook, RingError } from './src/ring.mjs';

const ring = new RingClient({
  accessToken: process.env.RING_ACCESS_TOKEN,
  // baseUrl: 'https://api.amazonvision.com',
  // timeoutMs: 8000,
});

const devices = await ring.discoverDevices(); // [{ id, name }]
const snapshot = await ring.status(deviceId); // { status, checkedAt }
const result = await ring.sync({ deviceId, source: 'ring-playground' });
// { device, events, syncedAt, nextPageKey, truncated }
```

`device` matches the shared domain contract: `{id,name,status,lastCheckedAt,source}`. Status is `online`, `offline`, or `unknown`. Status snapshots retain their own observation time. History events retain the event time supplied by Ring.

The sync selects the sole discovered device automatically. Multiple devices require an explicit household device ID. History paging defaults to three pages, with a maximum of five per sync. `nextPageKey` can resume a later call; `truncated` marks a bounded or repeated-cursor page sequence. An empty history page completes the current read, preserving the cursor for future activity.

`eventHistory(deviceId, {pageKey, eventTypes = 'motion,ding'})` returns the Ring JSON:API payload. Requests use `event_types` and `page[key]`. The server uses encoded opaque device IDs and the configured API origin. Request timeouts cover headers and body; redirects fail. The default is eight seconds per request, with at most seven HTTP requests per sync.

`RingError` exposes a safe `{code,message,status}` through `toJSON()`. Error messages describe token, transport, response, rate-limit, and device-selection failures. Tokens stay in private class fields and the outbound Authorization header.

## Event mapping

`normalizeRingEvents(payload, {deviceId, source = 'ring-api'})` accepts Ring JSON:API history payloads or v1.1 webhook payloads.

| Ring input | Care Handoff type |
| --- | --- |
| History `attributes.event_type: motion` | `motion_detected` |
| History `attributes.event_type: ding` | `button_press` |
| Webhook `motion_detected` / `button_press` | Same type |
| Webhook `device_online` / `device_offline` | Same type |

Each result has `{id,type,deviceId,occurredAt,source}` and optional `subType`. `attributes.sub_type` is preserved, including future classification values. Composite history types such as `motion.human` also preserve their classification. Timestamps come from epoch-millisecond `attributes.start` / `attributes.timestamp` or an explicit-offset ISO value. Unsupported event categories are skipped; incomplete supported events fail the sync with `ring_invalid_response`. A selected device filters events from other devices. Source/event IDs deduplicate records, and output is ordered by event time.

A human classification remains a Ring activity record. Arrival and completion require the explicit commands in the domain contract. Device status queries update the status snapshot; they produce zero synthetic history events.

## Webhooks

The official partner-app path supplies an HMAC key and a configured public HTTPS webhook URL. Verify the raw request bytes before parsing JSON:

```js
if (verifyWebhook(rawBodyBuffer, request.headers['x-signature'], process.env.RING_WEBHOOK_SECRET)) {
  const events = normalizeRingEvents(JSON.parse(rawBodyBuffer.toString('utf8')), {
    deviceId: householdDeviceId,
    source: 'ring-api',
  });
  // Ingest events, persist state, and return HTTP 200 within five seconds.
}
```

The signature format is `sha256=<64 hex characters>`, calculated with HMAC-SHA256 over the exact request bytes. Comparison is constant-time. Missing secrets, malformed signatures, and changed bytes return `false`. The domain deduplicates source/event IDs. A receiving server should also retain `meta.request_id` when it needs delivery-level tracking.

## Live sessions and evaluation

The browser-local example is labeled `example`. A recorded official Playground run is separate live evidence. Live API use requires an active backend token. Reviewers can generate their own Playground token to rerun the source and keep the public example available for the full evaluation period.

A continuously connected production service uses an app’s client ID/secret and linked account refresh token. Official access tokens are typically valid for four hours and refresh tokens for approximately 30 days. That path must persist rotated refresh tokens and use the app-registration/account-linking process. The Playground client above operates with an explicitly supplied access token for a bounded live session.

Sources: [API status](https://developer.amazon.com/docs/ring/api-documentation.html#status), [event history](https://developer.amazon.com/docs/ring/api-documentation.html#event-history), [webhook verification](https://developer.amazon.com/docs/ring/api-documentation.html#webhook-authentication--verification), [developer registration](https://developer.amazon.com/docs/ring/get-started.html), [app configuration](https://developer.amazon.com/docs/ring/configure.html).
