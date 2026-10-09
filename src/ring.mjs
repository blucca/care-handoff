import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_BASE_URL = 'https://api.amazonvision.com';
const SOURCES = new Set(['example', 'ring-playground', 'ring-api']);
const EVENT_TYPES = new Map([
  ['motion', 'motion_detected'],
  ['motion_detected', 'motion_detected'],
  ['ding', 'button_press'],
  ['button_press', 'button_press'],
  ['device_online', 'device_online'],
  ['device_offline', 'device_offline'],
]);

export class RingError extends Error {
  constructor(code, message, status = 502) {
    super(message);
    this.name = 'RingError';
    this.code = code;
    this.status = status;
  }

  toJSON() {
    return { code: this.code, message: this.message, status: this.status };
  }
}

function invalidResponse() {
  return new RingError('ring_invalid_response', 'Ring returned an incomplete or invalid response. Retry the sync.');
}

function requireId(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RingError('ring_device_required', 'Select a Ring device for this household.', 400);
  }
  return value;
}

function requireSource(source) {
  if (!SOURCES.has(source)) {
    throw new RingError('ring_invalid_source', 'Choose a supported Ring event source.', 400);
  }
  return source;
}

function eventTime(value) {
  let time;
  if (typeof value === 'number' && Number.isFinite(value)) {
    time = value;
  } else if (typeof value === 'string' && /^\d+$/.test(value)) {
    time = Number(value);
  } else if (typeof value === 'string' && /T.+(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    time = Date.parse(value);
  } else {
    return null;
  }
  const date = new Date(time);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** Convert Ring JSON:API history or a v1.1 webhook into activity records. */
export function normalizeRingEvents(payload, { deviceId, source = 'ring-api' } = {}) {
  requireSource(source);
  const data = Array.isArray(payload) ? payload : payload?.data;
  if (data === null || typeof data !== 'object') throw invalidResponse();
  const items = Array.isArray(data) ? data : [data];
  const result = new Map();

  for (const item of items) {
    if (!item || typeof item !== 'object') throw invalidResponse();
    const attributes = item.attributes ?? {};
    const originalType = item.type === 'history-events' ? attributes.event_type : item.type;
    if (typeof originalType !== 'string') throw invalidResponse();
    const [baseType, ...classification] = originalType.split('.');
    const type = EVENT_TYPES.get(baseType);
    if (!type) continue;

    const explicitDevice = item.type === 'history-events'
      ? item.relationships?.source?.data?.id
      : attributes.source;
    const eventDevice = explicitDevice ?? deviceId;
    if (deviceId && explicitDevice && explicitDevice !== deviceId) continue;
    const occurredAt = eventTime(attributes.timestamp ?? attributes.start);
    if (typeof item.id !== 'string' || !item.id || typeof eventDevice !== 'string' || !eventDevice || !occurredAt) {
      throw invalidResponse();
    }

    const event = { id: item.id, type, deviceId: eventDevice, occurredAt, source };
    const subType = attributes.sub_type ?? (classification.length ? classification.join('.') : undefined);
    if (typeof subType === 'string' && subType) event.subType = subType;
    result.set(`${source}:${event.id}`, event);
  }

  return [...result.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
}

/** Verify X-Signature: sha256=<hex> against the exact HTTP request bytes. */
export function verifyWebhook(bodyBuffer, signature, secret) {
  if (!(bodyBuffer instanceof Uint8Array) || typeof signature !== 'string') return false;
  if (!(typeof secret === 'string' || secret instanceof Uint8Array) || secret.length === 0) return false;
  const match = /^sha256=([a-fA-F0-9]{64})$/.exec(signature.trim());
  if (!match) return false;
  const expected = createHmac('sha256', secret).update(bodyBuffer).digest();
  return timingSafeEqual(expected, Buffer.from(match[1], 'hex'));
}

/** Server-side Ring client. Credentials stay in private fields. */
export class RingClient {
  #accessToken;
  #baseUrl;
  #timeoutMs;

  constructor({ accessToken, baseUrl = DEFAULT_BASE_URL, timeoutMs = 8000 } = {}) {
    if (typeof accessToken !== 'string' || !accessToken.trim()) {
      throw new RingError('ring_unconfigured', 'Add a fresh Ring Playground access token to the backend environment.', 503);
    }
    let url;
    try { url = new URL(baseUrl); } catch {
      throw new RingError('ring_configuration', 'Set a valid Ring API base URL.', 500);
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new RingError('ring_configuration', 'Use an HTTPS Ring API origin or a local HTTP test server.', 500);
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
      throw new RingError('ring_configuration', 'Set the Ring request timeout between 1 and 30000 milliseconds.', 500);
    }
    this.#accessToken = accessToken.trim();
    this.#baseUrl = url;
    this.#timeoutMs = timeoutMs;
  }

  async #get(path, params = {}) {
    const url = new URL(path, this.#baseUrl);
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    }
    const signal = AbortSignal.timeout(this.#timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${this.#accessToken}`, Accept: 'application/json' },
        signal,
        redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel();
        const status = response.status;
        if (status === 401 || status === 403) {
          throw new RingError('ring_auth', `Ring access failed (HTTP ${status}). Generate a fresh token and check device access.`, status);
        }
        if (status === 429) throw new RingError('ring_rate_limited', 'Ring is rate limiting this connection (HTTP 429). Wait before the next sync.', 429);
        if (status === 404) throw new RingError('ring_device_unavailable', 'Ring device access failed (HTTP 404). Refresh device discovery.', 404);
        throw new RingError('ring_http', `Ring request failed (HTTP ${status}). Retry the sync after checking the service.`, status);
      }
      let payload;
      try { payload = await response.json(); } catch {
        if (signal.aborted) throw new RingError('ring_timeout', 'The Ring request timed out. Retry the sync.', 504);
        throw invalidResponse();
      }
      if (!payload || typeof payload !== 'object') throw invalidResponse();
      return payload;
    } catch (error) {
      if (error instanceof RingError) throw error;
      if (signal.aborted) throw new RingError('ring_timeout', 'The Ring request timed out. Retry the sync.', 504);
      throw new RingError('ring_network', 'The Ring connection failed. Check backend connectivity and retry.', 502);
    }
  }

  async discoverDevices() {
    const payload = await this.#get('/v1/devices');
    if (!Array.isArray(payload.data)) throw invalidResponse();
    return payload.data.map((item) => {
      if (item?.type !== 'devices' || typeof item.id !== 'string' || !item.id) throw invalidResponse();
      return { id: item.id, name: typeof item.attributes?.name === 'string' ? item.attributes.name : 'Ring device' };
    });
  }

  async status(deviceId) {
    const payload = await this.#get(`/v1/devices/${encodeURIComponent(requireId(deviceId))}/status`);
    if (!payload.data || typeof payload.data.attributes !== 'object' || payload.data.attributes === null) throw invalidResponse();
    const online = payload.data.attributes.online;
    return { status: online === true ? 'online' : online === false ? 'offline' : 'unknown', checkedAt: new Date().toISOString() };
  }

  async eventHistory(deviceId, { pageKey, eventTypes = 'motion,ding' } = {}) {
    const payload = await this.#get(`/v1/history/devices/${encodeURIComponent(requireId(deviceId))}/events`, {
      'page[key]': pageKey,
      event_types: Array.isArray(eventTypes) ? eventTypes.join(',') : eventTypes,
    });
    if (!Array.isArray(payload.data)) throw invalidResponse();
    return payload;
  }

  #sessionUrl(deviceId, location) {
    let url;
    try { url = new URL(location, this.#baseUrl); } catch { throw invalidResponse(); }
    const prefix = `/v1/devices/${encodeURIComponent(requireId(deviceId))}/media/streaming/whep/sessions/`;
    if (url.origin !== this.#baseUrl.origin || url.username || url.password || url.hash
      || !url.pathname.startsWith(prefix) || !/^[A-Za-z0-9_-]+$/.test(url.pathname.slice(prefix.length))) {
      throw invalidResponse();
    }
    return url;
  }

  async #mediaRequest(url, method, offer) {
    const signal = AbortSignal.timeout(this.#timeoutMs);
    try {
      const response = await fetch(url, {
        method,
        headers: {Authorization: `Bearer ${this.#accessToken}`,
          ...(method === 'POST' ? {'Content-Type': 'application/sdp', Accept: 'application/sdp'} : {})},
        ...(offer === undefined ? {} : {body: offer}),
        signal,
        redirect: 'error',
      });
      if (!response.ok && !(method === 'DELETE' && [404, 410].includes(response.status))) {
        await response.body?.cancel();
        const status = response.status;
        if (status === 401 || status === 403) {
          throw new RingError('ring_auth', `Ring access failed (HTTP ${status}). Generate a fresh token and check device access.`, status);
        }
        throw new RingError('ring_stream_http', `Ring live view failed (HTTP ${status}). Check device access and retry.`, status);
      }
      if (method === 'DELETE') {
        await response.body?.cancel();
        return {closed: true};
      }
      if (response.status !== 201 || !response.headers.get('content-type')?.startsWith('application/sdp')) {
        await response.body?.cancel();
        throw invalidResponse();
      }
      const answer = await response.text();
      if (!answer.startsWith('v=0') || answer.length > 96 * 1024) throw invalidResponse();
      return {answer, location: response.headers.get('location')};
    } catch (error) {
      if (error instanceof RingError) throw error;
      if (signal.aborted) throw new RingError('ring_timeout', 'The Ring live-view request timed out. Retry the stream.', 504);
      throw new RingError('ring_network', 'The Ring live-view connection failed. Check backend connectivity and retry.', 502);
    }
  }

  /** Exchange a browser-generated receive-only offer. Keep sessionUrl on the backend. */
  async startLiveSession(deviceId, offer) {
    requireId(deviceId);
    if (typeof offer !== 'string' || !offer.startsWith('v=0') || !offer.includes('m=video ')
      || offer.length > 96 * 1024) {
      throw new RingError('ring_invalid_offer', 'Provide a browser-generated video SDP offer within 96 KiB.', 400);
    }
    const url = new URL(`/v1/devices/${encodeURIComponent(deviceId)}/media/streaming/whep/sessions`, this.#baseUrl);
    const result = await this.#mediaRequest(url, 'POST', offer);
    return {answer: result.answer, sessionUrl: this.#sessionUrl(deviceId, result.location).toString()};
  }

  async closeLiveSession(deviceId, sessionUrl) {
    return this.#mediaRequest(this.#sessionUrl(deviceId, sessionUrl), 'DELETE');
  }

  #nextPageKey(payload, deviceId) {
    const link = typeof payload.links?.next === 'string' ? payload.links.next : payload.links?.next?.href;
    if (!link) return null;
    let url;
    try { url = new URL(link, this.#baseUrl); } catch { throw invalidResponse(); }
    const expectedPath = `/v1/history/devices/${encodeURIComponent(deviceId)}/events`;
    if (url.origin !== this.#baseUrl.origin || url.pathname !== expectedPath) throw invalidResponse();
    return url.searchParams.get('page[key]');
  }

  async sync({ deviceId, source = 'ring-playground', pageKey, maxPages = 3 } = {}) {
    requireSource(source);
    if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 5) {
      throw new RingError('ring_configuration', 'Set maxPages between 1 and 5.', 400);
    }
    const devices = await this.discoverDevices();
    if (devices.length === 0) throw new RingError('ring_no_devices', 'Ring returned zero devices. Open the Playground and select a simulated device.', 404);
    if (!deviceId && devices.length > 1) throw new RingError('ring_device_required', 'Select the Ring device assigned to this household.', 400);
    const selected = deviceId ? devices.find((device) => device.id === deviceId) : devices[0];
    if (!selected) throw new RingError('ring_device_unavailable', 'The selected device is outside this token’s device list. Select an available device.', 404);

    const snapshot = await this.status(selected.id);
    const events = new Map();
    const seenPages = new Set();
    let nextPageKey = pageKey ?? null;
    let truncated = false;
    for (let page = 0; page < maxPages; page += 1) {
      seenPages.add(nextPageKey);
      const payload = await this.eventHistory(selected.id, { pageKey: nextPageKey });
      for (const event of normalizeRingEvents(payload, { deviceId: selected.id, source })) {
        events.set(`${event.source}:${event.id}`, event);
      }
      nextPageKey = this.#nextPageKey(payload, selected.id);
      if (!nextPageKey || payload.data.length === 0) break;
      if (seenPages.has(nextPageKey) || page === maxPages - 1) {
        truncated = true;
        break;
      }
    }

    return {
      device: { ...selected, status: snapshot.status, lastCheckedAt: snapshot.checkedAt, source },
      events: [...events.values()].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id)),
      syncedAt: new Date().toISOString(),
      nextPageKey,
      truncated,
    };
  }
}
