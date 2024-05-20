import { Makefile } from './Makefile.js';
import { Path } from './Path.js';
import { Vt100BuildInProgress } from './Vt100BuildInProgress.js';

import { Command, OptionValues } from 'commander';

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

	program
		.command('build', { isDefault: true })
		.description('Build a specified target')
		.argument('[goal]', 'The goal target to be built')
		.action(async function (goal?: string) {
			const make = makeMakefile(this.opts());
			const goalPath = goal && Path.build(goal);
			const display = new Vt100BuildInProgress(make, goalPath);
			const result = await display.build();
			process.exit(result ? 0 : 1);
		});

	program
		.command('watch')
		.description('Rebuild top level targets when a source file changes')
		.argument('[goal]', 'The goal target to be built')
		.option('--development', devDesc, true)
		.action(async function (goal?: string) {
			const make = makeMakefile(this.opts());
			const goalPath = goal && Path.build(goal);
			const display = new Vt100BuildInProgress(make, goalPath);
			display.watch();
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
