export const DEMO_TIME = '2026-10-09T12:05:00.000Z';
const MINUTE = 60_000;
const TYPES = new Set(['motion_detected', 'button_press', 'device_online', 'device_offline']);
const SOURCES = new Set(['example', 'ring-playground', 'ring-api']);

export class DomainError extends Error {
  constructor(code, message) { super(message); this.name = 'DomainError'; this.code = code; }
}
const fail = (code, message) => { throw new DomainError(code, message); };
const iso = (value) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) fail('invalid', 'Choose a valid time.');
  return date.toISOString();
};
const member = (state, id) => state.members.find((person) => person.id === id);
const clean = (value, label, max = 500) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max)
    fail('invalid', `${label} needs 1–${max} characters.`);
  return value.trim();
};
function audit(state, actor, type, text, at) {
  state.audit.push({id: `a-${state.revision}-${state.audit.length + 1}`, at: iso(at), actor, type, text});
}

export function createDemoState({now = DEMO_TIME} = {}) {
  const clock = iso(now);
  const start = Date.parse(clock) - 5 * MINUTE;
  return {
    schema: 'care-handoff/1', revision: 0, mode: 'example', clock,
    household: {id: 'example-home', name: 'June’s home', timeZone: 'UTC'},
    members: [
      {id: 'maya', name: 'Maya', role: 'Family coordinator'},
      {id: 'lee', name: 'Lee', role: 'Nearby backup'},
      {id: 'pat', name: 'Pat', role: 'Planned visitor'},
    ],
    device: {id: 'example-front-door', name: 'Front door', status: 'online',
      lastCheckedAt: clock, statusAt: clock, source: 'example'},
    visit: {
      id: 'lunch-visit', title: 'Lunch & a short catch-up', startsAt: iso(start),
      endsAt: iso(start + 30 * MINUTE), scheduledVisitor: 'pat', owner: 'maya',
      arrival: null, completion: null, pendingHandoff: null, backupPlan: null,
      cancelled: null, notes: [],
    },
    signals: [],
    audit: [{id: 'a-0-1', at: iso(start - 30 * MINUTE), actor: 'maya', type: 'visit_planned',
      text: 'Maya planned a visit with Pat and owns the next update.'}],
  };
}

export function applyCommand(state, command, now = state.clock) {
  if (!command || typeof command !== 'object') fail('invalid', 'Choose an action.');
  if (command.revision !== state.revision)
    fail('conflict', 'This visit has a newer update. Review the current owner and try again.');
  const person = member(state, command.actor);
  if (!person) fail('invalid', 'Choose a household member.');
  if (state.visit.completion || state.visit.cancelled)
    fail('closed', 'This visit is closed. Its receipts are preserved.');
  const next = structuredClone(state);
  next.revision++;
  const at = iso(Math.max(Date.parse(iso(now)), Date.parse(state.clock)));
  next.clock = at;
  const visit = next.visit;
  const payload = command.payload || {};
  const requireOwner = () => {
    if (person.id !== visit.owner) fail('role', `${member(next, visit.owner).name} owns this update.`);
  };
  const requireVisitorOrOwner = () => {
    if (![visit.owner, visit.scheduledVisitor].includes(person.id))
      fail('role', 'The visit owner or planned visitor can record this confirmation.');
  };
  switch (command.type) {
    case 'record_contact': {
      requireOwner();
      const note = clean(payload.note, 'The update');
      visit.notes.push({actor: person.id, at, note});
      audit(next, person.id, command.type, `${person.name} recorded an update: ${note}`, at);
      break;
    }
    case 'request_handoff': {
      requireOwner();
      if (visit.pendingHandoff) fail('pending', 'A handoff is already awaiting a response.');
      const to = member(next, payload.to);
      if (!to || to.id === person.id) fail('invalid', 'Choose another household member.');
      const plan = clean(payload.plan, 'The replacement plan', 200);
      const reason = clean(payload.reason || 'Please take the next update.', 'The handoff note');
      visit.pendingHandoff = {from: person.id, to: to.id, requestedAt: at, plan, reason};
      audit(next, person.id, command.type,
        `${person.name} asked ${to.name} to take over. ${person.name} retains responsibility until acceptance. Plan: ${plan}`, at);
      break;
    }
    case 'accept_handoff': {
      const pending = visit.pendingHandoff;
      if (!pending || pending.to !== person.id) fail('role', 'The invited person can accept this handoff.');
      visit.owner = person.id;
      visit.backupPlan = {actor: person.id, acceptedAt: at, plan: pending.plan};
      visit.pendingHandoff = null;
      audit(next, person.id, command.type, `${person.name} accepted responsibility. Plan: ${pending.plan}`, at);
      break;
    }
    case 'decline_handoff': {
      const pending = visit.pendingHandoff;
      if (!pending || pending.to !== person.id) fail('role', 'The invited person can respond to this handoff.');
      visit.pendingHandoff = null;
      audit(next, person.id, command.type,
        `${person.name} declined the handoff. ${member(next, visit.owner).name} retains responsibility.`, at);
      break;
    }
    case 'confirm_arrival': {
      requireVisitorOrOwner();
      if (visit.arrival) fail('recorded', 'An arrival confirmation is already recorded.');
      const note = clean(payload.note || 'Arrival confirmed in person.', 'The arrival note');
      visit.arrival = {actor: person.id, at, note};
      audit(next, person.id, command.type, `${person.name} confirmed an arrival: ${note}`, at);
      break;
    }
    case 'complete_visit': {
      requireVisitorOrOwner();
      const note = clean(payload.note, 'The completion receipt');
      visit.completion = {actor: person.id, at, note};
      visit.pendingHandoff = null;
      audit(next, person.id, command.type, `${person.name} closed the visit: ${note}`, at);
      break;
    }
    case 'cancel_visit': {
      requireOwner();
      const note = clean(payload.note, 'The cancellation reason');
      visit.cancelled = {actor: person.id, at, note};
      visit.pendingHandoff = null;
      audit(next, person.id, command.type, `${person.name} cancelled the visit: ${note}`, at);
      break;
    }
    default: fail('invalid', 'Choose a supported visit action.');
  }
  return next;
}

export function ingestRingEvents(state, events, {now = state.clock, device} = {}) {
  if (!Array.isArray(events) || events.length > 500) fail('invalid', 'Supply up to 500 device events.');
  const at = iso(now);
  const next = structuredClone(state);
  let changed = false;
  if (device) {
    const fresh = {...next.device, ...device};
    if (typeof fresh.id !== 'string' || !fresh.id) fail('invalid', 'A Ring device ID is required.');
    if (!SOURCES.has(fresh.source)) fail('invalid', 'Choose a supported event source.');
    if (JSON.stringify(fresh) !== JSON.stringify(next.device)) {
      next.device = fresh;
      if (fresh.source !== 'example') next.mode = fresh.source;
      changed = true;
    }
  }
  const ids = new Set(next.signals.map((event) => `${event.source}:${event.id}`));
  const accepted = [];
  for (const event of events) {
    if (!event || !TYPES.has(event.type) || event.deviceId !== next.device.id) continue;
    if (typeof event.id !== 'string' || !event.id || !SOURCES.has(event.source)) continue;
    const key = `${event.source}:${event.id}`;
    if (ids.has(key)) continue;
    const occurredAt = iso(event.occurredAt);
    const inWindow = Date.parse(occurredAt) >= Date.parse(next.visit.startsAt)
      && Date.parse(occurredAt) <= Date.parse(next.visit.endsAt);
    const normalized = {id: event.id, type: event.type, deviceId: event.deviceId,
      occurredAt, receivedAt: at, source: event.source, inWindow,
      late: Date.parse(at) - Date.parse(occurredAt) > 2 * MINUTE};
    if (typeof event.subType === 'string') normalized.subType = event.subType.slice(0, 100);
    next.signals.push(normalized);
    accepted.push(normalized);
    ids.add(key);
    if (event.type.startsWith('device_') && Date.parse(occurredAt) >= Date.parse(next.device.statusAt || 0)) {
      next.device.status = event.type === 'device_online' ? 'online' : 'offline';
      next.device.statusAt = occurredAt;
    }
    changed = true;
  }
  if (!changed) return state;
  next.revision++;
  next.clock = iso(Math.max(Date.parse(at), Date.parse(state.clock)));
  for (const event of accepted) {
    const description = {button_press: 'Doorbell pressed', motion_detected: 'Motion detected',
      device_online: 'Camera came online', device_offline: 'Camera went offline'}[event.type];
    audit(next, 'ring', 'ring_event', `${description}. Source: ${event.source}. Occurred ${event.occurredAt}.`, at);
  }
  return next;
}

export function runDemoAction(state, action) {
  if (state.mode !== 'example') fail('mode', 'Example controls apply to example sessions.');
  if (action === 'overdue') {
    const next = structuredClone(state);
    const at = iso(Date.parse(state.visit.endsAt) + 5 * MINUTE);
    if (Date.parse(next.clock) >= Date.parse(at)) return state;
    next.clock = at;
    next.revision++;
    audit(next, 'demo', 'clock_advanced', 'Example clock moved to five minutes after the visit window.', at);
    return next;
  }
  if (!['doorbell', 'offline'].includes(action)) fail('invalid', 'Choose a supported example step.');
  return ingestRingEvents(state, [{
    id: `example-${action}-${state.revision + 1}`, type: action === 'doorbell' ? 'button_press' : 'device_offline',
    deviceId: state.device.id, occurredAt: state.clock, source: 'example',
  }]);
}

export function deriveView(state, now = state.clock) {
  const visit = state.visit;
  const owner = member(state, visit.owner);
  const plannedVisitor = member(state, visit.scheduledVisitor);
  const pendingRecipient = member(state, visit.pendingHandoff?.to) || null;
  const overdue = Date.parse(now) > Date.parse(visit.endsAt) && !visit.completion && !visit.cancelled;
  let status = 'scheduled', title = 'A visit is planned', detail = `${owner.name} owns the next update.`;
  if (visit.completion) {
    status = 'complete'; title = 'Visit closed'; detail = `${member(state, visit.completion.actor).name} recorded a completion receipt.`;
  } else if (visit.cancelled) {
    status = 'cancelled'; title = 'Visit cancelled'; detail = `${owner.name} recorded the reason.`;
  } else if (pendingRecipient) {
    status = 'handoff_pending'; title = `Waiting for ${pendingRecipient.name}`;
    detail = `${owner.name} keeps responsibility until ${pendingRecipient.name} accepts.`;
  } else if (visit.arrival) {
    status = 'in_progress'; title = 'Arrival confirmed'; detail = `${owner.name} owns the next update.`;
  } else if (overdue) {
    status = 'needs_update'; title = 'This visit needs an update'; detail = `${owner.name} owns the next step.`;
  }
  const lastSignal = state.signals.filter((event) => ['button_press', 'motion_detected'].includes(event.type))
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))[0] || null;
  return {status, title, detail, overdue, owner, plannedVisitor, pendingRecipient,
    lastSignal, cameraStatus: state.device.status};
}
