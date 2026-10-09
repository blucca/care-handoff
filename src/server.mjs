import {createServer} from 'node:http';
import {readFileSync, writeFileSync, renameSync, mkdirSync, existsSync} from 'node:fs';
import {dirname, resolve, extname, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createDemoState, applyCommand, deriveView, ingestRingEvents, runDemoAction} from '../web/domain.mjs';
import {RingClient, normalizeRingEvents, verifyWebhook} from './ring.mjs';
import {RingWhepClient, LiveSessionPool, assertSameOrigin} from '@blucca/ring-view-bridge/node';

const WEB = fileURLToPath(new URL('../web/', import.meta.url));
const MIME = {'.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json'};

export function createCareServer({env = process.env, initialState} = {}) {
  const readToken = () => env.RING_TOKEN_FILE
    ? (existsSync(env.RING_TOKEN_FILE) ? readFileSync(env.RING_TOKEN_FILE, 'utf8').trim() : '')
    : env.RING_ACCESS_TOKEN || '';
  const configured = () => Boolean(readToken());
  const source = env.RING_SOURCE === 'ring-api' ? 'ring-api' : 'ring-playground';
  const stateFile = env.CARE_HANDOFF_STATE_FILE;
  let state = initialState || (stateFile && existsSync(stateFile)
    ? JSON.parse(readFileSync(stateFile, 'utf8'))
    : createDemoState(configured() ? {now: new Date().toISOString()} : {}));
  if (state.schema !== 'care-handoff/1') throw new Error('Choose a care-handoff/1 state file.');
  const clients = new Set();
  const liveLogFile = stateFile ? `${stateFile}.live-view.json` : null;
  let liveLog = liveLogFile && existsSync(liveLogFile) ? JSON.parse(readFileSync(liveLogFile, 'utf8')) : [];
  const liveSessions = new LiveSessionPool({
    client: new RingWhepClient({getAccessToken: readToken}),
    onEvent: event => {
      if (event.type === 'started') {
        recordLiveView(event.sessionId, {source, deviceId: event.deviceId, startedAt: event.startedAt,
          expiresAt: event.expiresAt, playbackStartedAt: null, endedAt: null});
      } else {
        recordLiveView(event.sessionId, {endedAt: event.closedAt || new Date().toISOString(),
          endReason: event.reason, closeStatus: event.type === 'closed' ? 'closed' : 'close_failed',
          ...(event.error ? {error: event.error} : {})});
      }
    },
  });
  let closing = false;
  let syncInfo = {lastSync: null, error: null};
  const envelope = () => {
    const visibleState = state.mode === 'example' ? state : {...state, clock: new Date().toISOString()};
    return {state: visibleState, view: deriveView(visibleState), ring: {
      mode: configured() ? source : 'example', configured: configured(), ...syncInfo,
      liveView: {activeSessions: liveSessions.activeCount, lastSession: liveLog.at(-1) || null},
    }};
  };
  const broadcast = () => {
    const message = `event: state\ndata: ${JSON.stringify(envelope())}\n\n`;
    for (const client of clients) client.write(message);
  };
  function save(next) {
    if (stateFile) {
      mkdirSync(dirname(resolve(stateFile)), {recursive: true, mode: 0o700});
      writeFileSync(`${stateFile}.tmp`, JSON.stringify(next, null, 2), {mode: 0o600});
      renameSync(`${stateFile}.tmp`, stateFile);
    }
    state = next;
    broadcast();
    return envelope();
  }
  function recordLiveView(sessionId, changes) {
    const existing = liveLog.find(record => record.sessionId === sessionId);
    if (existing) Object.assign(existing, changes);
    else liveLog.push({sessionId, ...changes});
    liveLog = liveLog.slice(-20);
    if (liveLogFile) {
      mkdirSync(dirname(resolve(liveLogFile)), {recursive: true, mode: 0o700});
      writeFileSync(`${liveLogFile}.tmp`, JSON.stringify(liveLog, null, 2), {mode: 0o600});
      renameSync(`${liveLogFile}.tmp`, liveLogFile);
    }
    broadcast();
  }
  const endLiveSession = (sessionId, reason) => liveSessions.close(sessionId, reason);
  function json(res, status, data) {
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
    res.end(JSON.stringify(data));
  }
  async function body(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 128 * 1024) throw Object.assign(new Error('Request exceeds 128 KiB.'), {code: 'too_large'});
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  function checkLocalRequest(req) {
    assertSameOrigin(req, env.CARE_HANDOFF_ORIGIN || `http://${req.headers.host}`);
  }
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'");
    let path;
    try {
      path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/api/state') return json(res, 200, envelope());
      if (req.method === 'GET' && path === '/api/stream') {
        res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive'});
        clients.add(res);
        res.write(`event: state\ndata: ${JSON.stringify(envelope())}\n\n`);
        const timer = setInterval(() => res.write(`event: state\ndata: ${JSON.stringify(envelope())}\n\n`), 25_000);
        req.on('close', () => {clients.delete(res); clearInterval(timer);});
        return;
      }
      if (req.method === 'POST' && path === '/api/ring/webhook') {
        const raw = await body(req);
        if (!env.RING_WEBHOOK_SECRET || !verifyWebhook(raw, req.headers['x-signature'], env.RING_WEBHOOK_SECRET))
          return json(res, 401, {error: {code: 'signature', message: 'A valid Ring webhook signature is required.'}});
        const events = normalizeRingEvents(JSON.parse(raw.toString('utf8')), {deviceId: state.device.id, source});
        const next = ingestRingEvents(state, events, {now: new Date().toISOString()});
        save(next);
        return json(res, 200, {received: events.length, revision: state.revision});
      }
      if (req.method === 'DELETE' && /^\/api\/ring\/live-session\/[a-f0-9-]+$/.test(path)) {
        checkLocalRequest(req);
        return json(res, 200, await endLiveSession(path.split('/').at(-1), 'viewer_closed'));
      }
      if (req.method === 'POST' && path.startsWith('/api/')) {
        checkLocalRequest(req);
        const raw = await body(req);
        const input = JSON.parse(raw.toString('utf8') || '{}');
        if (path === '/api/ring/live-session') {
          if (!configured()) return json(res, 422, {error: {code: 'token_required', message: 'Configure a server-side Ring Playground token to open live view.'}});
          if (closing) return json(res, 503, {error: {code: 'closing', message: 'The local server is stopping.'}});
          if (state.device.source !== source)
            return json(res, 409, {error: {code: 'ring_sync_required', message: 'Sync Ring to select the connected device before opening live view.'}});
          const device = {id: state.device.id, name: state.device.name};
          const result = await liveSessions.open({deviceId: device.id, offer: input.offer});
          if (res.destroyed) { await endLiveSession(result.sessionId, 'request_closed'); return; }
          return json(res, 201, {...result, source, device});
        }
        if (/^\/api\/ring\/live-session\/[a-f0-9-]+\/viewed$/.test(path)) {
          const sessionId = path.split('/').at(-2);
          if (!liveSessions.has(sessionId))
            return json(res, 404, {error: {code: 'ring_session_ended', message: 'Open a fresh live view to continue.'}});
          const record = liveLog.find(entry => entry.sessionId === sessionId);
          const playbackStartedAt = record?.playbackStartedAt || new Date().toISOString();
          const sources = new Set(['video-frame-callback', 'loadeddata', 'playing', 'ready-state']);
          const playbackReportSource = sources.has(input.source) ? input.source : 'browser-playing-event';
          recordLiveView(sessionId, {playbackStartedAt, playbackReportSource});
          return json(res, 200, {sessionId, playbackStartedAt});
        }
        if (path === '/api/commands') {
          const now = state.mode === 'example' ? state.clock : new Date().toISOString();
          return json(res, 200, save(applyCommand(state, input, now)));
        }
        if (path === '/api/demo/action') return json(res, 200, save(runDemoAction(state, input.action)));
        if (path === '/api/demo/reset') {
          if (state.mode !== 'example')
            return json(res, 409, {error: {code: 'mode', message: 'Use a separate state file for a fresh Ring session.'}, state});
          return json(res, 200, save(createDemoState()));
        }
        if (path === '/api/ring/sync') {
          if (!configured()) return json(res, 422, {error: {code: 'token_required', message: 'Configure a server-side Ring Playground token to sync.'}, state});
          const ring = new RingClient({accessToken: readToken()});
          const result = await ring.sync({deviceId: env.RING_DEVICE_ID || undefined, source, maxPages: 3});
          const device = {...result.device, statusAt: result.device.lastCheckedAt};
          syncInfo = {lastSync: result.syncedAt, error: null, truncated: result.truncated};
          return json(res, 200, save(ingestRingEvents(state, result.events, {now: result.syncedAt, device})));
        }
        return json(res, 404, {error: {code: 'route', message: 'Choose an available API route.'}});
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, {error: {code: 'method', message: 'Use GET or POST.'}});
      if (path.startsWith('/api/')) return json(res, 404, {error: {code: 'route', message: 'Choose an available API route.'}});
      if (path === '/' && !new URL(req.url, 'http://localhost').searchParams.has('live')) {
        res.writeHead(302, {Location: '/?live=1'}); res.end(); return;
      }
      const file = resolve(WEB, `.${decodeURIComponent(path === '/' ? '/index.html' : path)}`);
      if (!file.startsWith(WEB.endsWith(sep) ? WEB : `${WEB}${sep}`)) return json(res, 404, {error: {code: 'file', message: 'File unavailable.'}});
      const bytes = readFileSync(file);
      res.writeHead(200, {'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache'});
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      const code = error.code || 'internal';
      const safeCodes = new Set(['conflict', 'invalid', 'closed', 'role', 'pending', 'recorded', 'mode',
        'origin', 'content_type', 'too_large', 'unauthorized', 'forbidden', 'rate_limit', 'timeout',
        'network', 'no_devices', 'ring_http', 'ring_error', 'invalid_response', 'authentication']);
      const message = safeCodes.has(code) || error.name === 'RingError' ? error.message
        : error instanceof SyntaxError ? 'Send valid JSON.'
        : code === 'ENOENT' ? 'File unavailable.' : 'The operation failed. Retry after reviewing the server setup.';
      if (path === '/api/ring/sync') syncInfo = {...syncInfo, error: {code, message}};
      const status = code === 'conflict' || code === 'closed' || code === 'mode' ? 409
        : code === 'origin' ? 403 : code === 'ENOENT' ? 404 : error.name === 'RingError' ? error.status || 502
        : safeCodes.has(code) || error instanceof SyntaxError ? 400 : 500;
      json(res, status, {error: {code, message}, state});
    }
  });
  const originalClose = server.close.bind(server);
  server.close = (callback) => {
    closing = true;
    for (const client of clients) client.end();
    const cleanup = liveSessions.closeAll('server_shutdown');
    return originalClose(error => {cleanup.then(() => callback?.(error));});
  };
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 4319);
  const server = createCareServer();
  server.listen(port, host, () => {
    console.log(`Care Handoff listening at http://${host}:${port}/ — local trusted workspace`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
}
