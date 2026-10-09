let active;

function waitForIce(peer, timeoutMs = 8000) {
  if (peer.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => {
      clearTimeout(timer);
      peer.removeEventListener('icegatheringstatechange', change);
      resolve();
    };
    const change = () => { if (peer.iceGatheringState === 'complete') finish(); };
    const timer = setTimeout(finish, timeoutMs);
    peer.addEventListener('icegatheringstatechange', change);
  });
}

async function releaseSession(id) {
  if (!id) return;
  try {
    await fetch(`/api/ring/live-session/${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: {'Content-Type': 'application/json'},
      body: '{}', keepalive: true,
    });
  } catch { /* The backend also bounds upstream session lifetime. */ }
}

export function closeRingLiveView() {
  if (!active) return;
  const current = active;
  active = null;
  clearTimeout(current.timer);
  clearTimeout(current.expiryTimer);
  current.peer?.close();
  current.video.srcObject?.getTracks().forEach(track => track.stop());
  current.video.srcObject = null;
  current.dialog.close();
  current.dialog.remove();
  void releaseSession(current.sessionId);
}

export async function openRingLiveView({deviceName = 'Doorway', source = 'ring-playground', onArrival} = {}) {
  if (active) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'ring-live-dialog';
  dialog.setAttribute('aria-labelledby', 'ring-live-title');
  dialog.innerHTML = `<div class="dialog-header"><div><span class="eyebrow">A live doorway view</span><h2 id="ring-live-title"></h2></div><button class="icon-button" type="button" data-live-close aria-label="Close live view">×</button></div>
    <p class="ring-live-source"></p><div class="ring-live-screen"><video autoplay playsinline muted controls aria-label="Ring live doorway video"></video><p class="ring-live-status" role="status">Connecting to Ring…</p></div>
    <p class="ring-live-guidance">Each view lasts up to one minute. Watch the doorway, then record a person-confirmed update on the visit card.</p>
    <div class="ring-live-actions"><button class="button button-secondary" type="button" data-live-close>Close live view</button>${onArrival ? '<button class="button button-primary" type="button" data-live-arrival>Write an arrival receipt →</button>' : ''}</div>`;
  dialog.querySelector('h2').textContent = deviceName;
  dialog.querySelector('.ring-live-source').textContent = source === 'ring-playground'
    ? 'Official Ring Playground · simulated footage'
    : 'Ring API · connected device';
  document.body.append(dialog);
  const video = dialog.querySelector('video');
  const status = dialog.querySelector('.ring-live-status');
  const current = {dialog, video, peer: null, sessionId: null, timer: null, expiryTimer: null, playbackReported: false};
  active = current;
  dialog.querySelectorAll('[data-live-close]').forEach(button => button.addEventListener('click', closeRingLiveView));
  dialog.querySelector('[data-live-arrival]')?.addEventListener('click', () => {
    closeRingLiveView();
    onArrival();
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeRingLiveView(); });
  dialog.showModal();
  try {
    if (!globalThis.RTCPeerConnection) throw new Error('Use a browser with WebRTC support for live viewing.');
    const peer = new RTCPeerConnection({iceServers: [{urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']}]});
    current.peer = peer;
    peer.addTransceiver('video', {direction: 'recvonly'});
    peer.addTransceiver('audio', {direction: 'recvonly'});
    const media = new MediaStream();
    peer.addEventListener('track', event => {
      if (active !== current) return;
      media.addTrack(event.track);
      video.srcObject = event.streams[0] || media;
      video.play().catch(() => { status.textContent = 'Press play to watch the live view.'; });
    });
    video.addEventListener('playing', () => {
      clearTimeout(current.timer);
      status.textContent = 'Live view connected';
      status.classList.add('is-connected');
      dialog.dataset.connected = 'true';
      if (!current.playbackReported && current.sessionId) {
        current.playbackReported = true;
        void fetch(`/api/ring/live-session/${encodeURIComponent(current.sessionId)}/viewed`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'}).catch(() => {});
      }
    });
    peer.addEventListener('connectionstatechange', () => {
      if (active === current && ['failed', 'disconnected'].includes(peer.connectionState)) {
        status.textContent = 'Live connection interrupted. Close this view and open a fresh session.';
        status.classList.remove('is-connected');
      }
    });
    await peer.setLocalDescription(await peer.createOffer());
    await waitForIce(peer);
    if (active !== current) return;
    const response = await fetch('/api/ring/live-session', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({offer: peer.localDescription.sdp}), signal: AbortSignal.timeout(25000),
    });
    const session = await response.json();
    if (!response.ok) throw new Error(session.error?.message || session.message || 'The Ring live session failed to start.');
    current.sessionId = session.sessionId;
    if (active !== current) { void releaseSession(session.sessionId); return; }
    await peer.setRemoteDescription({type: 'answer', sdp: session.answer});
    status.textContent = 'Ring session opened · waiting for the first frame…';
    current.expiryTimer = setTimeout(() => {
      if (active !== current) return;
      peer.close();
      media.getTracks().forEach(track => track.stop());
      status.textContent = 'One-minute view ended. Close and reopen for another view.';
      status.classList.remove('is-connected');
      void releaseSession(current.sessionId);
    }, 60000);
    current.timer = setTimeout(() => {
      if (active === current && !dialog.dataset.connected) {
        status.textContent = 'The live stream is taking longer than expected. Close this view and retry.';
      }
    }, 20000);
  } catch (error) {
    current.peer?.close();
    void releaseSession(current.sessionId);
    current.sessionId = null;
    if (active === current) status.textContent = `Live view: ${error.message || 'connection failed. Open a fresh session.'}`;
  }
}

window.addEventListener('pagehide', closeRingLiveView);
