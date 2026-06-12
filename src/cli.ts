import { Makefile } from './Makefile.js';
import { Path, IBuildPath } from './Path.js';
import { Build } from './Build.js';

import { Command, OptionValues } from 'commander';
import { SourceWatcher } from './SourceWatcher.js';

export interface ICliFnOpts {
	isDevelopment: boolean;
}

export type CliFn = (make: Makefile, opts: ICliFnOpts) => void;

export function cli(fn: CliFn): void {
	const program = new Command();

	const devDesc = 'Specifies this is a development build';
	program.option('--development', devDesc, false);

	program.option(
		'--srcdir <dir>',
		"Root directory of source files (default is '.')",
	);

	program.option(
		'--outdir <dir>',
		"Root directory of build files (default is './build')",
	);

	const makeMakefile = (cmdOpts: OptionValues) => {
		const opts = { ...program.opts(), ...cmdOpts };
		const make = new Makefile({
			srcRoot: opts['srcdir'],
			buildRoot: opts['outdir'],
		});
		fn(make, { isDevelopment: !!opts['development'] });
		return make;
	};

	const runBuild = async (make: Makefile, goalPath: IBuildPath) => {
		const build = new Build(make, goalPath);
		const result = await build.run();

		return result;
	};

	program
		.command('build', { isDefault: true })
		.description('Build a specified target')
		.argument('[goal]', 'The goal target to be built')
		.action(async function (goal?: string) {
			const opts = this.opts();
			const make = makeMakefile(opts);
			const goalPath = goal && Path.build(goal);
			const result = await runBuild(make, goalPath);

			process.exit(result ? 0 : 1);
		});

	program
		.command('watch')
		.description('Rebuild top level targets when a source file changes')
		.argument('[goal]', 'The goal target to be built')
		.option('--development', devDesc, true)
		.action(async function (goal?: string) {
			const opts = this.opts();
			const make = makeMakefile(opts);
			const goalPath = goal && Path.build(goal);

			const watcher = new SourceWatcher(make.srcRoot, {
				debounceMs: 300,
				excludeDir: make.buildRoot,
			});

			watcher.on('change', () => {
				runBuild(make, goalPath);
			});

			watcher.on('unknown', (type: string) => {
				console.warn(`Unhandled ${SourceWatcher.name} event type '${type}'`);
			});

			const closeWatcher = () => watcher.close();
			const drainStdin = () => process.stdin.read();
			process.stdin.on('close', closeWatcher);
			process.stdin.on('data', drainStdin);

			runBuild(make, goalPath);
		});

	program
		.command('list')
		.description('List all targets')
		.action(function () {
			const make = makeMakefile(this.opts());
			for (const t of make.targets()) {
				console.log(t);
			}
		});

	program.parse();
}
