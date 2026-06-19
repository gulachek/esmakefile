import { writeFile } from 'fs/promises';
import { Path, cli, Makefile, getLogger } from '../index.js';
import { addSass } from './SassRecipe.js';
import { addClangExecutable } from './clang/ClangExecutableRecipe.js';

cli((mk: Makefile) => {
	const logger = getLogger({ name: 'esmakefile.example.make' });
	const scssFile = Path.src('src/style.scss');
	const main = Path.build('main');
	const css = Path.build('style.css');

	mk.add('all', [css, main]);

	addSass(mk, scssFile, 'style.css');

	addClangExecutable(mk, 'main', ['src/main.cpp', 'src/hello.cpp']);

	mk.add('run-main', main, (args) => {
		return args.spawn(args.abs(main), []);
	});

	mk.add('missing-prereq', 'does-not-exist', () => {
		return true;
	});

	mk.add('warning', () => {
		logger.warn('This is a test warning.');
		return true;
	});

	mk.add('error', () => {
		logger.error('This is a test error');
		return false;
	});

	mk.add('throw', () => {
		throw new Error('hehehe');
	});

	mk.add('white-space-log', () => {
		logger.info('   \n\t\r\n  \n\n  \n');
		return true;
	});

	mk.add('write-both-streams', (args) => {
		const script = args.abs(Path.src('src/logs.cjs'));
		return args.spawn(process.execPath, [script]);
	});

	mk.add('medium-long-task', () => {
		return new Promise<boolean>((res) => {
			setTimeout(() => res(true), 15000);
		});
	});

	mk.add('long-task', () => {
		return new Promise<boolean>((res) => {
			setTimeout(() => res(true), 65000);
		});
	});

	mk.add(['grouped-error', 'grouped-error2'], () => {
		logger.error('Error message for grouped targets');
		return false;
	});

	const staleTarget = Path.build('warn-stale-target');
	const stalePrereq = Path.build('warn-stale-target-prereq');

	mk.add(staleTarget, stalePrereq);
	mk.add(stalePrereq, async (args) => {
		// this isn't supposed to make sense
		await writeFile(args.abs(staleTarget), 'stale');
		await waitMs(5);
		await writeFile(args.abs(stalePrereq), 'prereq');
	});
});

function waitMs(ms: number): Promise<void> {
	return new Promise<void>((res) => setTimeout(res, ms));
}
