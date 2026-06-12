import { writeFile } from 'fs/promises';
import { Path, cli, Makefile, ICliFnOpts, getLogger } from '../index.js';
import { addSass } from './SassRecipe.js';
import { addClangExecutable } from './clang/ClangExecutableRecipe.js';

cli((make: Makefile, opts: ICliFnOpts) => {
	const logger = getLogger({ name: 'esmakefile.example.make' });
	const scssFile = Path.src('src/style.scss');
	const main = Path.build('main');
	const css = Path.build('style.css');
	const checkIsDev = Path.build('check-is-dev');

	make.add('all', [css, main, checkIsDev]);

	addSass(make, scssFile, 'style.css');

	make.add(checkIsDev, () => {
		logger.info(`Is development? ${opts.isDevelopment}`);
	});

	addClangExecutable(make, 'main', ['src/main.cpp', 'src/hello.cpp']);

	make.add('run-main', main, (args) => {
		return args.spawn(args.abs(main), []);
	});

	make.add('missing-prereq', 'does-not-exist', () => {
		return true;
	});

	make.add('warning', () => {
		logger.warn('This is a test warning.');
		return true;
	});

	make.add('error', () => {
		logger.error('This is a test error');
		return false;
	});

	make.add('throw', () => {
		throw new Error('hehehe');
	});

	make.add('white-space-log', () => {
		logger.info('   \n\t\r\n  \n\n  \n');
		return true;
	});

	make.add('write-both-streams', (args) => {
		const script = args.abs(Path.src('src/logs.cjs'));
		return args.spawn(process.execPath, [script]);
	});

	make.add('medium-long-task', () => {
		return new Promise<boolean>((res) => {
			setTimeout(() => res(true), 15000);
		});
	});

	make.add('long-task', () => {
		return new Promise<boolean>((res) => {
			setTimeout(() => res(true), 65000);
		});
	});

	make.add(['grouped-error', 'grouped-error2'], () => {
		logger.error('Error message for grouped targets');
		return false;
	});

	const staleTarget = Path.build('warn-stale-target');
	const stalePrereq = Path.build('warn-stale-target-prereq');

	make.add(staleTarget, stalePrereq);
	make.add(stalePrereq, async (args) => {
		// this isn't supposed to make sense
		await writeFile(args.abs(staleTarget), 'stale');
		await waitMs(5);
		await writeFile(args.abs(stalePrereq), 'prereq');
	});
});

function waitMs(ms: number): Promise<void> {
	return new Promise<void>((res) => setTimeout(res, ms));
}
