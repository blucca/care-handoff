import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, rmSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {createTrialServer} from '../src/trial-server.mjs';

const SCRATCH = process.env.CARE_TEST_TEMP
  || join(process.env.INIT_CWD || process.cwd(), 'temp', 'care-handoff-tests');
const VISIT = {householdName: 'Integration test household', title: 'Lunch visit',
  coordinatorName: 'Alex', visitorName: 'Sam', backupName: 'Jo',
  startsAt: '2026-10-09T12:00:00.000Z', endsAt: '2026-10-09T12:30:00.000Z', timeZone: 'Europe/London'};

async function fixture(t, ttl = 604800) {
  mkdirSync(SCRATCH, {recursive: true});
  const directory = mkdtempSync(join(SCRATCH, 'trial-test-'));
  const clock = {value: Date.parse('2026-10-09T11:50:00.000Z')};
  const env = {CARE_TRIAL_DIR: directory, CARE_TRIAL_TTL_SECONDS: String(ttl)};
  let server, base;
  async function close() {
    if (server?.listening) {
      const closed = new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await closed;
    }
  }
  async function start() {
    server = createTrialServer({env, now: () => clock.value});
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  }
  t.after(async () => { await close(); rmSync(directory, {recursive: true, force: true}); });
  await start();
  return {directory, clock, get base() { return base; },
    async restart() { await close(); await start(); },
    async request(method, path, {token, input, headers = {}} = {}) {
      const response = await fetch(`${base}${path}`, {method,
        headers: {...(method === 'GET' ? {} : {'Content-Type': 'application/json', Origin: base}),
          ...(token ? {Authorization: `Bearer ${token}`} : {}), ...headers},
        ...(method === 'GET' ? {} : {body: JSON.stringify(input || {})})});
      return {status: response.status, data: await response.json(), headers: response.headers};
    }};
}
const stateRoute = '/api/trial/state';
const commandsRoute = '/api/trial/commands';
const create = (f, input = VISIT) => f.request('POST', '/api/trial/visits', {input});

test('two private member links accept and complete a visit, then recover and delete it', async (t) => {
  const f = await fixture(t);
  const created = await create(f);
  assert.equal(created.status, 201);
  const {token, invites, trial} = created.data;
  const backup = invites.find((invite) => invite.memberId === 'backup').token;
  assert.equal(created.data.state.mode, 'trial');
  assert.equal(created.data.state.device.source, 'unconnected');
  assert.equal(created.data.state.device.status, 'unconnected');
  assert.deepEqual(created.data.state.signals, []);
  assert.equal(created.data.member.id, 'coordinator');
  assert.equal(trial.coordinator, true);
  assert.equal(Date.parse(trial.expiresAt) - f.clock.value, 7 * 24 * 60 * 60_000);
  assert.equal(created.headers.get('cache-control'), 'no-store');
  assert.equal(created.headers.get('referrer-policy'), 'no-referrer');

  const requested = await f.request('POST', commandsRoute, {token,
    input: {revision: 0, type: 'request_handoff', payload: {to: 'backup', plan: 'Jo will cover lunch.'}}});
  assert.equal(requested.status, 200);
  assert.equal(requested.data.state.visit.owner, 'coordinator');
  const invitation = await f.request('GET', stateRoute, {token: backup});
  assert.equal(invitation.data.member.id, 'backup');
  assert.equal(invitation.data.trial.coordinator, false);
  assert.equal(invitation.data.state.visit.pendingHandoff.to, 'backup');
  const accepted = await f.request('POST', commandsRoute, {token: backup,
    input: {revision: 1, type: 'accept_handoff'}});
  assert.equal(accepted.status, 200);
  assert.equal(accepted.data.state.visit.owner, 'backup');
  assert.equal(accepted.data.state.audit.at(-1).actor, 'backup');
  assert.equal(accepted.data.state.visit.pendingHandoff, null);

  const stale = await f.request('POST', commandsRoute, {token: backup,
    input: {revision: 1, type: 'complete_visit', payload: {note: 'A stale update.'}}});
  assert.equal(stale.status, 409);
  assert.equal(stale.data.error.code, 'conflict');
  assert.equal(stale.data.state.revision, 2);
  assert.equal(stale.data.member.id, 'backup');
  assert.equal(stale.data.state.visit.completion, null);
  assert.equal('tokens' in stale.data, false);
  assert.equal('invites' in stale.data, false);

  assert.equal((await f.request('POST', commandsRoute, {token: backup,
    input: {revision: 2, type: 'confirm_arrival', payload: {note: 'Jo arrived with lunch.'}}})).status, 200);
  const completed = await f.request('POST', commandsRoute, {token: backup,
    input: {revision: 3, type: 'complete_visit', payload: {note: 'Lunch and a catch-up completed.'}}});
  assert.equal(completed.status, 200);
  assert.equal(completed.data.view.status, 'complete');
  assert.equal(completed.data.state.visit.completion.actor, 'backup');

  const feedback = await f.request('POST', '/api/trial/feedback', {token: backup,
    input: {useCase: 'exploring', priceInterest: 'maybe', note: 'Automated integration test.'}});
  assert.deepEqual(feedback.data, {received: true});
  const feedbackFile = join(f.directory, 'feedback', `${trial.id}-backup.json`);
  const savedFeedback = JSON.parse(readFileSync(feedbackFile, 'utf8'));
  assert.equal(savedFeedback.actor, 'backup');
  assert.equal(savedFeedback.roomId, trial.id);
  assert.equal(savedFeedback.expiresAt, trial.expiresAt);
  assert.equal(statSync(feedbackFile).mode & 0o777, 0o600);
  const file = join(f.directory, `${trial.id}.json`);
  const disk = readFileSync(file, 'utf8');
  for (const secret of [token, ...invites.map((invite) => invite.token)]) assert.equal(disk.includes(secret), false);
  assert.match(JSON.parse(disk).tokens.coordinator, /^[a-f0-9]{64}$/u);
  assert.equal(statSync(file).mode & 0o777, 0o600);

  f.clock.value += 5_000;
  await f.restart();
  const recovered = await f.request('GET', stateRoute, {token});
  assert.deepEqual(recovered.data.state.visit.completion, completed.data.state.visit.completion);
  assert.equal(recovered.data.state.visit.owner, 'backup');
  assert.equal(recovered.data.state.clock, new Date(f.clock.value).toISOString());
  assert.equal(recovered.data.trial.expiresAt, trial.expiresAt);
  assert.equal(recovered.data.trial.coordinator, true);

  const rotated = await f.request('POST', '/api/trial/invites', {token, input: {memberId: 'backup'}});
  assert.equal(rotated.status, 200);
  assert.equal((await f.request('GET', stateRoute, {token: backup})).status, 401);
  assert.equal((await f.request('GET', stateRoute, {token: rotated.data.token})).data.member.id, 'backup');
  assert.equal((await f.request('DELETE', '/api/trial/visit', {token: rotated.data.token})).status, 403);
  assert.deepEqual((await f.request('DELETE', '/api/trial/visit', {token})).data, {deleted: true});
  for (const secret of [token, ...invites.map((invite) => invite.token), rotated.data.token])
    assert.equal((await f.request('GET', stateRoute, {token: secret})).status, 401);
  assert.deepEqual(readdirSync(f.directory), ['feedback']);
  assert.deepEqual(readdirSync(join(f.directory, 'feedback')), []);
});

test('authentication binds identity and room; expired rooms leave simple errors and are purged', async (t) => {
  const f = await fixture(t, 30);
  const shortVisit = {...VISIT, startsAt: new Date(f.clock.value - 60_000).toISOString(),
    endsAt: new Date(f.clock.value + 20_000).toISOString()};
  const first = (await create(f, shortVisit)).data;
  const second = (await create(f, {...shortVisit, householdName: 'A separate test household'})).data;
  const anonymous = await f.request('GET', stateRoute);
  assert.equal(anonymous.status, 401);
  assert.deepEqual(Object.keys(anonymous.data), ['error']);
  const spoofed = await f.request('POST', commandsRoute, {token: first.token,
    input: {actor: 'backup', roomId: second.trial.id, revision: 0, type: 'complete_visit',
      payload: {note: 'Forged actor.'}}});
  assert.equal(spoofed.status, 403);
  assert.equal(spoofed.data.error.code, 'identity');
  assert.deepEqual(Object.keys(spoofed.data), ['error']);
  const forgedRoom = await f.request('POST', commandsRoute, {token: first.token,
    input: {roomId: second.trial.id, revision: 0, type: 'record_contact', payload: {note: 'First room only.'}}});
  assert.equal(forgedRoom.status, 200);
  assert.equal(forgedRoom.data.trial.id, first.trial.id);
  assert.equal(forgedRoom.data.state.visit.notes.length, 1);
  const isolated = await f.request('GET', `${stateRoute}?roomId=${first.trial.id}`, {token: second.token});
  assert.equal(isolated.data.trial.id, second.trial.id);
  assert.equal(isolated.data.state.revision, 0);
  assert.deepEqual(isolated.data.state.visit.notes, []);

  await f.request('POST', '/api/trial/feedback', {token: second.token,
    input: {useCase: 'exploring', priceInterest: 'no', note: 'Expiry integration test.'}});
  f.clock.value += 31_000;
  for (const token of [first.token, second.token]) {
    const expired = await f.request('GET', stateRoute, {token});
    assert.equal(expired.status, 401);
    assert.deepEqual(Object.keys(expired.data), ['error']);
  }
  await f.restart();
  assert.deepEqual(readdirSync(f.directory), ['feedback']);
  assert.deepEqual(readdirSync(join(f.directory, 'feedback')), []);
  const health = await f.request('GET', '/api/trial/health');
  assert.deepEqual(Object.keys(health.data).sort(), ['expiresAt', 'now', 'ok', 'ttlSeconds', 'version']);
  assert.equal(health.data.ok, true);
  assert.equal(health.data.expiresAt, new Date(f.clock.value + 30_000).toISOString());
});

test('the public service keeps same-origin writes, real visit inputs, and a small route surface', async (t) => {
  const f = await fixture(t);
  const crossOrigin = await f.request('POST', '/api/trial/visits',
    {input: VISIT, headers: {Origin: 'https://another.example'}});
  assert.equal(crossOrigin.status, 403);
  assert.equal(crossOrigin.data.error.code, 'origin');
  const missingOrigin = await fetch(`${f.base}/api/trial/visits`,
    {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(VISIT)});
  assert.equal(missingOrigin.status, 403);
  const invalidDate = await create(f, {...VISIT, startsAt: '2026-02-30T12:00:00.000Z'});
  assert.equal(invalidDate.status, 400);
  const invalidZone = await create(f, {...VISIT, timeZone: 'Somewhere/Unknown'});
  assert.equal(invalidZone.status, 400);
  const large = await f.request('POST', '/api/trial/visits', {input: {...VISIT, padding: 'x'.repeat(21 * 1024)}});
  assert.equal(large.status, 413);
  for (const route of ['/api/state', '/api/ring/sync', '/api/stream', '/src/trial-server.mjs'])
    assert.equal((await fetch(`${f.base}${route}`)).status, 404);
  const landing = await fetch(f.base, {redirect: 'manual'});
  assert.equal(landing.status, 302);
  assert.equal(landing.headers.get('location'), '/?trial=1');
  const proxyOrigin = f.base.replace('http:', 'https:');
  const proxied = await f.request('POST', '/api/trial/visits', {input: VISIT,
    headers: {Origin: proxyOrigin, 'X-Forwarded-Proto': 'https'}});
  assert.equal(proxied.status, 201);
});

test('trial creation uses distinct names and its expiry window; startup cleans its own temporary files', async (t) => {
  const f = await fixture(t);
  const duplicate = await create(f, {...VISIT, visitorName: '  aLeX  '});
  assert.equal(duplicate.status, 400);
  assert.match(duplicate.data.error.message, /role or nickname/u);
  const startsAt = new Date(f.clock.value - 60_000).toISOString();
  const ended = await create(f, {...VISIT, startsAt, endsAt: new Date(f.clock.value).toISOString()});
  assert.equal(ended.status, 400);
  assert.equal(ended.data.error.code, 'visit_window');
  const expiry = f.clock.value + 7 * 24 * 60 * 60_000;
  const beyond = await create(f, {...VISIT, endsAt: new Date(expiry + 1).toISOString()});
  assert.equal(beyond.status, 400);
  assert.equal(beyond.data.error.code, 'visit_window');
  const current = await create(f, {...VISIT, startsAt, endsAt: new Date(expiry).toISOString()});
  assert.equal(current.status, 201);
  assert.equal(current.data.state.visit.endsAt, current.data.trial.expiresAt);

  const id = current.data.trial.id;
  const roomTemporary = join(f.directory, `${id}.json.abcdef123456.tmp`);
  const feedbackTemporary = join(f.directory, 'feedback', `${id}-backup.json.abcdef123456.tmp`);
  const unrelated = [join(f.directory, 'keep.tmp'), join(f.directory, 'feedback', 'keep.tmp')];
  for (const file of [roomTemporary, feedbackTemporary, ...unrelated]) writeFileSync(file, 'Test fixture.', {mode: 0o600});
  await f.restart();
  assert.equal(existsSync(roomTemporary), false);
  assert.equal(existsSync(feedbackTemporary), false);
  for (const file of unrelated) assert.equal(existsSync(file), true);
  assert.equal((await f.request('GET', stateRoute, {token: current.data.token})).status, 200);
});
