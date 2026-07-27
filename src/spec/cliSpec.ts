import { writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { fork, ChildProcess } from 'node:child_process';

import { expect } from 'chai';

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = 'test-src';
const thisModule = fileURLToPath(new URL(import.meta.url));
const makeCli = join(dirname(dirname(thisModule)), 'make-cli.js');

type ChildProcessResult = {
	exitCode: number;
	signal: NodeJS.Signals | null;
};

function wait(cp: ChildProcess): Promise<ChildProcessResult> {
	return new Promise<ChildProcessResult>((res, rej) => {
		cp.on('exit', (exitCode, signal) => {
			res({ exitCode, signal });
		});

		cp.on('error', rej);
	});
}

describe('make cli', () => {
	beforeEach(async () => {
		await rm(testDir, {
			recursive: true,
			force: true,
		});

		await mkdir(testDir);
	});

	const basenames = ['esmakefile', 'makefile', 'Makefile'];

	// ES Module
	for (const b of basenames) {
		for (const ext of ['.mjs', '.js']) {
			const moduleName = b + ext;

			it(`loads ES module named '${moduleName}' with default export`, async () => {
				await writeFile(
					join(testDir, 'package.json'),
					JSON.stringify({
						type: 'module',
					}),
				);

				await writeFile(
					join(testDir, moduleName),
					`
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

export default function make(mk) {
	mk.rule('probe', async (args) => {
		await writeFile('probe', 'success');
	});
}
											`,
				);

				const cp = fork(makeCli, ['--directory', testDir], {
					stdio: 'pipe',
				});
				const result = await wait(cp);
				expect(result.exitCode).to.equal(0);

				const contents = await readFile(join(testDir, 'probe'), 'utf8');
				expect(contents).to.equal('success');
			});
		}
	}

	// CommonJS
	for (const b of basenames) {
		for (const ext of ['.cjs', '.js']) {
			const moduleName = b + ext;

			it(`loads CommonJS named '${moduleName}' with top level export`, async () => {
				await writeFile(
					join(testDir, 'package.json'),
					JSON.stringify({
						type: 'commonjs',
					}),
				);

				await writeFile(
					join(testDir, moduleName),
					`
const { join } = require('node:path');
const { writeFile } = require('node:fs/promises');

module.exports = function make(mk) {
	mk.rule('probe', async (args) => {
		await writeFile('probe', 'success');
	});
}
											`,
				);

				const cp = fork(makeCli, ['--directory', testDir], {
					stdio: 'pipe',
				});
				const result = await wait(cp);
				expect(result.exitCode).to.equal(0);

				const contents = await readFile(join(testDir, 'probe'), 'utf8');
				expect(contents).to.equal('success');
			});
		}
	}

	it('uses exported function named "main" when no default export exists', async () => {
		await writeFile(
			join(testDir, 'Makefile.mjs'),
			`
import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';

export function main(mk) {
	mk.rule('probe', async (args) => {
		await writeFile('probe', 'success');
	});
}
											`,
		);

		const cp = fork(makeCli, ['--directory', testDir], {
			stdio: 'pipe',
		});
		const result = await wait(cp);
		expect(result.exitCode).to.equal(0);

		const contents = await readFile(join(testDir, 'probe'), 'utf8');
		expect(contents).to.equal('success');
	});
});
