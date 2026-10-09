import { openRingLiveView } from './ring-live.mjs';
import { createDemoState, applyCommand, runDemoAction, deriveView } from './domain.mjs';
import { TrialClient, newTrialDefaults, setupMarkup, accessMarkup, linksDialog, feedbackDialog, eraseDialog } from './trial.mjs';

const app = document.querySelector('#app');
const trial = new URLSearchParams(location.search).get('trial') === '1';
const live = trial || new URLSearchParams(location.search).get('live') === '1';
const trialClient = trial ? new TrialClient() : null;
const setupValues = newTrialDefaults();
const feedbackValues = {};
let feedbackSent = false;
let feedbackStatus = '';
let linkStatus = '';
let trialPoll;
let polling = false;
const STORAGE_KEY = 'care-handoff.example.v1';
const ACTOR_KEY = 'care-handoff.actor.v1';
const CHANNEL = 'care-handoff.example.sync.v1';
const icon = (name, cls = '') => {
  const paths = {
    home: '<path d="m3 10 9-7 9 7v10H3Z"/><path d="M8 14h8m-3-3 3 3-3 3"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9Z"/><path d="M10 21h4"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    people: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m2 9v-2a6 6 0 0 0-2-4"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H4v13h4"/>',
    receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6m-6 4h6"/>',
    reset: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7"/>',
    note: '<path d="M4 4h16v12H9l-5 4V4Z"/><path d="M8 8h8m-8 4h5"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    signal: '<path d="M3 8a14 14 0 0 1 18 0M6 12a9 9 0 0 1 12 0m-9 4a4 4 0 0 1 6 0"/><circle cx="12" cy="20" r=".5"/>',
    offline: '<path d="m3 3 18 18M3 8a14 14 0 0 1 3-2m4-1a14 14 0 0 1 11 3M6 12a9 9 0 0 1 3-2m6 1a9 9 0 0 1 3 1m-9 4a4 4 0 0 1 6 0"/><circle cx="12" cy="20" r=".5"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
    chevron: '<path d="m9 5 7 7-7 7"/>',
  };
  return `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.note}</svg>`;
};
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const e = escapeHTML;
const uid = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let state;
let serverView;
let ring = {};
let record;
let actor = readActor();
let channel;
let composer = null;
let busy = false;
let message = null;
let connection = live ? 'connecting' : 'local';
let persistent = true;
let stream;
let historyExpanded = false;
let signalHistoryExpanded = false;
const drafts = { handoffTo: 'lee', handoffPlan: '', handoffReason: '', contactNote: '', arrivalNote: '', completionNote: '', cancelNote: '' };

function readActor() {
  try { return sessionStorage.getItem(ACTOR_KEY) || 'maya'; } catch { return 'maya'; }
}
function validState(value) {
  return value && value.visit && Array.isArray(value.members) && Array.isArray(value.signals) && Array.isArray(value.audit) && Number.isFinite(value.revision);
}
function readRecord() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return value && typeof value.epoch === 'string' && validState(value.state) ? value : null;
  } catch { return null; }
}
function persistRecord(value) {
  record = value;
  state = value.state;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); persistent = true; }
  catch { persistent = false; }
  channel?.postMessage({ record: value });
}
function adoptRecord(value, announce = false) {
  if (!value || !validState(value.state)) return;
  if (record?.epoch === value.epoch && record.state.revision >= value.state.revision) return;
  record = value;
  state = value.state;
  if (announce) message = { kind: 'success', text: 'The care circle has a new update. This view is current.' };
  render();
}
function withLock(task) {
  return navigator.locks?.request ? navigator.locks.request(STORAGE_KEY, task) : task();
}
function member(id) {
  const memberId = typeof id === 'object' ? id?.id : id;
  return state?.members.find(person => person.id === memberId) || { id: memberId || 'system', name: memberId === 'system' ? 'System' : memberId || 'Care circle', role: '' };
}
function view() { return live && serverView ? serverView : deriveView(state); }
function formatTime(value, { date = false, seconds = false } = {}) {
  if (!value || Number.isNaN(Date.parse(value))) return 'Time pending';
  const options = { hour: 'numeric', minute: '2-digit', timeZone: state?.household?.timeZone || 'UTC' };
  if (seconds) options.second = '2-digit';
  if (date) { options.month = 'short'; options.day = 'numeric'; }
  try { return new Intl.DateTimeFormat('en-US', options).format(new Date(value)); }
  catch { return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(new Date(value)); }
}
function dateLabel(value) {
  try { return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: state?.household?.timeZone || 'UTC' }).format(new Date(value)); }
  catch { return 'Example visit'; }
}
function zoneLabel() {
  try { return new Intl.DateTimeFormat('en-US', { timeZone: state.household.timeZone || 'UTC', timeZoneName: 'short' }).formatToParts(new Date(state.clock)).find(part => part.type === 'timeZoneName')?.value || 'UTC'; }
  catch { return 'UTC'; }
}
function time(value, options) { return `<time datetime="${e(value)}" title="${e(value)}">${e(formatTime(value, options))}</time>`; }
function avatar(person, size = '') { return `<span class="avatar avatar-${e(person?.id || 'system')} ${size}" aria-hidden="true">${e(person?.name?.slice(0, 1) || '•')}</span>`; }
function sourceName(source) { return ({ example: 'Example signal', 'ring-playground': 'Ring Playground', 'ring-api': 'Ring API', ring: 'Ring event', demo: 'Example clock' })[source] || source || 'Example signal'; }
function signalName(type) {
  return ({ button_press: 'Doorbell pressed', motion_detected: 'Motion detected', device_online: 'Doorbell came online', device_offline: 'Doorbell went offline' })[type] || String(type || 'Door activity').replaceAll('_', ' ');
}
function setMessage(text, kind = 'success') { message = { kind, text }; }
function sourceLabel() {
  if (trial) return 'Private shared trial';
  if (!live) return 'Browser-local example';
  if (state?.mode === 'example') return 'Server example';
  return ring.mode && String(ring.mode).includes('playground') ? 'Ring Playground' : 'Ring-connected prototype';
}
function disabled(condition = false) { return busy || condition ? ' disabled' : ''; }
function actionButton(action, label, { kind = 'secondary', glyph = '', extra = '', disabled: blocked = false } = {}) {
  return `<button type="button" class="button button-${kind}" data-action="${action}" ${extra}${disabled(blocked)}>${glyph ? icon(glyph) : ''}<span>${e(label)}</span>${kind === 'primary' ? icon('arrow', 'button-end') : ''}</button>`;
}
function roleSelect() {
  if (trial) return `<div class="trial-identity"><span>Your private visit role</span><div>${avatar(member(actor), 'avatar-small')}<strong>${e(member(actor).name)}</strong></div><p>${e(member(actor).role)} · Actions are recorded through your personal link.</p><button class="text-button" data-action="trial-links">${trialClient.info?.coordinator ? 'Share private visit links' : 'Save your link for another device'} ${icon('copy')}</button></div>`;
  return `<div class="role-selector"><label for="actor-select">Viewing &amp; acting as</label><div class="role-select-wrap">${avatar(member(actor), 'avatar-small')}<select id="actor-select" aria-describedby="role-help">${state.members.map(person => `<option value="${e(person.id)}"${person.id === actor ? ' selected' : ''}>${e(person.name)} · ${e(person.role)}</option>`).join('')}</select></div><p id="role-help">Example people. Actions carry the selected person’s name.</p></div>`;
}
function header() {
  return `<header class="site-header"><a class="brand" href="${e(trial ? location.href : location.pathname + (live ? '?live=1' : ''))}" aria-label="Care Handoff home"><span class="brand-mark">${icon('home')}</span><span>care<span class="brand-weight">handoff</span><small>One circle. A clear next step.</small></span></a><div class="header-tools"><span class="mode-tag"><span class="mode-dot"></span>${e(sourceLabel())}</span>${trial && !state ? '<a class="text-button about-button" href="https://blucca.github.io/care-handoff/">Explore the example</a>' : `<button class="text-button about-button" data-action="about">About<span class="desktop-word"> this prototype</span>${icon('info')}</button>`}</div></header>`;
}
function messageMarkup() {
  if (!message) return '<div id="message-region" aria-live="polite"></div>';
  return `<div id="message-region" class="message message-${e(message.kind)}" role="${message.kind === 'error' ? 'alert' : 'status'}">${icon(message.kind === 'error' ? 'info' : 'check')}<p>${e(message.text)}</p><button class="icon-button" data-action="dismiss-message" aria-label="Dismiss message">${icon('close')}</button></div>`;
}
function getGuideStep(v) {
  if (v.status === 'complete' || v.status === 'cancelled') return 6;
  if (state.visit.arrival) return 5;
  if (state.visit.backupPlan) return 4;
  if (state.visit.pendingHandoff) return 3;
  if (v.overdue) return 2;
  if (state.signals.some(signal => ['button_press', 'motion_detected'].includes(signal.type))) return 1;
  return 0;
}
function demoGuide(v) {
  if (state.mode !== 'example') return '';
  const step = getGuideStep(v);
  const labels = ['Door activity', 'Update due', 'Ask for backup', 'Accept handoff', 'Confirm arrival', 'Close the visit'];
  const copy = [
    ['Start with a doorbell event.', 'A device event enters the log; Maya still owns the next update.', 'Ring the example doorbell', 'demo-doorbell'],
    ['Let the visit window pass.', 'Advance the example clock to five minutes after the planned visit.', 'Advance the example clock', 'demo-overdue'],
    ['Maya asks Lee for a clear next step.', 'Send a plan with the request. Ownership stays with Maya while Lee decides.', actor === 'maya' ? 'Prepare the handoff' : 'Switch to Maya', actor === 'maya' ? 'guide-handoff' : 'guide-maya'],
    [`${member(state.visit.pendingHandoff?.to || 'lee').name} chooses whether to take over.`, 'Accept the request to transfer the next-update responsibility.', actor === state.visit.pendingHandoff?.to ? 'Review the invitation' : `Switch to ${member(state.visit.pendingHandoff?.to).name}`, actor === state.visit.pendingHandoff?.to ? 'guide-review' : 'guide-recipient'],
    ['Record a person-confirmed arrival.', 'The new owner leaves a check-in receipt for the care circle.', actor === member(state.visit.owner).id ? 'Record the arrival' : `Switch to ${member(state.visit.owner).name}`, actor === member(state.visit.owner).id ? 'guide-arrival' : 'guide-owner'],
    ['Close with a short completion receipt.', 'A named person, a time, and a note give the household a shared ending.', actor === member(state.visit.owner).id ? 'Write the completion receipt' : `Switch to ${member(state.visit.owner).name}`, actor === member(state.visit.owner).id ? 'guide-completion' : 'guide-owner'],
    [v.status === 'complete' ? 'The visit has a clear ending.' : 'This example visit is closed.', 'Explore the activity and receipts, or reset the story for another role.', 'Start the example again', 'reset'],
  ][step];
  return `<section class="demo-guide" id="demo-guide" aria-labelledby="guide-title"><div class="guide-heading"><span class="eyebrow">A one-minute walkthrough</span><button class="text-button" data-action="reset"${disabled()}>${icon('reset')}Reset example</button></div><ol class="guide-steps" aria-label="Example story progress">${labels.map((label, index) => `<li class="${index < step ? 'step-done' : index === step ? 'step-current' : ''}"${index === step ? ' aria-current="step"' : ''}><span class="step-number">${index < step ? icon('check') : index + 1}</span><span>${label}</span></li>`).join('')}</ol><div class="guide-current"><div><h2 id="guide-title">${e(copy[0])}</h2><p>${e(copy[1])}</p></div>${actionButton(copy[3], copy[2], { kind: 'guide', glyph: step === 6 ? 'reset' : 'arrow' })}</div></section>`;
}
function cameraBanner(v) {
  if (v.cameraStatus !== 'offline' && state.device?.status !== 'offline') return '';
  return `<aside class="camera-banner" aria-label="Doorbell connection update">${icon('offline')}<div><strong>The doorbell is offline.</strong><p>${e(v.owner?.name || member(state.visit.owner).name)} still owns the next update. Direct contact and visit receipts remain available.</p></div><span>Last checked ${time(state.device?.lastCheckedAt)}</span></aside>`;
}
function ownerPanel(v) {
  const owner = v.owner || member(state.visit.owner);
  const planned = v.plannedVisitor || member(state.visit.scheduledVisitor);
  const pending = state.visit.pendingHandoff;
  const terminal = ['complete', 'cancelled'].includes(v.status);
  return `<section class="owner-panel" aria-label="Current responsibility"><div class="owner-caption"><span class="eyebrow">${terminal ? 'Final update owner' : 'Next update owner'}</span><span class="shared-tag">${icon('people')}Shared with the care circle</span></div><div class="owner-identity">${avatar(owner, 'avatar-large')}<div><h3>${e(owner.name)}</h3><p>${e(owner.role)}</p></div><div class="ownership-seal">${icon(terminal ? 'check' : 'receipt')}<span>${terminal ? 'Visit closed' : 'Owns the next step'}</span></div></div>${pending ? `<div class="handoff-strip"><span class="handoff-label">Handoff requested</span><div class="handoff-route"><strong>${e(member(pending.from).name)}</strong>${icon('arrow')}<strong>${e(member(pending.to).name)}</strong><span>Awaiting acceptance</span></div><p><strong>${e(owner.name)} owns the next update</strong> until ${e(member(pending.to).name)} accepts.</p><blockquote>${e(pending.plan)}</blockquote></div>` : state.visit.backupPlan ? `<div class="accepted-plan"><span>${icon('check')}Accepted plan</span><p>${e(state.visit.backupPlan.plan)}</p><small>${e(member(state.visit.backupPlan.actor).name)} accepted at ${time(state.visit.backupPlan.acceptedAt)}</small></div>` : `<p class="owner-context">${e(planned.name)} is the planned visitor. ${e(owner.name)} keeps the next update moving.</p>`}</section>`;
}
function deviceEvidence(v) {
  if (trial && state.device?.source === 'unconnected') return `<section class="evidence-block device-evidence" aria-labelledby="device-title"><div class="evidence-heading"><span class="evidence-number">01</span><h3 id="device-title">Device activity</h3>${icon('bell')}</div><span class="evidence-kicker">Ring connection: separate setup</span><div class="signal-primary signal-waiting">${icon('info')}<div><strong>This trial uses people’s updates.</strong><p>Arrival and completion are recorded by your circle.</p></div></div><a class="text-button" href="https://blucca.github.io/care-handoff/" target="_blank" rel="noreferrer">Explore the Ring example ${icon('arrow')}</a></section>`;
  const signals = [...state.signals].reverse().sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  const activity = signals.find(signal => ['button_press', 'motion_detected'].includes(signal.type));
  const offline = v.cameraStatus === 'offline' || state.device?.status === 'offline';
  const lateSignals = signals.filter(signal => signal.late);
  return `<section class="evidence-block device-evidence" aria-labelledby="device-title"><div class="evidence-heading"><span class="evidence-number">01</span><h3 id="device-title">Device activity</h3>${icon('bell')}</div><span class="evidence-kicker">Recorded by the doorbell</span><div class="signal-primary ${activity ? '' : 'signal-waiting'}">${icon(activity ? 'bell' : 'clock')}<div><strong>${activity ? e(signalName(activity.type)) : 'Waiting for door activity'}</strong><p>${activity ? `${time(activity.occurredAt)} <span class="source-chip">${e(sourceName(activity.source))}</span>` : 'A door event will appear here.'}</p></div></div><div class="camera-line"><span class="status-dot ${offline ? 'dot-offline' : 'dot-online'}"></span><span>${e(state.device?.name || 'Front doorbell')}</span><strong>${offline ? 'Offline' : e(v.cameraStatus === 'online' || state.device?.status === 'online' ? 'Online' : state.device?.status || 'Status pending')}</strong></div>${live && !trial && ring.configured && state.mode !== 'example' ? `<div class="live-view-entry">${actionButton('view-ring-live', 'Open live doorway view', {kind: 'secondary', glyph: 'signal'})}</div>` : ''}${lateSignals.length ? `<p class="late-summary">${icon('clock')} ${lateSignals.length} delayed ${lateSignals.length === 1 ? 'event' : 'events'} recorded with original times.</p>` : ''}<details class="signal-history"${signalHistoryExpanded ? ' open' : ''}><summary>Door activity log <span>${signals.length}</span>${icon('chevron')}</summary><ol>${signals.length ? signals.map(signal => `<li><div><strong>${e(signalName(signal.type))}</strong><span class="source-chip">${e(sourceName(signal.source))}</span></div><p>Occurred ${time(signal.occurredAt, { seconds: true })}${signal.inWindow === false ? ' · Outside the visit window' : ''}</p>${signal.late ? `<p class="late-label">Delayed delivery · received ${time(signal.receivedAt || signal.ingestedAt, { seconds: true })}</p>` : ''}</li>`).join('') : '<li class="empty-history">Door activity is added as events arrive.</li>'}</ol></details></section>`;
}
function receiptRow(kind, receipt) {
  const complete = kind === 'completion';
  return `<div class="receipt-row ${receipt ? 'receipt-recorded' : 'receipt-pending'}"><span class="receipt-symbol">${icon(receipt ? 'check' : 'clock')}</span><div><strong>${complete ? 'Visit completion' : 'Person-confirmed arrival'}</strong>${receipt ? `<p>${e(member(receipt.actor).name)} · ${time(receipt.at)}</p><blockquote>${e(receipt.note || 'Arrival confirmed with the care circle.')}</blockquote>` : `<p>${complete ? 'A completion note will close the visit.' : 'A person records this check-in.'}</p>`}</div></div>`;
}
function humanEvidence() {
  return `<section class="evidence-block human-evidence" aria-labelledby="human-title"><div class="evidence-heading"><span class="evidence-number">02</span><h3 id="human-title">Human receipts</h3>${icon('receipt')}</div><span class="evidence-kicker">Confirmed by a named person</span>${receiptRow('arrival', state.visit.arrival)}${receiptRow('completion', state.visit.completion)}</section>`;
}
function activityLog() {
  const entries = [...state.audit].reverse().sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const visible = historyExpanded ? entries : entries.slice(0, 7);
  return `<section class="activity-section" aria-labelledby="activity-title"><div class="section-heading"><div><span class="eyebrow">The shared record</span><h2 id="activity-title">How the visit unfolded</h2></div><div class="activity-tools"><span class="revision-label">Update ${e(state.revision)}</span><button class="text-button" data-action="copy-summary">${icon('copy')}Copy summary</button></div></div><ol class="activity-log">${visible.length ? visible.map(item => { const person = member(item.actor); const human = state.members.some(value => value.id === item.actor); return `<li class="activity-item ${human ? 'activity-human' : 'activity-system'}"><span class="activity-marker">${human ? avatar(person, 'avatar-tiny') : icon(String(item.type).includes('handoff') ? 'people' : 'bell')}</span><div><p>${e(item.text)}</p><span>${e(human ? person.name : item.actor === 'system' || !item.actor ? 'System' : sourceName(item.actor))} <span aria-hidden="true">·</span> ${time(item.at, { date: true })}</span></div></li>`; }).join('') : '<li class="activity-empty">The shared record begins with the first update.</li>'}</ol>${entries.length > 7 ? `<button class="text-button history-toggle" data-action="history-toggle" aria-expanded="${historyExpanded}">${historyExpanded ? 'Show recent updates' : `Show all ${entries.length} updates`}</button>` : ''}</section>`;
}
function composerMarkup(v) {
  if (!composer) return '';
  const owner = v.owner || member(state.visit.owner);
  const title = ({ handoff: 'Make the next step clear', arrival: 'Confirm an arrival', completion: 'Leave a completion receipt', contact: 'Add a contact update', cancel: 'Cancel this visit' })[composer];
  let fields = '';
  let command = '';
  let submit = '';
  if (composer === 'handoff') {
    command = 'request_handoff'; submit = 'Send handoff request';
    const choices = state.members.filter(person => person.id !== owner.id);
    if (!choices.some(person => person.id === drafts.handoffTo)) drafts.handoffTo = choices[0]?.id || '';
    fields = `<label for="handoff-to">Ask someone to take over</label><select id="handoff-to" name="to" data-draft="handoffTo" required>${choices.map(person => `<option value="${e(person.id)}"${person.id === drafts.handoffTo ? ' selected' : ''}>${e(person.name)} · ${e(person.role)}</option>`).join('')}</select><label for="handoff-plan">The next step <span>required</span></label><textarea id="handoff-plan" name="plan" data-draft="handoffPlan" rows="3" maxlength="200" required placeholder="A concrete action and a time for the next update.">${e(drafts.handoffPlan)}</textarea><label for="handoff-reason">Context for the handoff <span>optional</span></label><textarea id="handoff-reason" name="reason" data-draft="handoffReason" rows="2" maxlength="500" placeholder="What changed with the original plan?">${e(drafts.handoffReason)}</textarea><p class="form-help">${e(owner.name)} keeps ownership while the recipient decides.</p>`;
  } else {
    const config = {
      arrival: ['confirm_arrival', 'Arrival note', 'How was the arrival confirmed?', 'arrivalNote', 'Confirm arrival', false],
      completion: ['complete_visit', 'What was completed?', 'Leave a short outcome for the care circle.', 'completionNote', 'Complete the visit', true],
      contact: ['record_contact', 'Contact update', 'Who did you reach, and what did you learn?', 'contactNote', 'Save contact update', true],
      cancel: ['cancel_visit', 'Cancellation note', 'Why is this visit being closed?', 'cancelNote', 'Cancel the visit', true],
    }[composer];
    [command, , , , submit] = config;
    fields = `<label for="${composer}-note">${e(config[1])} <span>${config[5] ? 'required' : 'optional'}</span></label><textarea id="${composer}-note" name="note" data-draft="${config[3]}" rows="4" maxlength="500"${config[5] ? ' required' : ''} placeholder="${e(config[2])}">${e(drafts[config[3]])}</textarea><p class="form-help">${composer === 'contact' ? 'This records a contact update. Arrival and completion have their own receipts.' : composer === 'arrival' ? 'Save an arrival you have confirmed with a person.' : composer === 'completion' ? 'This receipt closes the visit and records your name, time, and outcome.' : 'The reason stays in the shared visit record.'}</p>`;
  }
  return `<form class="composer" data-command="${command}"><div class="composer-heading"><h3>${e(title)}</h3><button type="button" class="icon-button" data-action="close-composer" aria-label="Close action form">${icon('close')}</button></div>${fields}<button class="button button-primary" type="submit"${disabled()}>${icon(composer === 'completion' ? 'check' : 'arrow')}<span>${busy ? 'Saving…' : e(submit)}</span></button><p class="signing-note">Recorded as <strong>${e(member(actor).name)}</strong></p></form>`;
}
function actionPanel(v) {
  const selected = member(actor);
  const owner = v.owner || member(state.visit.owner);
  const isOwner = selected.id === owner.id;
  const visitor = (v.plannedVisitor || member(state.visit.scheduledVisitor)).id;
  const pending = state.visit.pendingHandoff;
  const isRecipient = pending?.to === actor;
  const closed = ['complete', 'cancelled'].includes(v.status);
  let content;
  if (closed) {
    content = `<div class="closed-state"><span class="closed-icon">${icon(v.status === 'complete' ? 'check' : 'receipt')}</span><h3>${v.status === 'complete' ? 'A clear ending.' : 'The visit is closed.'}</h3><p>${v.status === 'complete' ? 'The completion receipt is shared with the care circle.' : 'The cancellation is recorded in the shared history.'}</p>${actionButton('copy-summary', 'Copy visit summary', { kind: 'primary', glyph: 'copy' })}${state.mode === 'example' ? actionButton('reset', 'Try the story again', { glyph: 'reset' }) : ''}</div>`;
  } else if (isRecipient) {
    content = `<div class="invitation"><span class="eyebrow">An invitation from ${e(member(pending.from).name)}</span><h3>Will you take the next step?</h3><blockquote>${e(pending.plan)}</blockquote>${pending.reason ? `<p class="invitation-context">${e(pending.reason)}</p>` : ''}<p class="ownership-explainer">Accepting transfers ownership to <strong>${e(selected.name)}</strong>.</p>${actionButton('accept-handoff', 'Accept & take ownership', { kind: 'primary', glyph: 'check' })}${actionButton('decline-handoff', 'Decline handoff', { kind: 'quiet' })}</div>`;
  } else {
    let description;
    if (isOwner) description = pending ? `${member(pending.to).name} has your request. You keep the next update moving while they decide.` : state.visit.arrival ? 'An arrival is recorded. Close the visit with a short outcome when the check-in is complete.' : v.overdue ? 'The visit window has passed. Record a direct update or ask someone to take the next step.' : 'Keep the visit moving with a direct check-in or an agreed handoff.';
    else if (actor === visitor) description = `You are the planned visitor. Record the visit; ${owner.name} owns the next update.`;
    else description = `${owner.name} owns the next update. A handoff invitation will appear here when they ask you to take over.`;
    content = `<div class="action-intro"><h3>${isOwner ? 'Keep the next step moving.' : actor === visitor ? 'Leave the circle an update.' : 'You’re in the care circle.'}</h3><p>${e(description)}</p></div><div class="action-options">${isOwner && !pending && !state.visit.arrival ? actionButton('open-handoff', 'Ask for backup', { kind: v.overdue ? 'primary' : 'secondary', glyph: 'people' }) : ''}${(isOwner || actor === visitor) && !state.visit.arrival ? actionButton('open-arrival', 'Confirm an arrival', { kind: isOwner && v.overdue ? 'secondary' : 'primary', glyph: 'check' }) : ''}${(isOwner || actor === visitor) && state.visit.arrival ? actionButton('open-completion', 'Leave completion receipt', { kind: 'primary', glyph: 'receipt' }) : ''}${isOwner ? actionButton('open-contact', 'Add a contact update', { kind: 'quiet', glyph: 'note' }) : ''}${isOwner && !pending && state.visit.arrival ? actionButton('open-handoff', 'Ask for backup', { kind: 'quiet', glyph: 'people' }) : ''}${isOwner || actor === visitor ? `<details class="more-actions"><summary>More visit options</summary>${!state.visit.arrival ? actionButton('open-completion', 'Leave completion receipt', { kind: 'quiet', glyph: 'receipt' }) : ''}${isOwner ? actionButton('open-cancel', 'Cancel visit', { kind: 'quiet' }) : ''}</details>` : trial ? '' : actionButton('view-owner', `View ${owner.name}’s role`, { kind: 'secondary', glyph: 'people' })}</div>`;
  }
  return `<aside class="action-desk" id="action-desk" aria-labelledby="action-desk-title"><div class="action-desk-header"><div><span class="eyebrow">Your role in this visit</span><h2 id="action-desk-title">${e(selected.name)}’s next step</h2></div>${avatar(selected)}</div>${composer && !closed ? composerMarkup(v) : content}${trial && closed ? `<div class="trial-complete-ask">Would this help with your next family visit?${feedbackSent ? '<p class="trial-feedback-sent">Your feedback is saved. Thank you.</p>' : actionButton('trial-feedback', 'Tell us about your trial', {glyph: 'note'})}</div>` : ''}<div class="desk-footnote">${icon('people')}<p>Every accepted handoff has one owner. Every visit receipt has a name.</p></div></aside>`;
}
function sandboxControls() {
  if (state.mode !== 'example') return '';
  return `<details class="sandbox-controls"><summary>Explore device events ${icon('chevron')}</summary><p>These controls add labeled example events to the same visit.</p><div>${actionButton('demo-doorbell', 'Add doorbell event', { kind: 'quiet', glyph: 'bell' })}${actionButton('demo-overdue', 'Advance past visit window', { kind: 'quiet', glyph: 'clock' })}${actionButton('demo-offline', 'Take doorbell offline', { kind: 'quiet', glyph: 'offline' })}</div></details>`;
}
function liveControls() {
  if (!live) return '';
  if (trial) return `<section class="live-controls" aria-label="Shared visit connection"><div><strong><span class="status-dot ${connection === 'open' ? 'dot-online' : 'dot-offline'}"></span>${connection === 'open' ? 'Shared visit connected' : connection === 'connecting' ? 'Opening the shared visit' : 'Connection interrupted · saved view'}</strong><p>${connection === 'open' ? 'Updates refresh across devices every five seconds.' : 'Keep this private link. Reconnect to receive and send updates.'}</p></div>${actionButton('refresh-live', 'Refresh visit', {kind: 'quiet', glyph: 'reset'})}</section>`;
  return `<section class="live-controls" aria-label="Live server connection"><div><strong><span class="status-dot ${connection === 'open' ? 'dot-online' : 'dot-offline'}"></span>${connection === 'open' ? 'Live state connected' : connection === 'connecting' ? 'Connecting to live state' : 'Live connection reconnecting'}</strong><p>Ring mode: ${e(ring.mode || state.mode)} · ${ring.configured ? 'Server token configured' : 'Server token setup pending'}</p></div><div>${actionButton('refresh-live', 'Refresh state', { kind: 'quiet', glyph: 'reset' })}${actionButton('sync-ring', 'Sync Ring events', { kind: 'secondary', glyph: 'signal', disabled: !ring.configured })}</div></section>`;
}
function aboutDialog() {
  if (trial) return `<dialog id="about-dialog" class="about-dialog" aria-labelledby="about-title"><div class="dialog-header"><span class="brand-mark">${icon('home')}</span><button class="icon-button" data-action="close-about" aria-label="Close about this trial">${icon('close')}</button></div><span class="eyebrow">One visit, your circle</span><h2 id="about-title">Care Handoff</h2><p class="dialog-lede">One person owns the next update. Acceptance transfers that responsibility.</p><p>This free trial gives each participant a private link bound to their named role. The holder of that link can perform the role’s actions. Keep your own link and share other links directly with their recipients.</p><p>Visit records, feedback, and optional contact details are stored for seven days. The original coordinator can erase the visit and disable every link from the footer.</p><p>Ring device integration is available through the separately configured local server. This shared trial records the people-confirmed coordination flow.</p><p class="dialog-small">Preview hosting supports this time-limited trial. The visit summary provides a portable copy of the plan and receipts. Built by an autonomous AI agent through the blucca account.</p><button class="button button-primary" data-action="close-about">Back to the visit ${icon('arrow')}</button></dialog>`;
  return `<dialog id="about-dialog" class="about-dialog" aria-labelledby="about-title"><div class="dialog-header"><span class="brand-mark">${icon('home')}</span><button class="icon-button" data-action="close-about" aria-label="Close about this prototype">${icon('close')}</button></div><span class="eyebrow">A small circle, working together</span><h2 id="about-title">Care Handoff</h2><p class="dialog-lede">A scheduled visit. A door event. A named person responsible for the next update.</p><p>When a plan changes, someone can ask for backup. The recipient accepts a concrete next step, and ownership moves with that acceptance.</p><p>Door activity, handoff decisions, and visit receipts keep distinct records. Arrival and completion are recorded by people.</p><div class="dialog-example"><strong>This is a fictional household.</strong><p>June, Maya, Lee, and Pat are example people. ${live ? 'This view uses the local server; the source label on each event identifies its origin.' : 'The public example runs in your browser, saves on this browser, and shares updates with other tabs of this site.'}</p></div><p class="dialog-small">Prototype role selection attributes each action to the selected example person. The Ring access token is handled by the local server in connected mode.</p><button class="button button-primary" data-action="close-about">Back to the visit ${icon('arrow')}</button></dialog>`;
}

function visitSummary() {
  const v = view();
  const visit = state.visit;
  const lines = [
    trial ? 'CARE HANDOFF — shared visit summary' : 'CARE HANDOFF — fictional example household',
    `Household: ${state.household.name}`,
    `Visit: ${visit.title}`,
    `Original plan: ${dateLabel(visit.startsAt)}, ${formatTime(visit.startsAt)}–${formatTime(visit.endsAt)} ${zoneLabel()}; visitor ${member(visit.scheduledVisitor).name}.`,
    `Current status: ${v.title}`,
    `Next-update owner: ${member(visit.owner).name}`,
  ];
  if (visit.pendingHandoff) lines.push(`Pending handoff: ${member(visit.pendingHandoff.from).name} → ${member(visit.pendingHandoff.to).name}. ${member(visit.owner).name} keeps ownership until acceptance.`, `Requested plan: ${visit.pendingHandoff.plan}`);
  if (visit.backupPlan) lines.push(`Accepted by: ${member(visit.backupPlan.actor).name}, ${formatTime(visit.backupPlan.acceptedAt, { date: true })} ${zoneLabel()}`, `Accepted plan: ${visit.backupPlan.plan}`);
  if (visit.arrival) lines.push(`Arrival receipt: ${member(visit.arrival.actor).name}, ${formatTime(visit.arrival.at, { date: true })} ${zoneLabel()}. ${visit.arrival.note}`);
  if (visit.completion) lines.push(`Completion receipt: ${member(visit.completion.actor).name}, ${formatTime(visit.completion.at, { date: true })} ${zoneLabel()}. ${visit.completion.note}`);
  if (visit.cancelled) lines.push(`Cancellation: ${member(visit.cancelled.actor).name}, ${formatTime(visit.cancelled.at, { date: true })} ${zoneLabel()}. ${visit.cancelled.note}`);
  lines.push(`Device status: ${state.device.status}. Source: ${sourceLabel()}.`);
  lines.push('Door activity and person-confirmed visit receipts are separate records.');
  return lines.join('\n');
}
function summaryDialog() {
  return `<dialog id="summary-dialog" class="about-dialog summary-dialog" aria-labelledby="summary-title"><div class="dialog-header"><h2 id="summary-title">Visit summary</h2><button class="icon-button" data-action="close-summary" aria-label="Close visit summary">${icon('close')}</button></div><p>Select and copy this shared summary.</p><textarea id="summary-text" readonly rows="14" aria-label="Visit summary text">${e(visitSummary())}</textarea><button class="button button-primary" data-action="select-summary">Select summary text ${icon('copy')}</button></dialog>`;
}
async function copySummary() {
  try {
    await navigator.clipboard.writeText(visitSummary());
    setMessage('Visit summary copied with the current owner, accepted plan, and receipts.');
    render();
  } catch {
    document.querySelector('#summary-dialog')?.showModal();
    const field = document.querySelector('#summary-text');
    field?.focus(); field?.select();
  }
}

function render() {
  if (!state) { renderEmpty(); return; }
  if (!state.members.some(person => person.id === actor)) actor = member(state.visit.owner).id;
  const v = view();
  const activeElement = document.activeElement;
  const focusScope = ['.guide-current', '.action-desk', '.header-tools', '.sandbox-controls', '.activity-tools', '.trial-dialog'].find(selector => activeElement?.closest(selector));
  const focus = activeElement?.id || activeElement?.dataset?.action || activeElement?.closest('form[data-command]') ? { id: activeElement.id, action: activeElement.dataset?.action, scope: focusScope, start: activeElement.selectionStart, end: activeElement.selectionEnd } : null;
  const trialDialogs = ['trial-links-dialog', 'trial-feedback-dialog', 'trial-erase-dialog'].filter(id => document.getElementById(id)?.open);
  const dialogOpen = document.querySelector('#about-dialog')?.open;
  const summaryOpen = document.querySelector('#summary-dialog')?.open;
  const statusLabel = ({ complete: 'Visit complete', cancelled: 'Visit cancelled', handoff_pending: 'Handoff awaiting acceptance', in_progress: 'Visit in progress', needs_update: 'Visit update due', scheduled: 'Visit scheduled' })[v.status] || v.title;
  app.innerHTML = `${header()}<main class="page ${trial ? 'trial-dashboard' : ''}" id="main">${messageMarkup()}<section class="page-intro"><div><p class="eyebrow">Household coordination, with a human next step</p><h1>${trial ? e(state.household.name) : 'Keep the next step<br><em>in caring hands.</em>'}</h1><p class="intro-description">When plans change, keep one person responsible for the next update.</p>${!trial ? '<a class="trial-start-link" href="https://blucca.github.io/care-handoff/try/">Plan your own shared visit <span aria-hidden="true">→</span></a><a class="trial-start-link demo-watch-link" href="https://blucca.github.io/care-handoff/demo/">Watch the official Ring demo <span aria-hidden="true">↗</span></a>' : ''}</div>${roleSelect()}</section><div class="visit-meta"><span>${icon('home')}<strong>${e(state.household?.name || 'June’s home')}</strong><span class="fictional-tag">${trial ? 'Private shared visit' : 'Fictional household'}</span></span><span>${icon('clock')}${e(dateLabel(state.clock))}<span class="meta-separator">/</span>${state.mode === 'example' ? 'Example clock' : 'State time'} ${time(state.clock)} ${e(zoneLabel())}</span></div>${demoGuide(v)}${liveControls()}${cameraBanner(v)}<div class="workboard"><div class="visit-column"><section class="visit-sheet" aria-labelledby="visit-title"><div class="visit-heading"><span class="status-label status-${e(v.status)}"><span></span>${e(statusLabel)}</span><p class="visit-window">Planned ${time(state.visit.startsAt, {date: trial})}–${time(state.visit.endsAt)} ${e(zoneLabel())}</p><h2 id="visit-title">${e(state.visit.title || 'A check-in for June')}</h2><p class="visit-detail">${e(v.detail || 'One shared plan for the next household visit.')}</p></div>${ownerPanel(v)}<div class="evidence-grid">${deviceEvidence(v)}${humanEvidence()}</div><p class="evidence-note">${icon('info')}Door activity records what the device observed. Visit receipts record a person’s confirmed update.</p></section>${activityLog()}</div><div class="desk-column">${actionPanel(v)}${sandboxControls()}</div></div>${trial ? accessMarkup(trialClient, state.members, formatTime(trialClient.info?.expiresAt, {date: true}) + ' ' + zoneLabel()) : ''}<footer class="page-footer"><p><strong>Care Handoff</strong><span>A small circle. A clear next step.</span></p><div><span>${trial ? 'Private links · seven-day preview hosting' : live ? 'Connected through the local server' : persistent ? 'Saved on this browser · synced across tabs' : 'Stored in this tab’s memory'}</span><a class="text-button" href="https://github.com/blucca/care-handoff">Source &amp; setup</a><button class="text-button" data-action="about">About this ${trial ? 'trial' : 'prototype'}</button>${trial && trialClient.info?.coordinator ? '<button class="text-button" data-action="trial-erase">Erase shared visit</button>' : ''}</div></footer></main>${aboutDialog()}${summaryDialog()}${trial ? linksDialog(trialClient, state.members, busy, linkStatus) + feedbackDialog(feedbackValues, busy, feedbackStatus) + eraseDialog() : ''}`;
  for (const id of trialDialogs) document.getElementById(id)?.showModal();
  if (summaryOpen) document.querySelector('#summary-dialog')?.showModal();
  if (dialogOpen) document.querySelector('#about-dialog')?.showModal();
  if (focus) {
    const scope = focus.scope ? document.querySelector(focus.scope) : document;
    const element = (focus.id && document.getElementById(focus.id)) || (focus.action && scope?.querySelector(`[data-action="${focus.action}"]`)) || (focus.scope && scope?.querySelector('button, select, textarea')); 
    if (element) {
      element.focus({ preventScroll: true });
      if (typeof element.setSelectionRange === 'function' && focus.start !== null && ['textarea', 'input'].includes(element.tagName.toLowerCase())) {
        try { element.setSelectionRange(focus.start, focus.end); } catch {}
      }
    }
  }
  document.querySelector('.signal-history')?.addEventListener('toggle', event => { signalHistoryExpanded = event.currentTarget.open; });
}
function renderEmpty() {
  if (trial) {
    if (!trialClient.token) {
      app.innerHTML = `${header()}<main class="page" id="main">${messageMarkup()}<div class="trial-layout">${setupMarkup(setupValues, busy)}</div><footer class="page-footer"><p><strong>Care Handoff</strong><span>One visit. Your own circle.</span></p><a class="text-button" href="https://github.com/blucca/care-handoff">Source &amp; setup</a></footer></main>`;
    } else {
      app.innerHTML = `${header()}<main class="page connection-screen" id="main">${messageMarkup()}<span class="eyebrow">Your private visit link</span><h1>${connection === 'error' ? 'Open your shared visit.' : 'Opening the shared visit…'}</h1><p>${connection === 'error' ? 'Keep this link to return. For an expired or replaced link, ask your coordinator for a fresh invitation.' : 'Loading your named role and the latest accepted plan.'}</p>${actionButton('refresh-live', 'Try this link again', {kind:'primary',glyph:'reset'})}<button class="text-link text-button" data-action="start-fresh-trial">Plan a separate new visit</button></main>`;
    }
    return;
  }
  app.innerHTML = `${header()}<main class="page connection-screen" id="main">${messageMarkup()}<span class="eyebrow">Connected mode</span><h1>${connection === 'error' ? 'Reconnect to the visit.' : 'Opening the shared visit…'}</h1><p>${connection === 'error' ? 'Start the Care Handoff server, then refresh this view to load its current state.' : 'Loading the visit from the local Care Handoff server.'}</p>${actionButton('refresh-live', 'Refresh live state', { kind: 'primary', glyph: 'reset' })}<a class="text-link" href="${e(location.pathname)}">Open the browser-local example</a></main>`;
}
function setActor(id) {
  if (trial) return;
  if (!state.members.some(person => person.id === id)) return;
  actor = id;
  composer = null;
  try { sessionStorage.setItem(ACTOR_KEY, actor); } catch {}
  render();
}
function openComposer(type, { guide = false } = {}) {
  composer = type;
  if (guide) {
    if (type === 'handoff') {
      drafts.handoffTo = 'lee';
      drafts.handoffPlan ||= `I’ll visit June and share an update by ${formatTime(new Date(Date.parse(state.visit.endsAt) + 15 * 60_000).toISOString())} ${zoneLabel()}.`;
      drafts.handoffReason ||= 'The planned visit needs an update, and I’m tied up. Could you take the next check-in?';
    }
    if (type === 'arrival') drafts.arrivalNote ||= 'I checked in with June at the door. The visit is underway.';
    if (type === 'completion') drafts.completionNote ||= 'Visited June and finished the check-in. Maya has the update.';
  }
  render();
  const field = document.querySelector('.composer textarea, .composer select');
  field?.focus({ preventScroll: true });
  document.querySelector('#action-desk')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'nearest' });
}
async function request(path, options = {}) {
  if (trial) {
    const routes = {'/api/state': '/api/trial/state', '/api/commands': '/api/trial/commands'};
    try { return await trialClient.request(routes[path] || path, options); }
    catch (error) {
      if (validState(error.state)) { state = error.state; serverView = null; }
      throw error;
    }
  }
  const response = await fetch(path, { ...options, headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
  let body;
  try { body = await response.json(); } catch { throw new Error('The server response needs a valid JSON state. Refresh after the server is ready.'); }
  if (!response.ok) {
    if (validState(body.state)) { state = body.state; serverView = null; }
    const error = new Error(body.error?.message || `The request failed (${response.status}).`);
    error.code = body.error?.code;
    throw error;
  }
  return body;
}
function applyEnvelope(envelope) {
  if (!validState(envelope?.state)) throw new Error('The server response needs a complete visit state.');
  if (trial && state?.household.id === envelope.state.household.id && state.revision > envelope.state.revision) return;
  state = envelope.state;
  if (trial) { trialClient.adopt(envelope); actor = envelope.member.id; }
  serverView = envelope.view || null;
  ring = envelope.ring || ring;
}
async function loadLive() {
  connection = 'connecting';
  if (!state) render();
  try { applyEnvelope(await request('/api/state')); connection = 'open'; message = null; }
  catch (error) {
    connection = 'error';
    if (trial && [401, 404, 410].includes(error.status)) { state = null; serverView = null; }
    setMessage(error.message, 'error');
  }
  render();
}
async function pollTrial() {
  if (polling || busy || document.hidden || !trialClient?.token || !state) return;
  polling = true;
  const key = trialClient.token;
  try {
    const result = await request('/api/state');
    if (key !== trialClient.token) return;
    const changed = result.state.revision !== state?.revision || result.view.status !== view().status || connection !== 'open';
    applyEnvelope(result);
    connection = 'open';
    if (changed) render();
  } catch (error) {
    if (key !== trialClient.token) return;
    const changed = connection !== 'error';
    connection = 'error';
    if ([401, 404, 410].includes(error.status)) {
      state = null; serverView = null;
      clearInterval(trialPoll);
      setMessage(error.message, 'error');
      render();
    } else if (changed) render();
  } finally { polling = false; }
}
function subscribeLive() {
  if (trial) {
    clearInterval(trialPoll);
    trialPoll = setInterval(pollTrial, 5000);
    return;
  }
  stream?.close();
  stream = new EventSource('/api/stream');
  stream.addEventListener('open', () => { connection = 'open'; render(); });
  stream.addEventListener('state', event => {
    try { applyEnvelope(JSON.parse(event.data)); connection = 'open'; render(); }
    catch (error) { setMessage(`A live update needs attention: ${error.message}`, 'error'); render(); }
  });
  stream.addEventListener('error', () => { connection = 'error'; render(); });
}
async function mutate(type, payload = {}) {
  if (busy || !state) return;
  const command = { type, actor, revision: state.revision, payload };
  const expectedEpoch = record?.epoch;
  busy = true;
  message = null;
  render();
  try {
    if (live) applyEnvelope(await request('/api/commands', { method: 'POST', body: JSON.stringify(command) }));
    else await withLock(() => {
      const latest = readRecord() || record;
      if (latest.epoch !== expectedEpoch) { record = latest; state = latest.state; throw Object.assign(new Error('The example was reset in another tab. Review the current visit and try the action again.'), { code: 'conflict' }); }
      try {
        const next = applyCommand(latest.state, command);
        persistRecord({ ...latest, state: next, updatedAt: Date.now() });
      } catch (error) { state = latest.state; record = latest; throw error; }
    });
    composer = null;
    const success = ({ request_handoff: 'Handoff requested. The current owner keeps the next update until it is accepted.', accept_handoff: `${member(actor).name} accepted the handoff and now owns the next update.`, decline_handoff: 'The handoff was declined. The current owner keeps the next update.', confirm_arrival: 'Arrival receipt recorded and shared with the care circle.', complete_visit: 'Visit complete. The named completion receipt is saved.', record_contact: 'Contact update added to the shared record.', cancel_visit: 'Visit cancelled. The reason is saved in the shared record.' })[type];
    setMessage(success || 'The visit has been updated.');
    if (type === 'record_contact') drafts.contactNote = '';
  } catch (error) {
    setMessage(error.code === 'conflict' ? 'A newer update arrived. This view is refreshed; review the visit and try the action again.' : error.message || 'The update failed. Review the visit and try again.', 'error');
  } finally { busy = false; render(); }
}
async function demoAction(action) {
  if (busy || !state) return;
  busy = true; message = null; render();
  try {
    if (live) applyEnvelope(await request('/api/demo/action', { method: 'POST', body: JSON.stringify({ action }) }));
    else await withLock(() => {
      const latest = readRecord() || record;
      persistRecord({ ...latest, state: runDemoAction(latest.state, action), updatedAt: Date.now() });
    });
    setMessage(({ doorbell: 'Example doorbell event added. Check the device activity and current owner.', overdue: 'Example clock advanced. The visit is ready for a direct update or handoff.', offline: 'Example doorbell taken offline. The care circle can still record direct updates.' })[action]);
  } catch (error) { setMessage(error.message || 'The example action failed. Try again.', 'error'); }
  finally { busy = false; render(); }
}
async function resetExample() {
  if (busy) return;
  busy = true; render();
  try {
    if (live) applyEnvelope(await request('/api/demo/reset', { method: 'POST', body: '{}' }));
    else await withLock(() => persistRecord({ epoch: uid(), state: createDemoState(), updatedAt: Date.now() }));
    composer = null; historyExpanded = false; signalHistoryExpanded = false;
    for (const key of Object.keys(drafts)) drafts[key] = key === 'handoffTo' ? 'lee' : '';
    actor = 'maya';
    try { sessionStorage.setItem(ACTOR_KEY, actor); } catch {}
    setMessage('Fresh example ready. Start with the doorbell, then follow the next step.');
  } catch (error) { setMessage(error.message, 'error'); }
  finally { busy = false; render(); }
}
async function syncRing() {
  if (busy) return;
  busy = true; message = null; render();
  try { applyEnvelope(await request('/api/ring/sync', { method: 'POST', body: '{}' })); setMessage('Ring sync complete. Each event keeps its source and occurrence time.'); }
  catch (error) { setMessage(error.message || 'Ring sync failed. Check the local server connection.', 'error'); }
  finally { busy = false; render(); }
}
async function createTrial(form) {
  if (busy || !form.reportValidity()) return;
  Object.assign(setupValues, Object.fromEntries(new FormData(form)));
  busy = true; message = null; renderEmpty();
  let created = false;
  try {
    const input = {...setupValues, startsAt: new Date(setupValues.startsAt).toISOString(), endsAt: new Date(setupValues.endsAt).toISOString()};
    applyEnvelope(await trialClient.create(input));
    connection = 'open';
    drafts.handoffTo = 'backup';
    feedbackSent = false;
    setMessage('Your visit is ready. Save your link and send the other links to your circle.');
    created = true;
  } catch (error) { setMessage(error.message || 'Visit creation failed. Please try again.', 'error'); }
  finally { busy = false; render(); }
  if (created) { subscribeLive(); document.querySelector('#trial-links-dialog')?.showModal(); }
}
async function makeMemberLink(memberId) {
  if (busy) return;
  busy = true; linkStatus = ''; render();
  try {
    const invite = await trialClient.invite(memberId);
    linkStatus = `${invite.name}’s fresh link is ready. Send it directly to them.`;
  } catch (error) { linkStatus = error.message; }
  finally { busy = false; render(); }
}
async function copyMemberLink(memberId) {
  const token = memberId === actor ? trialClient.token : trialClient.invites.get(memberId)?.token;
  if (!token) return;
  const url = trialClient.link(token);
  try {
    await navigator.clipboard.writeText(url);
    linkStatus = `${member(memberId).name}’s private link is copied. Send it directly to that person.`;
  } catch {
    const field = document.getElementById(`link-${memberId}`);
    field?.focus(); field?.select();
    linkStatus = 'The private link is selected. Copy it, then send it directly to its named person.';
  }
  const status = document.querySelector('#trial-copy-status');
  if (status) status.textContent = linkStatus;
}
async function sendTrialFeedback(form) {
  if (busy || !form.reportValidity()) return;
  Object.assign(feedbackValues, Object.fromEntries(new FormData(form)));
  busy = true; feedbackStatus = ''; render();
  try {
    await request('/api/trial/feedback', {method: 'POST', body: JSON.stringify(feedbackValues)});
    feedbackSent = true;
    document.querySelector('#trial-feedback-dialog')?.close();
    setMessage('Your trial feedback is saved. Thank you for helping shape the next version.');
  } catch (error) { feedbackStatus = error.message; }
  finally { busy = false; render(); }
}
async function eraseTrial() {
  if (busy) return;
  busy = true;
  try {
    await request('/api/trial/visit', {method: 'DELETE', body: '{}'});
    clearInterval(trialPoll);
    trialClient.clear();
    state = null; serverView = null; composer = null;
    Object.assign(setupValues, newTrialDefaults());
    setMessage('The visit, receipts, feedback, and private links have been erased.');
  } catch (error) {
    document.querySelector('#trial-erase-dialog')?.close();
    setMessage(error.message, 'error');
  } finally { busy = false; render(); }
}
function saveTrialDraft(event) {
  if (event.target.closest('#trial-create-form') && event.target.name) setupValues[event.target.name] = event.target.value;
  if (event.target.closest('#trial-feedback-form') && event.target.name) feedbackValues[event.target.name] = event.target.value;
}
app.addEventListener('change', event => {
  if (trial) saveTrialDraft(event);
  if (event.target.id === 'actor-select') setActor(event.target.value);
  if (event.target.dataset.draft) drafts[event.target.dataset.draft] = event.target.value;
});
app.addEventListener('input', event => {
  if (trial) saveTrialDraft(event);
  if (event.target.dataset.draft) drafts[event.target.dataset.draft] = event.target.value;
});
app.addEventListener('submit', event => {
  if (event.target.id === 'trial-create-form') { event.preventDefault(); createTrial(event.target); return; }
  if (event.target.id === 'trial-feedback-form') { event.preventDefault(); sendTrialFeedback(event.target); return; }
  const form = event.target.closest('form[data-command]');
  if (!form) return;
  event.preventDefault();
  if (!form.reportValidity()) return;
  const payload = Object.fromEntries(new FormData(form));
  for (const key of Object.keys(payload)) payload[key] = String(payload[key]).trim();
  mutate(form.dataset.command, payload);
});
app.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  const action = button.dataset.action;
  if (action === 'trial-links') { document.querySelector('#trial-links-dialog')?.showModal(); return; }
  if (action === 'close-trial-links') { document.querySelector('#trial-links-dialog')?.close(); return; }
  if (action === 'copy-member-link') { copyMemberLink(button.dataset.member); return; }
  if (action === 'make-member-link') { makeMemberLink(button.dataset.member); return; }
  if (action === 'trial-feedback') { document.querySelector('#trial-feedback-dialog')?.showModal(); return; }
  if (action === 'close-trial-feedback') { document.querySelector('#trial-feedback-dialog')?.close(); return; }
  if (action === 'trial-erase') { document.querySelector('#trial-erase-dialog')?.showModal(); return; }
  if (action === 'close-trial-erase') { document.querySelector('#trial-erase-dialog')?.close(); return; }
  if (action === 'trial-erase-confirm') { eraseTrial(); return; }
  if (action === 'start-fresh-trial') { clearInterval(trialPoll); trialClient.clear(); state = null; message = null; render(); return; }
  if (action === 'about') { document.querySelector('#about-dialog')?.showModal(); return; }
  if (action === 'close-about') { document.querySelector('#about-dialog')?.close(); return; }
  if (action === 'copy-summary') { copySummary(); return; }
  if (action === 'close-summary') { document.querySelector('#summary-dialog')?.close(); return; }
  if (action === 'select-summary') { const field = document.querySelector('#summary-text'); field?.focus(); field?.select(); return; }
  if (action === 'view-owner') { setActor(member(state.visit.owner).id); return; }
  if (action === 'dismiss-message') { message = null; render(); return; }
  if (action === 'refresh-live') { loadLive().then(() => { if (trial && state) subscribeLive(); }); return; }
  if (action === 'history-toggle') { historyExpanded = !historyExpanded; render(); return; }
  if (action === 'reset') { resetExample(); return; }
  if (action === 'sync-ring') { syncRing(); return; }
  if (action === 'view-ring-live') { openRingLiveView({deviceName: state.device?.name, source: state.device?.source, onArrival: !state.visit.arrival && !state.visit.completion && !state.visit.cancelled && [state.visit.owner, state.visit.scheduledVisitor].includes(actor) ? () => openComposer('arrival') : undefined}); return; }
  if (action.startsWith('demo-')) { demoAction(action.slice(5)); return; }
  if (action.startsWith('open-')) { openComposer(action.slice(5)); return; }
  if (action === 'close-composer') { composer = null; render(); return; }
  if (action === 'accept-handoff') { mutate('accept_handoff'); return; }
  if (action === 'decline-handoff') { mutate('decline_handoff'); return; }
  if (action === 'guide-maya') { setActor('maya'); openComposer('handoff', { guide: true }); return; }
  if (action === 'guide-handoff') { openComposer('handoff', { guide: true }); return; }
  if (action === 'guide-recipient') { setActor(state.visit.pendingHandoff.to); document.querySelector('#action-desk')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); return; }
  if (action === 'guide-owner') { setActor(member(state.visit.owner).id); openComposer(state.visit.arrival ? 'completion' : 'arrival', { guide: true }); return; }
  if (action === 'guide-review') { composer = null; render(); document.querySelector('#action-desk')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); document.querySelector('[data-action="accept-handoff"]')?.focus({ preventScroll: true }); return; }
  if (action === 'guide-arrival') { openComposer('arrival', { guide: true }); return; }
  if (action === 'guide-completion') { openComposer('completion', { guide: true }); }
});

async function initialize() {
  if (trial && !trialClient.token) { renderEmpty(); return; }
  if (live) { await loadLive(); subscribeLive(); }
  else {
    try { channel = new BroadcastChannel(CHANNEL); channel.onmessage = event => adoptRecord(readRecord() || event.data?.record, true); } catch {}
    record = readRecord();
    if (!record) persistRecord({ epoch: uid(), state: createDemoState(), updatedAt: Date.now() });
    else state = record.state;
    window.addEventListener('storage', event => {
      if (event.key !== STORAGE_KEY || !event.newValue) return;
      try { adoptRecord(readRecord() || JSON.parse(event.newValue), true); } catch {}
    });
    render();
  }
}
window.addEventListener('pagehide', () => { stream?.close(); channel?.close(); clearInterval(trialPoll); });
window.addEventListener('hashchange', () => {
  if (trial && new URLSearchParams(location.hash.slice(1)).get('key') !== trialClient.token) location.reload();
});
document.querySelector('.skip-link')?.addEventListener('click', event => {
  event.preventDefault();
  const main = document.querySelector('#main');
  if (main) { main.tabIndex = -1; main.focus(); main.scrollIntoView({block: 'start'}); }
});
window.addEventListener('pageshow', event => { if (event.persisted && trial && trialClient.token) { pollTrial(); subscribeLive(); } });
document.addEventListener('visibilitychange', () => { if (!document.hidden && trial && trialClient.token) pollTrial(); });
window.addEventListener('focus', () => { if (trial && trialClient.token) pollTrial(); });
initialize().catch(error => { connection = 'error'; setMessage(error.message || 'The visit failed to open. Refresh to try again.', 'error'); renderEmpty(); });
