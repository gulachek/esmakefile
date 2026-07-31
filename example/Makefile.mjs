/** @import { Makefile } from 'esmakefile' */
/* globals process, setTimeout */
import { writeFile } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { getLogger, rebasePath } from 'esmakefile';
import { addSass } from './SassRecipe.mjs';
import { join, delimiter, resolve } from 'node:path';
import { platform } from 'node:os';

/**
 * Transform a path to appropriately include .exe for windows
 *
 * @param {string} path
 * @returns {string}
 */
function exe(path) {
	return platform() === 'win32' ? path + '.exe' : path;
}

/**
 * @param {Makefile} mk
 * @returns {void}
 */
export default function main(mk) {
	const outDir = 'build';
	const srcDir = 'src';
	const cmake = exe('cmake');

	const logger = getLogger({ name: 'esmakefile.example.make' });
	const main = join(outDir, exe('main'));
	const scssFile = join(srcDir, 'style.scss');
	const css = rebasePath(scssFile, srcDir, outDir).replace(/.scss$/, '.css');

	mk.rule('all', [css, main]);

	addSass(mk, scssFile, css);

	const cmakeCache = join(outDir, 'CMakeCache.txt');
	const cmakeLists = 'CMakeLists.txt';
	mk.rule(cmakeCache, [cmakeLists], (args) => {
		/** @type {string[]} */
		const cmakeArgs = ['-S', '.', '-B', outDir];
		if (platform() === 'win32') cmakeArgs.push('-G', 'Ninja');
		else cmakeArgs.push(`-DCMAKE_MAKE_PROGRAM=${posixWhichMake()}`);

		return args.spawn(cmake, cmakeArgs);
	});

	const force = 'force';
	mk.rule(force);

	mk.rule(main, [cmakeCache, force], (args) => {
		args.restat();
		return args.spawn(cmake, ['--build', outDir]);
	});

	mk.rule('run-main', main, (args) => {
		return args.spawn(main, []);
	});

	mk.rule('missing-prereq', 'does-not-exist', () => {
		return true;
	});

	mk.rule('warning', () => {
		logger.warn('This is a test warning.');
		return true;
	});

	mk.rule('error', () => {
		logger.error('This is a test error');
		return false;
	});

	mk.rule('throw', () => {
		throw new Error('hehehe');
	});

	mk.rule('white-space-log', () => {
		logger.info('   \n\t\r\n  \n\n  \n');
		return true;
	});

	mk.rule('write-both-streams', (args) => {
		const script = 'src/logs.cjs';
		return args.spawn(process.execPath, [script]);
	});

	mk.rule('medium-long-task', () => {
		return new Promise((res) => {
			setTimeout(() => res(true), 15000);
		});
	});

	mk.rule('long-task', () => {
		return new Promise((res) => {
			setTimeout(() => res(true), 65000);
		});
	});

	mk.rule(['grouped-error', 'grouped-error2'], () => {
		logger.error('Error message for grouped targets');
		return false;
	});

	const staleTarget = 'warn-stale-target';
	const stalePrereq = 'warn-stale-target-prereq';

	mk.rule(staleTarget, stalePrereq);
	mk.rule(stalePrereq, async () => {
		// this isn't supposed to make sense
		await writeFile(staleTarget, 'stale');
		await waitMs(5);
		await writeFile(stalePrereq, 'prereq');
	});
}

/**
 * Wait for a given number of milliseconds
 * @param {number} ms
 * @returns {Promise<void>} A promise
 */
function waitMs(ms) {
	return new Promise((res) => setTimeout(res, ms));
}

/**
 * Find `make` executable in PATH
 */
function posixWhichMake() {
	const envPath = process.env['PATH'] || '';
	const entries = envPath.split(delimiter);
	for (const entry of entries) {
		const make = join(entry, 'make');
		if (resolve(make) === resolve(process.argv[1])) continue;
		const st = statSync(make, { throwIfNoEntry: false });
		if (st) return make;
	}

	throw new Error(`'make' not found in PATH (${envPath})`);
}
