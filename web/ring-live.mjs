import {createRingViewer} from './vendor/ring-view-bridge.mjs';

let active;

export function closeRingLiveView() {
  if (!active) return;
  const current = active;
  active = null;
  current.dialog.close();
  current.dialog.remove();
  void current.viewer.close();
}

export async function openRingLiveView({deviceName = 'Doorway', source = 'ring-playground', onArrival} = {}) {
  if (active) return;
  const dialog = document.createElement('dialog');
  dialog.className = 'ring-live-dialog';
  dialog.setAttribute('aria-labelledby', 'ring-live-title');
  dialog.innerHTML = `<div class="dialog-header"><div><span class="eyebrow">A live doorway view</span><h2 id="ring-live-title"></h2></div><button class="icon-button" type="button" data-live-close aria-label="Close live view">×</button></div>
    <p class="ring-live-source"></p><div class="ring-live-screen"><video autoplay playsinline muted controls aria-label="Ring live doorway video"></video><p class="ring-live-status" role="status">Connecting to Ring…</p></div>
    <p class="ring-live-guidance">Each view lasts up to one minute. Watch the doorway, then record a person-confirmed update on the visit card.</p>
    <div class="ring-live-actions"><button class="button button-secondary" type="button" data-live-close>Close live view</button>${onArrival ? '<button class="button button-primary" type="button" data-live-arrival>Write an arrival receipt</button>' : ''}</div>`;
  dialog.querySelector('h2').textContent = deviceName;
  dialog.querySelector('.ring-live-source').textContent = source === 'ring-playground'
    ? 'Official Ring Playground · simulated footage'
    : 'Ring API · connected device';
  document.body.append(dialog);
  const video = dialog.querySelector('video');
  const status = dialog.querySelector('.ring-live-status');
  const current = {dialog, video, viewer: null};
  active = current;
  current.viewer = createRingViewer({
    video,
    createSession: async ({offer, signal}) => {
      const response = await fetch('/api/ring/live-session', {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({offer}), signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || 'The Ring live session failed to start.');
      return result;
    },
    releaseSession: async sessionId => {
      const response = await fetch(`/api/ring/live-session/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE', headers: {'Content-Type': 'application/json'}, body: '{}', keepalive: true,
      });
      if (!response.ok) throw new Error(`Closing the live view failed (HTTP ${response.status}).`);
    },
    onStateChange: event => {
      if (active !== current) return;
      const messages = {
        idle: 'Ready to connect', connecting: 'Connecting to Ring…',
        waiting: 'Ring session opened · waiting for the first frame…', playing: 'Live view connected',
        interrupted: 'Live connection interrupted. Close this view and open a fresh session.',
        ended: 'One-minute view ended. Close and reopen for another view.',
        error: 'The live view failed. Close this view and retry.',
      };
      status.textContent = event.error?.message || messages[event.state];
      status.classList.toggle('is-connected', event.state === 'playing');
      if (event.state === 'playing') dialog.dataset.connected = 'true';
    },
    onFirstFrame: ({session, source}) => {
      void fetch(`/api/ring/live-session/${encodeURIComponent(session.sessionId)}/viewed`, {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({source}),
      }).catch(() => {});
    },
  });
  dialog.querySelectorAll('[data-live-close]').forEach(button => button.addEventListener('click', closeRingLiveView));
  dialog.querySelector('[data-live-arrival]')?.addEventListener('click', () => {
    closeRingLiveView();
    onArrival();
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeRingLiveView(); });
  dialog.showModal();
  await current.viewer.start().catch(() => {});
}

window.addEventListener('pagehide', closeRingLiveView);
