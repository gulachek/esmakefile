import { writeFile } from 'fs/promises';
import { cli, getLogger, rebasePath } from 'esmakefile';
import { addSass } from './SassRecipe.mjs';
import { addClangExecutable } from './clang/ClangExecutableRecipe.mjs';
import { join, resolve } from 'node:path';

cli((mk) => {
	const outDir = 'build';
	const srcDir = 'src';

	const logger = getLogger({ name: 'esmakefile.example.make' });
	const main = join(outDir, 'main');
	const scssFile = join(srcDir, 'style.scss');
	const css = rebasePath(scssFile, srcDir, outDir).replace(/.scss$/, '.css');

	mk.rule('all', [css, main]);

	addSass(mk, scssFile, css);

	addClangExecutable(mk, main, ['src/main.cpp', 'src/hello.cpp']);

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
		const script = resolve(args.rootDir, 'src/logs.cjs');
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
	mk.rule(stalePrereq, async (args) => {
		// this isn't supposed to make sense
		await writeFile(resolve(args.rootDir, staleTarget), 'stale');
		await waitMs(5);
		await writeFile(resolve(args.rootDir, stalePrereq), 'prereq');
	});
});

/**
 * Wait for a given number of milliseconds
 * @param {number} ms
 * @returns {Promise<void>} A promise
 */
function waitMs(ms) {
	return new Promise((res) => setTimeout(res, ms));
}
