// `npm start` runs this: it starts the helper and starts it again whenever the helper exits to pick up an update
// (the helper restarts itself, between applications, when its code changes). Ctrl+C stops both.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const RESTART_CODE = 75;
const helper = fileURLToPath(new URL('./helper.js', import.meta.url));

function start() {
  const child = spawn(process.execPath, [helper, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, APPLY_DESK_SUPERVISED: '1' },
  });
  child.on('exit', (code) => (code === RESTART_CODE ? start() : process.exit(code ?? 0)));
}

// Ctrl+C reaches the helper too; it closes its browser and exits, and this exits with it.
process.on('SIGINT', () => {});
start();
