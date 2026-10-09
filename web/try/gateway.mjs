const status = document.querySelector('#entry-status');
const start = document.querySelector('#start-trial');
const retry = document.querySelector('#retry-entry');
async function openTrial() {
  retry.hidden = true;
  start.hidden = true;
  status.textContent = 'Opening the shared trial…';
  try {
    const response = await fetch(`./endpoint.json?v=${Math.floor(Date.now() / 60_000)}`, {cache: 'no-store', signal: AbortSignal.timeout(12_000)});
    if (!response.ok) throw new Error('The trial entry is being updated. Try again shortly.');
    const endpoint = await response.json();
    if (!endpoint.active) throw new Error('The shared trial is paused. The interactive example remains available.');
    const url = new URL(endpoint.origin);
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.trycloudflare.com') || url.username || url.password)
      throw new Error('The trial entry needs a service update. Try again shortly.');
    url.pathname = '/';
    url.search = '?trial=1';
    const key = new URLSearchParams(location.hash.slice(1)).get('key');
    if (key && /^[A-Za-z0-9_-]{43}$/.test(key)) {
      status.textContent = 'Opening your private role and the latest shared visit…';
      url.hash = new URLSearchParams({key}).toString();
      location.replace(url.href);
      return;
    }
    if (key) throw new Error('This private link is incomplete. Ask your coordinator to copy it again.');
    url.hash = '';
    start.href = url.href;
    start.hidden = false;
    status.textContent = 'Your circle’s visit starts here.';
  } catch (error) {
    status.textContent = error.message || 'The shared trial is reconnecting. Try again shortly.';
    retry.hidden = false;
  }
}
retry.addEventListener('click', openTrial);
openTrial();
