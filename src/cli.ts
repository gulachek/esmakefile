import { Makefile } from './Makefile.js';
import { Path } from './Path.js';
import { Vt100BuildInProgress } from './Vt100BuildInProgress.js';

import { Command } from 'commander';

export interface IStdBuildOpts {
	isDevelopment: boolean;
}

type StdBuildFn = (make: Makefile, opts: IStdBuildOpts) => void;

export function cli(fn: StdBuildFn): void {
	const program = new Command();

	program.option('--development', 'Specifies this is a development build');

	program.option(
		'--srcdir <dir>',
		"Root directory of source files (default is '.')",
	);

	program.option(
		'--outdir <dir>',
		"Root directory of build files (default is './build')",
	);

	const makeMakefile = () => {
		const opts = program.opts();
		const make = new Makefile({
			srcRoot: opts['srcdir'],
			buildRoot: opts['outdir'],
		});
		fn(make, { isDevelopment: opts['development'] });
		return make;
	};

	program
		.command('build', { isDefault: true })
		.description('Build a specified target')
		.argument('[goal]', 'The goal target to be built')
		.action(async (goal?: string) => {
			const make = makeMakefile();
			const goalPath = goal && Path.build(goal);
			const display = new Vt100BuildInProgress(make, goalPath);
			const result = await display.build();
			process.exit(result ? 0 : 1);
		});

	program
		.command('watch')
		.description('Rebuild top level targets when a source file changes')
		.argument('[goal]', 'The goal target to be built')
		.action(async (goal?: string) => {
			const make = makeMakefile();
			const goalPath = goal && Path.build(goal);
			const display = new Vt100BuildInProgress(make, goalPath);
			display.watch();
		});

	program
		.command('list')
		.description('List all targets')
		.action(() => {
			const make = makeMakefile();
			for (const t of make.targets()) {
				console.log(t);
			}
		});

	program.parse();
}
