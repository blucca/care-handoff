import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { RingClient, RingError, normalizeRingEvents, verifyWebhook } from '../src/ring.mjs';

const at = 1791547800000;
const history = (id, type = 'motion', extra = {}) => ({ type: 'history-events', id, attributes: { event_type: type, start: at, ...extra }, relationships: { source: { data: { type: 'devices', id: 'camera-1' } } } });

test('Ring history and v1.1 webhooks retain identity, device, time, and classification', () => {
  const events = normalizeRingEvents({ data: [history('motion-1', 'motion', { sub_type: 'human' }), history('ring-1', 'ding'), history('view-1', 'on_demand'), history('motion-1')] }, { deviceId: 'camera-1', source: 'ring-playground' });
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(x => x.type), ['motion_detected', 'button_press']);
  assert.equal(events[0].occurredAt, new Date(at).toISOString());
  const webhook = { data: { id: 'online-1', type: 'device_online', attributes: { source: 'camera-1', timestamp: at } } };
  assert.equal(normalizeRingEvents(webhook, { deviceId: 'camera-1' })[0].type, 'device_online');
  assert.deepEqual(normalizeRingEvents(webhook, { deviceId: 'camera-2' }), []);
  assert.equal(normalizeRingEvents({ data: [history('human-2', 'motion.future_kind')] })[0].subType, 'future_kind');
  assert.throws(() => normalizeRingEvents({ data: [history('bad', 'motion', { start: 'yesterday' })] }), error => error.code === 'ring_invalid_response');
});

test('webhook verification uses original bytes and the official signature format', () => {
  const body = Buffer.from('{"data": {"id": "demo-event"}}');
  const secret = 'contract-test-secret';
  const signature = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(verifyWebhook(body, signature, secret), true);
  assert.equal(verifyWebhook(Buffer.from(JSON.stringify(JSON.parse(body))), signature, secret), false);
  assert.equal(verifyWebhook(body, 'sha256=12', secret), false);
  assert.equal(verifyWebhook(body, signature, ''), false);
});

test('bounded local HTTP sync returns official-shaped activity and a separate status snapshot', async () => {
  const calls = [];
  const server = createServer((req, res) => {
    calls.push(req.url);
    assert.equal(req.headers.authorization, 'Bearer contract-token');
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/devices') return res.end(JSON.stringify({ data: [{ type: 'devices', id: 'camera-1', attributes: { name: 'Synthetic door camera' } }] }));
    if (req.url.endsWith('/status')) return res.end(JSON.stringify({ data: { type: 'device-status', attributes: { online: false } } }));
    const cursor = new URL(req.url, 'http://localhost').searchParams.get('page[key]');
    res.end(JSON.stringify(cursor ? { data: [], links: { next: '/v1/history/devices/camera-1/events?page%5Bkey%5D=next-2' } } : { data: [history('event-1', 'ding')], links: { next: '/v1/history/devices/camera-1/events?page%5Bkey%5D=next-1' } }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const client = new RingClient({ accessToken: 'contract-token', baseUrl: `http://127.0.0.1:${server.address().port}` });
    const result = await client.sync();
    assert.equal(result.device.status, 'offline');
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].type, 'button_press');
    assert.equal(result.nextPageKey, 'next-2');
    assert.equal(result.truncated, false);
    assert.equal(calls.length, 4);
    assert.equal(JSON.stringify(client).includes('contract-token'), false);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('auth and timeout errors expose a safe explanation', async () => {
  let hang = false;
  const server = createServer((_req, res) => {
    if (hang) return;
    res.writeHead(401, { 'Content-Type': 'text/plain' });
    res.end('upstream-body-with-contract-token');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const args = { accessToken: 'contract-token', baseUrl: `http://127.0.0.1:${server.address().port}`, timeoutMs: 80 };
    await assert.rejects(new RingClient(args).discoverDevices(), error => error instanceof RingError && error.status === 401 && !JSON.stringify(error).includes('contract-token'));
    hang = true;
    await assert.rejects(new RingClient(args).discoverDevices(), error => error.code === 'ring_timeout' && error.status === 504);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
