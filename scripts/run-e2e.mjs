import { rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const persistRoot = resolve('.wrangler/e2e');
const platformPersistPath = resolve(persistRoot, 'v3');
const signalExitCodes = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
const playwrightArgs = process.argv.slice(2);

let activeChild;
let receivedSignal;

for (const signal of Object.keys(signalExitCodes)) {
	process.once(signal, () => {
		receivedSignal = signal;
		activeChild?.kill(signal);
	});
}

function run(command, args, env = process.env) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, {
			stdio: 'inherit',
			env
		});
		activeChild = child;

		child.once('error', reject);
		child.once('exit', (code, signal) => {
			activeChild = undefined;
			resolvePromise({ code: code ?? 1, signal });
		});
	});
}

async function removeDisposableDatabase() {
	await rm(persistRoot, { recursive: true, force: true });
}

let exitCode = 1;

try {
	await removeDisposableDatabase();

	const migration = await run(
		'pnpm',
		[
			'exec',
			'wrangler',
			'd1',
			'migrations',
			'apply',
			'finance-tracker-local',
			'--local',
			'--persist-to',
			persistRoot
		],
		{ ...process.env, CI: '1' }
	);

	if (receivedSignal || migration.code !== 0 || migration.signal) {
		exitCode = migration.code;
	} else {
		const playwright = await run('pnpm', ['exec', 'playwright', 'test', ...playwrightArgs], {
			...process.env,
			E2E_D1_PERSIST_PATH: platformPersistPath
		});
		exitCode = playwright.code;
	}
} catch (error) {
	console.error(error);
} finally {
	await removeDisposableDatabase();
}

process.exitCode = receivedSignal ? signalExitCodes[receivedSignal] : exitCode;
