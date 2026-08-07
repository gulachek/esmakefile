/**
 * This script is intended to quickly validate the contents of `npm pack`
 */

/* globals process, console, Buffer */

const { spawnSync } = require('node:child_process');
const {
	mkdirSync,
	rmSync,
	writeFileSync,
	readFileSync,
	accessSync,
} = require('node:fs');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');

const { version } = require('./package.json');

/**
 * Converts an array of buffers to a string
 * @param {(Buffer | null)[]} output The buffers to encode
 * @returns A UTF8 string representation of the output
 */
function outputToString(output) {
	return Buffer.concat(output.filter((b) => !!b)).toString('utf8');
}

/**
 * Synchronously run a process. Exits the process if the process encounters an
 * an error or a nonzero exit code
 * @param {string} command See `spawnSync`
 * @param {string[]} args See `spawnSync`
 * @param {Object} options See `spawnSync`
 * @returns {void}
 */
function system(command, args, options) {
	console.log(command, args);
	const { output, status, signal, error } = spawnSync(command, args, options);
	if (error) {
		console.error(error);
		process.exit(1);
	}

	if (typeof signal === 'string') {
		console.error(outputToString(output));
		console.error(`Process exited due to signal '${signal}'`);
		process.exit(1);
	}

	if (status !== 0) {
		console.error(outputToString(output));
		console.error(`Process exited with nonzero exit code '${status}'`);
		process.exit(1);
	}
}

const pack = resolve(`esmakefile-${version}.tgz`);

console.log('rmSync', pack);
rmSync(pack, { force: true });

system('npm', ['pack']);

console.log('rmSync("test-pkg", ...)');
rmSync('test-pkg', { recursive: true, force: true });

console.log('mkdirSync("test-pkg")');
mkdirSync('test-pkg');

console.log('chdir("test-pkg")');
process.chdir('test-pkg');

console.log('writeFileSync("package.json", ...)');
writeFileSync(
	'package.json',
	JSON.stringify({
		dependencies: {
			esmakefile: pack,
		},
	}),
);

system('npm', ['install']);

console.log('writeFileSync("Makefile.mjs", ...)');
writeFileSync(
	'Makefile.mjs',
	`
import { writeFile } from 'node:fs/promises';

export default function main(mk) {
	mk.rule('test', async () => {
		await writeFile('test', 'IT WORKED!');
	});
}
`,
);

// Test basic operation of the runtime
system('npx', ['esmakefile']);

console.log('readFileSync("test", ...)');
const content = readFileSync('test', 'utf8');
assert.strictEqual(
	content,
	'IT WORKED!',
	'Expected target "test" to have content "IT WORKED!"',
);

// Validate that the package contains documentation
accessSync('node_modules/esmakefile/docs/typedoc/html/index.html');
accessSync('node_modules/esmakefile/docs/typedoc/markdown/globals.md');
