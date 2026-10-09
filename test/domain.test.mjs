import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoState, applyCommand, ingestRingEvents, runDemoAction, deriveView} from '../web/domain.mjs';

test('a Ring cue, accepted handoff, and human completion preserve a single owner', () => {
  let state = runDemoAction(createDemoState(), 'doorbell');
  assert.equal(state.signals.length, 1);
  assert.equal(state.visit.arrival, null);
  assert.equal(state.visit.completion, null);
  state = runDemoAction(state, 'overdue');
  assert.equal(deriveView(state).status, 'needs_update');
  state = applyCommand(state, {type: 'request_handoff', actor: 'maya', revision: state.revision,
    payload: {to: 'lee', plan: 'I can visit by 12:55.', reason: 'Please cover the lunch visit.'}});
  assert.equal(state.visit.owner, 'maya');
  assert.equal(deriveView(state).pendingRecipient.id, 'lee');
  const priorRevision = state.revision;
  state = applyCommand(state, {type: 'accept_handoff', actor: 'lee', revision: state.revision});
  assert.equal(state.visit.owner, 'lee');
  assert.throws(() => applyCommand(state, {type: 'accept_handoff', actor: 'lee', revision: priorRevision}), {code: 'conflict'});
  state = applyCommand(state, {type: 'confirm_arrival', actor: 'lee', revision: state.revision,
    payload: {note: 'Arrived with lunch.'}});
  state = applyCommand(state, {type: 'complete_visit', actor: 'lee', revision: state.revision,
    payload: {note: 'Lunch delivered and a catch-up completed.'}});
  assert.equal(deriveView(state).status, 'complete');
  const receipt = structuredClone(state.visit.completion);
  const repeated = ingestRingEvents(state, [state.signals[0]]);
  assert.strictEqual(repeated, state);
  state = ingestRingEvents(state, [{id: 'late-ring-event', deviceId: state.device.id,
    type: 'motion_detected', occurredAt: state.visit.startsAt, source: 'example'}]);
  assert.deepEqual(state.visit.completion, receipt);
  assert.equal(state.visit.owner, 'lee');
  assert.equal(state.signals.at(-1).late, true);
  assert.equal(deriveView(state).status, 'complete');
  assert.throws(() => applyCommand(state, {type: 'cancel_visit', actor: 'lee', revision: state.revision,
    payload: {note: 'Changed plan.'}}), {code: 'closed'});
});

test('declines, role checks, and out-of-order device state keep responsibility visible', () => {
  let state = createDemoState();
  state = applyCommand(state, {type: 'request_handoff', actor: 'maya', revision: state.revision,
    payload: {to: 'lee', plan: 'Please check in this afternoon.'}});
  assert.throws(() => applyCommand(state, {type: 'accept_handoff', actor: 'pat', revision: state.revision}), {code: 'role'});
  state = applyCommand(state, {type: 'decline_handoff', actor: 'lee', revision: state.revision});
  assert.equal(state.visit.owner, 'maya');
  assert.equal(state.visit.pendingHandoff, null);
  state = runDemoAction(state, 'offline');
  state = ingestRingEvents(state, [{id: 'old-online', deviceId: state.device.id, type: 'device_online',
    occurredAt: state.visit.startsAt, source: 'example'}]);
  assert.equal(state.device.status, 'offline');
  assert.equal(state.visit.arrival, null);
  assert.throws(() => applyCommand(state, {type: 'complete_visit', actor: 'maya', revision: state.revision,
    payload: {note: ''}}), {code: 'invalid'});
});
