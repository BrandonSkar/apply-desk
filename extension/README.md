# Apply Desk extension

Lever turns away a browser that software drives, even after you solve its CAPTCHA, so the helper can't send Lever
applications. They wait in the **By hand** queue on Apply Desk instead. You answer them there as usual, then
**Open and fill** opens the form in your own Chrome, where this extension fills it in: your answers, your resume, the
location from Lever's list, and the agreement boxes. You do the CAPTCHA and press Submit. When Lever shows its
"thanks" page, Apply Desk marks the job applied.

## Install (once)

1. In Chrome, open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose this `extension` folder.
3. On the Apply Desk card, click **Details**, then **Extension options**, and pick your resume.
4. Reload Apply Desk.

After changing these files, click the reload arrow on the extension's card in `chrome://extensions`.

## How it works

- `lever.js` runs on `jobs.lever.co`. "Open and fill" puts your answers in the form's address after `#applydesk=`
  (the part after `#` is never sent to Lever); the extension takes them out of the address before Lever's scripts run,
  waits for the page to settle, and fills each field by its name.
- `page.js` runs on Apply Desk: it tells the page the extension is installed and passes on the applications Lever
  confirmed.
- Your resume stays in this browser (`chrome.storage.local`).
