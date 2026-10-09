# Ring developer feedback

Care Handoff uses Ring to connect a changed household visit to a person who accepts the next step and records the outcome.

The Playground made a hardware-free, end-to-end build practical. We generated a short-lived token, used standard Node HTTP calls for device discovery and status, and embedded the official 1280 × 720 WHEP stream in our own UI. The receive-only browser offer, HTTP 201 SDP response, and explicit session deletion provided a compact integration path.

Two details would make the first developer session clearer:

1. **Explain the relationship between scenario previews and event history.** Our first history response was empty. After opening Motion and Package previews, a request with `event_types=motion,ding` returned two entries typed `on_demand`. Our app keeps these viewing sessions separate from motion/doorbell observations. A short Playground explanation and an API-filter example showing this behavior would help developers choose the right event path.
2. **Align the current audio-transceiver example with the API contract.** The API documentation specifies receive-only audio and video; the downloaded Hello World hook used `sendrecv` for audio. We used `recvonly` for both, and actual playback succeeded. A single consistent example would shorten setup.

The thirty-minute token works well for development when the application reads it from a replaceable private file. A visible token-expiry countdown and a clear route from Playground testing to durable account linking would improve longer debugging sessions.

Our final recorded run performs discovery, status, history, stream creation, playback reporting, and closure; it then carries a named handoff through acceptance, arrival, completion, and fresh-page recovery. [Run details](ring-run.md).

## Friction log

### 1. Explain preview sessions and history filters

- **Task:** connect official simulated motion or doorbell activity to a visit card.
- **Steps:** generate a Playground token; read device history; open the Motion and Package previews; request device history with `event_types=motion,ding` again.
- **Expected:** the requested event filter and the preview controls have a documented relationship, so the application can select the appropriate event path.
- **Actual:** the first history response contained zero entries. A later response contained two `on_demand` records even with the motion/ding filter. The recorded API calls returned HTTP 200.
- **Severity:** Medium — integration-path selection required an additional live-view implementation.
- **Workaround:** preserve the returned types, keep viewing-session metadata in its own log, and use WHEP for official live viewing. Arrival and completion remain explicit participant actions.
- **Suggestion / priority:** **Important.** Add a Playground example showing which preview controls affect history, the returned categories, and the behavior of `event_types` for simulated devices. Link an event-generation path beside the preview controls.
- **Evidence:** [recorded API and application results](ring-run.md).

### 2. Align the audio-transceiver example

- **Task:** construct the browser SDP offer for the official WHEP endpoint.
- **Steps:** read the API's receive-only audio/video requirements and compare the downloaded Hello World hook before configuring the peer connection.
- **Expected:** the API guide and the starter hook use the same transceiver directions.
- **Actual:** the API documentation specifies receive-only audio and video; the downloaded hook used `sendrecv` for audio.
- **Severity:** Low — a documentation/example reconciliation step during setup.
- **Workaround:** set both transceivers to `recvonly`. The official endpoint returned HTTP 201, and the application played the 1280 × 720 stream.
- **Suggestion / priority:** **Important.** Update the hook and include a minimal receive-only offer/answer example beside the WHEP contract.
- **Evidence:** [working integration and transceiver setup](ring-integration.md#live-viewing-through-whep), [official Hello World repository](https://github.com/AmazonAppDev/ring-api-helloworld).
