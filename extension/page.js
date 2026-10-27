// On the Apply Desk page: tells the page the extension is installed, and passes on the applications Lever confirmed
// (lever.js saw its "thanks" page), so the page marks them applied. One that came in while the page was closed is
// passed on the next time it's open.
document.documentElement.dataset.applyDesk = chrome.runtime.getManifest().version;

async function passOn() {
  // Only the signed-in page listens (not the login page).
  if (!document.querySelector('#tab-queue')) return;
  const { applied = [] } = await chrome.storage.local.get('applied');
  if (!applied.length) return;
  await chrome.storage.local.set({ applied: [] });
  for (const a of applied) window.postMessage({ type: 'apply-desk:applied', id: a.id }, location.origin);
}

window.addEventListener('load', passOn);
chrome.storage.onChanged.addListener((changes) => {
  if (changes.applied?.newValue?.length) passOn();
});
