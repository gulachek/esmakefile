import { writeFile } from 'fs/promises';
import { Path, cli, Makefile, getLogger, rebasePath } from '../index.js';
import { addSass } from './SassRecipe.js';
import { addClangExecutable } from './clang/ClangExecutableRecipe.js';
import { join } from 'node:path';

cli((mk: Makefile) => {
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
		const script = args.abs(Path.src('src/logs.cjs'));
		return args.spawn(process.execPath, [script]);
	});

	mk.rule('medium-long-task', () => {
		return new Promise<boolean>((res) => {
			setTimeout(() => res(true), 15000);
		});
	});

	mk.rule('long-task', () => {
		return new Promise<boolean>((res) => {
			setTimeout(() => res(true), 65000);
		});
	});

	mk.rule(['grouped-error', 'grouped-error2'], () => {
		logger.error('Error message for grouped targets');
		return false;
	});

	const staleTarget = Path.build('warn-stale-target');
	const stalePrereq = Path.build('warn-stale-target-prereq');

	mk.rule(staleTarget, stalePrereq);
	mk.rule(stalePrereq, async (args) => {
		// this isn't supposed to make sense
		await writeFile(args.abs(staleTarget), 'stale');
		await waitMs(5);
		await writeFile(args.abs(stalePrereq), 'prereq');
	});
});

function waitMs(ms: number): Promise<void> {
	return new Promise<void>((res) => setTimeout(res, ms));
}
