// `npm start` runs this: it starts the helper and keeps it running. The helper exits to pick up an update (it
// restarts itself, between applications, when its code changes) and is started again right away; if it crashes,
// it's started again after a short wait. Closing its browser window or pressing Ctrl+C stops both.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const RESTART_CODE = 75;
const CRASH_WAIT_MS = 30_000;
const helper = fileURLToPath(new URL('./helper.js', import.meta.url));

function start() {
  const child = spawn(process.execPath, [helper, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, APPLY_DESK_SUPERVISED: '1' },
  });
  child.on('exit', (code, signal) => {
    if (code === RESTART_CODE) return start();
    if (code === 0 || signal === 'SIGINT') return process.exit(0); // you stopped it
    console.log(`${new Date().toLocaleTimeString()} The helper stopped unexpectedly (exit ${code ?? signal}). Starting it again in 30 seconds…`);
    setTimeout(start, CRASH_WAIT_MS);
  });
}

// Ctrl+C reaches the helper too; it closes its browser and exits, and this exits with it.
process.on('SIGINT', () => {});
start();
