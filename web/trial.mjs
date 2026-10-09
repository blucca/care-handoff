const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[char]));
const e = escapeHTML;

export class TrialClient {
  constructor() {
    this.token = new URLSearchParams(location.hash.slice(1)).get('key') || '';
    this.invites = new Map();
    this.info = null;
    this.member = null;
  }
  adopt(envelope) {
    this.info = envelope.trial;
    this.member = envelope.member;
    if (envelope.token) {
      this.token = envelope.token;
      history.replaceState(null, '', this.localLink());
    }
    for (const invite of envelope.invites || []) this.invites.set(invite.memberId, invite);
  }
  link(token = this.token) {
    if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
      const url = new URL('https://blucca.github.io/care-handoff/try/');
      url.hash = new URLSearchParams({key: token}).toString();
      return url.href;
    }
    return this.localLink(token);
  }
  localLink(token = this.token) {
    const url = new URL(location.href);
    url.pathname = '/';
    url.search = '?trial=1';
    url.hash = new URLSearchParams({key: token}).toString();
    return url.href;
  }
  async request(path, options = {}) {
    const response = await fetch(path, {...options, signal: AbortSignal.timeout(15_000), cache: 'no-store',
      headers: {Accept: 'application/json', ...(this.token ? {Authorization: `Bearer ${this.token}`} : {}),
        ...(options.body ? {'Content-Type': 'application/json'} : {}), ...options.headers}});
    let result;
    try { result = await response.json(); }
    catch { throw new Error('The shared service is reconnecting. Keep this private link and try again shortly.'); }
    if (!response.ok) {
      const error = new Error(result.error?.message || `The request failed (${response.status}).`);
      error.status = response.status;
      error.code = result.error?.code;
      error.state = result.state;
      throw error;
    }
    return result;
  }
  async create(input) {
    const result = await this.request('/api/trial/visits', {method: 'POST', body: JSON.stringify(input)});
    this.adopt(result);
    return result;
  }
  async invite(memberId) {
    const result = await this.request('/api/trial/invites', {method: 'POST', body: JSON.stringify({memberId})});
    this.invites.set(result.memberId, result);
    return result;
  }
  clear() {
    this.token = '';
    this.info = null;
    this.member = null;
    this.invites.clear();
    history.replaceState(null, '', '/?trial=1');
  }
}

const localDate = date => {
  const value = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return value.toISOString().slice(0, 16);
};
export function newTrialDefaults() {
  const start = new Date(Math.ceil((Date.now() + 60 * 60_000) / (15 * 60_000)) * 15 * 60_000);
  return {householdName: '', title: '', coordinatorName: '', visitorName: '', backupName: '',
    startsAt: localDate(start), endsAt: localDate(new Date(start.getTime() + 30 * 60_000)),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'};
}

export function setupMarkup(values, busy = false) {
  const field = (name, label, placeholder, max = 60) => `<label for="setup-${name}">${e(label)}<input id="setup-${name}" name="${name}" value="${e(values[name])}" maxlength="${max}" required placeholder="${e(placeholder)}" autocomplete="off"></label>`;
  const maxDate = localDate(new Date(Date.now() + 7 * 24 * 60 * 60_000));
  return `<section class="trial-intro"><span class="eyebrow">A free, seven-day shared trial</span><h1>One visit.<br><em>Your own circle.</em></h1><p>Plan a visit, send each person their private link, and keep the next step with someone who has accepted it.</p><ol class="trial-steps"><li><span>01</span><div><strong>Start with a real plan.</strong><p>First names, one visit window, one person handling the next update.</p></div></li><li><span>02</span><div><strong>Invite your visitor and backup.</strong><p>Each link opens that person’s view on their own phone.</p></div></li><li><span>03</span><div><strong>Finish with a named receipt.</strong><p>Everyone sees who accepted, what was agreed, and how the visit ended.</p></div></li></ol><p class="trial-scope">Use first names and general visit notes. Shared records and feedback are stored for seven days. The creator can erase the visit earlier.</p><p class="trial-scope">This trial coordinates planned visits and person-confirmed updates. Ring device activity is available in the separate <a href="https://blucca.github.io/care-handoff/">interactive example</a> and connected local setup.</p></section><section class="trial-setup" aria-labelledby="setup-heading"><div class="trial-form-heading"><span class="eyebrow">Get your circle started</span><h2 id="setup-heading">Plan a visit</h2><p>Three people, each with a distinct private link.</p></div><form id="trial-create-form" class="trial-form">${field('householdName', 'Household label', 'For example, June’s circle')}${field('title', 'Visit plan', 'For example, lunch & a short catch-up', 120)}<div class="trial-field-row">${field('coordinatorName', 'Your name · coordinator', 'For example, Maya', 40)}${field('visitorName', 'Planned visitor', 'For example, Pat', 40)}</div>${field('backupName', 'Backup person', 'For example, Lee', 40)}<div class="trial-field-row"><label for="setup-startsAt">Visit starts<input id="setup-startsAt" name="startsAt" type="datetime-local" value="${e(values.startsAt)}" max="${maxDate}" required></label><label for="setup-endsAt">Visit ends<input id="setup-endsAt" name="endsAt" type="datetime-local" value="${e(values.endsAt)}" max="${maxDate}" required></label></div><p class="form-help">Times use your device’s time zone: <strong>${e(values.timeZone)}</strong>. The visit window fits within the next seven days.</p><button class="button button-primary" type="submit"${busy ? ' disabled' : ''}>${busy ? 'Creating your visit…' : 'Create visit & private links'}<span aria-hidden="true">→</span></button><p class="form-help">Each private link permits actions as its named person. Share it directly with that person and keep your own link to return.</p></form></section>`;
}

export function accessMarkup(client, members, expiry) {
  return `<section class="trial-access" aria-label="Private visit access"><div><span class="eyebrow">Your shared visit</span><h2>Bring your circle into the plan.</h2><p>Send each person their own link. Updates appear across devices.</p><small>Visit available until ${e(expiry)} · Recorded through each person’s private link</small></div><div class="trial-access-actions"><button class="button button-secondary" data-action="trial-links">${client.info?.coordinator ? 'Share private links' : 'Save my private link'}</button><button class="text-button" data-action="trial-feedback">Share trial feedback</button></div></section>`;
}

export function linksDialog(client, members, busy = false, status = '') {
  const people = client.info?.coordinator ? members : members.filter(person => person.id === client.member.id);
  return `<dialog id="trial-links-dialog" class="about-dialog trial-dialog" aria-labelledby="trial-links-title"><div class="dialog-header"><h2 id="trial-links-title">A private link for each person</h2><button class="icon-button" data-action="close-trial-links" aria-label="Close private links">×</button></div><p>Each link opens one person’s role. Send it directly to them; keep your own link to return from another device.</p><div class="trial-link-list">${people.map(person => {
    const token = person.id === client.member.id ? client.token : client.invites.get(person.id)?.token;
    return `<section class="trial-link-card"><div><strong>${e(person.name)}${person.id === client.member.id ? ' · you' : ''}</strong><span>${e(person.role)}</span></div>${token ? `<label for="link-${e(person.id)}" class="sr-only">${e(person.name)}’s private link</label><input id="link-${e(person.id)}" readonly value="${e(client.link(token))}" class="private-link" autocomplete="off"><button class="button button-secondary" data-action="copy-member-link" data-member="${e(person.id)}">Copy ${person.id === client.member.id ? 'my' : `${e(person.name)}’s`} link</button>` : `<button class="button button-secondary" data-action="make-member-link" data-member="${e(person.id)}"${busy ? ' disabled' : ''}>Create fresh link for ${e(person.name)}</button><small>A fresh link replaces this person’s earlier link.</small>`}</section>`;
  }).join('')}</div><p id="trial-copy-status" role="status" class="form-help">${e(status)}</p><button class="button button-primary" data-action="close-trial-links">Back to the shared visit</button></dialog>`;
}

export function feedbackDialog(values = {}, busy = false, status = '') {
  const select = (name, options) => `<select id="feedback-${name}" name="${name}" required><option value="">Choose one</option>${options.map(([value, label]) => `<option value="${value}"${values[name] === value ? ' selected' : ''}>${label}</option>`).join('')}</select>`;
  return `<dialog id="trial-feedback-dialog" class="about-dialog trial-dialog" aria-labelledby="trial-feedback-title"><div class="dialog-header"><h2 id="trial-feedback-title">Would you keep using this?</h2><button class="icon-button" data-action="close-trial-feedback" aria-label="Close trial feedback">×</button></div><p>Your experience will shape the next version. This trial is free; a future family plan is being explored at <strong>$9 per month</strong>.</p><form id="trial-feedback-form" class="trial-form"><label for="feedback-useCase">Where would this help?${select('useCase', [['family', 'Coordinating visits for my family'], ['professional', 'Supporting families professionally'], ['exploring', 'Exploring the example or product']])}</label><label for="feedback-priceInterest">Would your family pay $9/month to keep using this?${select('priceInterest', [['yes', 'Yes — I would like a paid pilot'], ['maybe', 'Possibly — I need something more'], ['no', 'I would stay with my current approach']])}</label><label for="feedback-note">What worked, or what would you change? <span>optional</span><textarea id="feedback-note" name="note" maxlength="1000" rows="3" placeholder="A specific moment from your trial helps most.">${e(values.note)}</textarea></label><label for="feedback-email">Email for a follow-up <span>optional</span><input id="feedback-email" name="email" type="email" maxlength="254" autocomplete="email" value="${e(values.email)}" placeholder="you@example.com"></label><p class="form-help">Feedback is shared privately with the builder and stored with this trial for seven days.</p><p class="form-help" id="feedback-status" role="status">${e(status)}</p><button class="button button-primary" type="submit"${busy ? ' disabled' : ''}>${busy ? 'Saving…' : 'Send trial feedback'}</button></form></dialog>`;
}

export function eraseDialog() {
  return `<dialog id="trial-erase-dialog" class="about-dialog trial-dialog" aria-labelledby="trial-erase-title"><div class="dialog-header"><h2 id="trial-erase-title">Erase this shared visit?</h2><button class="icon-button" data-action="close-trial-erase" aria-label="Keep shared visit">×</button></div><p>Erasing removes the visit, its receipts, feedback, and all three private links. You can copy the visit summary first.</p><div class="trial-erase-actions"><button class="button button-secondary" data-action="close-trial-erase">Keep the visit</button><button class="button button-primary" data-action="trial-erase-confirm">Erase visit & disable links</button></div></dialog>`;
}
