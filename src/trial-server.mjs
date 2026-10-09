import {createServer} from 'node:http';
import {createHash, randomBytes} from 'node:crypto';
import {mkdirSync, chmodSync, readFileSync, writeFileSync, renameSync, readdirSync,
  statSync, unlinkSync} from 'node:fs';
import {resolve, join, extname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {isIP} from 'node:net';
import {createVisitState, applyCommand, deriveView, DomainError} from '../web/domain.mjs';

const VERSION = 'care-handoff-trial/1';
const WEB = fileURLToPath(new URL('../web/', import.meta.url));
const MAX_ROOMS = 100;
const MAX_BODY = 20 * 1024;
const MAX_ROOM_BYTES = 256 * 1024;
const MEMBER_IDS = ['coordinator', 'visitor', 'backup'];
const STATIC_FILES = new Set(['index.html', 'app.mjs', 'domain.mjs', 'styles.css', 'trial.mjs', 'trial.css']);
const MIME = {'.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8'};
const ROUTES = new Set(['GET /api/trial/state', 'POST /api/trial/visits',
  'POST /api/trial/commands', 'POST /api/trial/invites', 'POST /api/trial/feedback',
  'DELETE /api/trial/visit']);
const hash = (token) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');
const iso = (time) => new Date(time).toISOString();
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

class TrialError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const fail = (status, code, message) => { throw new TrialError(status, code, message); };
const removeFile = (file) => {
  try { unlinkSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
};
function atomicJSON(file, value) {
  const temporary = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value), {mode: 0o600, flag: 'wx'});
    renameSync(temporary, file);
  } finally { removeFile(temporary); }
}
function loopback(req) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
}
function clientIP(req) {
  const forwarded = req.headers['cf-connecting-ip'];
  return loopback(req) && typeof forwarded === 'string' && isIP(forwarded)
    ? forwarded : req.socket.remoteAddress || 'local';
}
function readJSON(req) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > MAX_BODY) {
    req.resume();
    return Promise.reject(new TrialError(413, 'too_large', 'Requests support up to 20 KiB.'));
  }
  return new Promise((resolveBody, reject) => {
    let size = 0, settled = false;
    const chunks = [];
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true; chunks.length = 0; reject(error);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        rejectOnce(new TrialError(413, 'too_large', 'Requests support up to 20 KiB.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', () => rejectOnce(new TrialError(400, 'request', 'The request was interrupted.')));
    req.on('aborted', () => rejectOnce(new TrialError(400, 'request', 'The request was interrupted.')));
    req.on('end', () => {
      if (settled) return;
      try {
        const input = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!input || typeof input !== 'object' || Array.isArray(input))
          fail(400, 'invalid', 'Send a JSON object.');
        settled = true; resolveBody(input);
      } catch (error) {
        rejectOnce(error instanceof SyntaxError
          ? new TrialError(400, 'invalid', 'Send valid JSON.') : error);
      }
    });
  });
}

export function createTrialServer({env = process.env, now = () => Date.now()} = {}) {
  if (!env.CARE_TRIAL_DIR) throw new Error('Set CARE_TRIAL_DIR to a private persistent directory.');
  const directory = resolve(env.CARE_TRIAL_DIR);
  const feedbackDirectory = join(directory, 'feedback');
  const ttlSeconds = Number(env.CARE_TRIAL_TTL_SECONDS || 7 * 24 * 60 * 60);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 7 * 24 * 60 * 60)
    throw new Error('CARE_TRIAL_TTL_SECONDS must be an integer from 1 to 604800.');
  let configuredOrigin;
  if (env.CARE_TRIAL_ORIGIN) {
    const origin = new URL(env.CARE_TRIAL_ORIGIN);
    if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password
      || origin.pathname !== '/' || origin.search || origin.hash)
      throw new Error('CARE_TRIAL_ORIGIN must be an HTTP(S) origin.');
    configuredOrigin = origin.origin;
  }
  for (const dir of [directory, feedbackDirectory]) {
    mkdirSync(dir, {recursive: true, mode: 0o700});
    chmodSync(dir, 0o700);
  }
  const rooms = new Map();
  const tokens = new Map();
  const rates = new Map();
  const roomPath = (id) => join(directory, `${id}.json`);
  const feedbackPath = (id, memberId) => join(feedbackDirectory, `${id}-${memberId}.json`);

  function indexRoom(room) {
    const previous = rooms.get(room.id);
    if (previous) for (const value of Object.values(previous.tokens)) tokens.delete(value);
    rooms.set(room.id, room);
    for (const memberId of MEMBER_IDS) tokens.set(room.tokens[memberId], {roomId: room.id, memberId});
  }
  function eraseRoom(room) {
    for (const memberId of MEMBER_IDS) removeFile(feedbackPath(room.id, memberId));
    removeFile(roomPath(room.id));
    for (const value of Object.values(room.tokens)) tokens.delete(value);
    rooms.delete(room.id);
  }
  function cleanupExpired() {
    const time = now();
    for (const room of rooms.values()) if (Date.parse(room.expiresAt) <= time) eraseRoom(room);
    for (const [key, entry] of rates) if (entry.until <= time) rates.delete(key);
  }
  for (const filename of readdirSync(directory)) {
    if (/^[a-f0-9]{32}\.json\.[a-f0-9]{12}\.tmp$/u.test(filename)) {
      removeFile(join(directory, filename)); continue;
    }
    if (!/^[a-f0-9]{32}\.json$/u.test(filename)) continue;
    const file = join(directory, filename);
    if (statSync(file).size > MAX_ROOM_BYTES + 16 * 1024)
      throw new Error('A stored trial exceeds the room size limit.');
    const room = JSON.parse(readFileSync(file, 'utf8'));
    if (room.schema !== VERSION || `${room.id}.json` !== filename || room.coordinatorId !== 'coordinator'
      || !Number.isFinite(Date.parse(room.expiresAt)) || room.state?.schema !== 'care-handoff/1'
      || room.state.mode !== 'trial' || !MEMBER_IDS.every((id) =>
        /^[a-f0-9]{64}$/u.test(room.tokens?.[id] || '') && room.state.members?.some((member) => member.id === id)))
      throw new Error('A stored trial needs a valid room schema.');
    if (Date.parse(room.expiresAt) <= now()) { eraseRoom(room); continue; }
    if (rooms.size >= MAX_ROOMS) throw new Error('Trial storage supports up to 100 active visits.');
    indexRoom(room);
  }
  // A crash between saving feedback and removing its room can leave an orphan receipt.
  for (const filename of readdirSync(feedbackDirectory)) {
    if (/^[a-f0-9]{32}-(coordinator|visitor|backup)\.json\.[a-f0-9]{12}\.tmp$/u.test(filename)) {
      removeFile(join(feedbackDirectory, filename)); continue;
    }
    const match = filename.match(/^([a-f0-9]{32})-(coordinator|visitor|backup)\.json$/u);
    if (match && !rooms.has(match[1])) removeFile(join(feedbackDirectory, filename));
  }

  function rate(scope, key, limit, windowMs) {
    const time = now();
    const id = `${scope}:${key}`;
    let entry = rates.get(id);
    if (!entry || entry.until <= time) {
      if (rates.size >= 1024) {
        for (const [oldKey, old] of rates) if (old.until <= time) rates.delete(oldKey);
        if (rates.size >= 1024) fail(429, 'rate_limit', 'The trial is busy. Try again shortly.');
      }
      entry = {count: 0, until: time + windowMs};
      rates.set(id, entry);
    }
    if (entry.count >= limit) fail(429, 'rate_limit', 'Please pause and try again shortly.');
    entry.count++;
  }
  function expectedOrigin(req) {
    if (configuredOrigin) return configuredOrigin;
    const forwarded = loopback(req) && req.headers['x-forwarded-proto'];
    const protocol = forwarded === 'https' ? 'https' : 'http';
    try {
      const url = new URL(`${protocol}://${req.headers.host}`);
      if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
      return url.origin;
    } catch { return null; }
  }
  function checkWrite(req) {
    const expected = expectedOrigin(req);
    if (!expected || req.headers.origin !== expected || req.headers['sec-fetch-site'] === 'cross-site')
      fail(403, 'origin', 'Use the trial’s own origin for this action.');
    if (!/^application\/json(?:\s*;.*)?$/iu.test(req.headers['content-type'] || ''))
      fail(415, 'content_type', 'Send application/json.');
  }
  function authenticate(req) {
    const match = req.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/u);
    const found = match && tokens.get(hash(match[1]));
    const room = found && rooms.get(found.roomId);
    if (!room || Date.parse(room.expiresAt) <= now())
      fail(401, 'unauthorized', 'Open a current private member link.');
    return {room, memberId: found.memberId};
  }
  function envelope(room, memberId) {
    const state = {...room.state, clock: iso(Math.max(now(), Date.parse(room.state.clock)))};
    return {state, view: deriveView(state), member: state.members.find((member) => member.id === memberId),
      trial: {id: room.id, expiresAt: room.expiresAt, coordinator: memberId === room.coordinatorId}};
  }
  function save(room) {
    const limit = MAX_ROOM_BYTES + (room.state.visit.completion || room.state.visit.cancelled ? 16 * 1024 : 0);
    if (Buffer.byteLength(JSON.stringify(room)) > limit)
      fail(409, 'capacity', 'This visit reached its update limit. Record a completion receipt or cancel it.');
    atomicJSON(roomPath(room.id), room);
    indexRoom(room);
  }
  function json(res, status, data) {
    if (res.destroyed) return;
    res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
    res.end(JSON.stringify(data));
  }

  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'");
    let auth;
    try {
      const url = new URL(req.url, 'http://localhost');
      const path = url.pathname;
      const route = `${req.method} ${path}`;
      if (route === 'GET /api/trial/health') {
        const time = now();
        return json(res, 200, {ok: true, version: VERSION, now: iso(time), ttlSeconds,
          expiresAt: iso(time + ttlSeconds * 1000)});
      }
      if (path.startsWith('/api/')) {
        if (!ROUTES.has(route)) fail(404, 'route', 'Choose an available trial API route.');
        if (route === 'GET /api/trial/state') {
          auth = authenticate(req);
          return json(res, 200, envelope(auth.room, auth.memberId));
        }
        checkWrite(req);
        const ip = clientIP(req);
        rate('write', ip, 120, 60_000);
        if (route === 'POST /api/trial/visits') {
          rate('create', ip, 10, 60 * 60_000);
          const input = await readJSON(req);
          cleanupExpired();
          if (rooms.size >= MAX_ROOMS) fail(503, 'capacity', 'The trial is full. Try again after a visit expires.');
          const time = now();
          const id = randomBytes(16).toString('hex');
          const state = createVisitState(input, {now: time, householdId: id, visitId: `${id}-visit`});
          const expiresAt = iso(time + ttlSeconds * 1000);
          if (Date.parse(state.visit.endsAt) <= time || Date.parse(state.visit.endsAt) > Date.parse(expiresAt))
            fail(400, 'visit_window', 'The visit must end after now and within the trial expiry window.');
          const links = Object.fromEntries(MEMBER_IDS.map((memberId) => [memberId, newToken()]));
          const room = {schema: VERSION, id, createdAt: iso(time), expiresAt,
            coordinatorId: 'coordinator', tokens: Object.fromEntries(MEMBER_IDS.map((memberId) =>
              [memberId, hash(links[memberId])])), state};
          save(room);
          return json(res, 201, {...envelope(room, 'coordinator'), token: links.coordinator,
            invites: state.members.filter((member) => member.id !== 'coordinator').map((member) =>
              ({memberId: member.id, name: member.name, token: links[member.id]}))});
        }
        auth = authenticate(req);
        rate('member', `${auth.room.id}:${auth.memberId}`, 60, 60_000);
        const input = await readJSON(req);
        // Re-read after consuming the body so concurrent writes use the latest revision and keys.
        auth = authenticate(req);
        const {room, memberId} = auth;
        if (route === 'POST /api/trial/commands') {
          if (own(input, 'actor') && input.actor !== memberId)
            fail(403, 'identity', 'Actions use the member attached to this private link.');
          const state = applyCommand(room.state, {type: input.type, revision: input.revision,
            payload: input.payload, actor: memberId}, iso(now()));
          const next = {...room, state};
          save(next);
          return json(res, 200, envelope(next, memberId));
        }
        if (route === 'POST /api/trial/feedback') {
          if (!['family', 'professional', 'exploring'].includes(input.useCase)
            || !['yes', 'maybe', 'no'].includes(input.priceInterest))
            fail(400, 'invalid', 'Choose a use case and a price-interest answer.');
          const note = input.note ?? '';
          const email = input.email ?? '';
          if (typeof note !== 'string' || note.length > 1000
            || typeof email !== 'string' || email.length > 254
            || (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email.trim())))
            fail(400, 'invalid', 'Use up to 1000 note characters and a valid optional email.');
          atomicJSON(feedbackPath(room.id, memberId), {at: iso(now()), expiresAt: room.expiresAt,
            roomId: room.id, actor: memberId, useCase: input.useCase, priceInterest: input.priceInterest,
            note: note.trim(), email: email.trim()});
          return json(res, 200, {received: true});
        }
        if (memberId !== room.coordinatorId)
          fail(403, 'role', 'The original coordinator manages member links and trial deletion.');
        if (route === 'POST /api/trial/invites') {
          if (!['visitor', 'backup'].includes(input.memberId))
            fail(400, 'invalid', 'Choose the planned visitor or backup.');
          const token = newToken();
          save({...room, tokens: {...room.tokens, [input.memberId]: hash(token)}});
          const member = room.state.members.find((person) => person.id === input.memberId);
          return json(res, 200, {memberId: member.id, name: member.name, token});
        }
        eraseRoom(room);
        return json(res, 200, {deleted: true});
      }
      if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'method', 'Use GET or HEAD for the app.');
      if (path === '/' && url.searchParams.get('trial') !== '1') {
        res.writeHead(302, {Location: '/?trial=1', 'Cache-Control': 'no-store'});
        res.end(); return;
      }
      const name = path === '/' ? 'index.html' : path.slice(1);
      if (!STATIC_FILES.has(name)) fail(404, 'file', 'File unavailable.');
      const bytes = readFileSync(join(WEB, name));
      res.writeHead(200, {'Content-Type': MIME[extname(name)], 'Cache-Control': 'no-cache'});
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      const domain = error instanceof DomainError;
      const code = domain || error instanceof TrialError ? error.code
        : error.code === 'ENOENT' ? 'file' : 'internal';
      const status = error instanceof TrialError ? error.status
        : domain ? (['conflict', 'closed', 'pending', 'recorded'].includes(code) ? 409 : code === 'role' ? 403 : 400)
          : code === 'file' ? 404 : 500;
      const message = domain || error instanceof TrialError ? error.message
        : status === 404 ? 'File unavailable.' : 'The operation failed. Please retry shortly.';
      const current = auth && rooms.get(auth.room.id);
      const data = {error: {code, message}};
      if (status === 409 && current && Date.parse(current.expiresAt) > now())
        Object.assign(data, envelope(current, auth.memberId));
      json(res, status, data);
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.timeout = 20_000;
  server.maxConnections = 128;
  server.maxRequestsPerSocket = 200;
  const cleanup = setInterval(() => {
    try { cleanupExpired(); }
    catch { console.error('Care Handoff trial: expired-storage cleanup failed.'); }
  }, 60_000);
  cleanup.unref();
  server.on('close', () => clearInterval(cleanup));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 4320);
  try {
    createTrialServer().listen(port, host, () => {
      console.log(`Care Handoff trial listening at http://${host}:${port}/?trial=1`);
    });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
