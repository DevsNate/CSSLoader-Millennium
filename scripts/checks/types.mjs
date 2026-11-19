// `starlight pack` doesn't type-check; this does. Needs a previous pack for
// .millennium's generated types.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const { status } = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit'], { cwd: root, stdio: 'inherit' });
if (status !== 0) process.exit(status ?? 1);
console.log('Type check passed.');
