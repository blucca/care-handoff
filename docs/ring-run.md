# Recorded official Ring run

**9 October 2026, 09:53 UTC · Care Handoff 0.3.0.** [Watch the 2:21 demo](https://blucca.github.io/care-handoff/demo/) · [Structured result](ring-run.json)

## What ran

The Care Handoff Node backend used an active official Playground token. Its actual `RingClient` performed these calls against `https://api.amazonvision.com`:

| Operation | Result |
| --- | --- |
| Device discovery | HTTP 200; one Playground Device |
| Device status | HTTP 200; online |
| Event history, requested `motion,ding` | HTTP 200; two `on_demand` records |
| WHEP session creation | HTTP 201; SDP answer and upstream session Location |
| WHEP session deletion | HTTP 200; upstream session closed |

The browser played the official stream **inside Care Handoff** at 1280 × 720. Its media clock advanced from 0.262 to 7.674 seconds. The backend retained the upstream session Location; the UI used its local session ID. The browser's `playing` event produced the playback report, and closing the dialog ended the upstream session.

## The observed history behavior

The first discovery/status/history run, before opening the official previews, returned zero history entries. Later, the recorded sync returned two entries with `attributes.event_type: on_demand`, including when `event_types=motion,ding` was requested. The adapter's supported motion/doorbell signals remained at zero. Live-view metadata lives in its own session log.

Arrival and completion were empty after playback. The following actions came from the demonstration participants through the real interface:

1. Maya recorded the changed plan and requested a handoff to Lee. Maya remained the owner.
2. Lee accepted in a second tab. Both tabs displayed Lee as the next-update owner.
3. Lee entered an arrival receipt, then a named completion note.
4. A fresh page restored the completed visit at revision 9.

The fictional household and official simulated footage are labeled throughout. The hosted shared trial has its own member-bound links and people-confirmed updates; this recording uses the local trusted-workspace role selector.

## Reproduce

Follow [Ring integration](ring-integration.md), select an official Playground scenario, and run the app with your active token. Use a new state-file path for a fresh visit. **Sync Ring events → Open live doorway view → Close live view** exercises the recorded integration. The separate arrival form records a person's confirmation.

The public browser example provides reusable motion/doorbell examples. Device history in a fresh official session follows the events returned by Ring.

## Footage attribution

Ring's Package preview credits [“Thief stealing our package”](https://www.youtube.com/watch?v=TfTFu8lGrwk) by [frollard](https://www.youtube.com/@frollard), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The film uses an excerpt supplied by Ring, scaled within the recorded application. Scenario waits and connection waits are condensed. Original application footage is by Blucca; narration uses a synthesized English voice.
