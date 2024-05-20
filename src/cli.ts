import { Makefile } from './Makefile.js';
import { Path } from './Path.js';
import { Vt100BuildInProgress } from './Vt100BuildInProgress.js';

import { Command, Option } from 'commander';

interface ICliOptionTypeMap {
	boolean: boolean;
	string: string;
}

type OptionValues = ICliOptionTypeMap[keyof ICliOptionTypeMap];

/**
 * The name of a type that a CLI option value can have
 */
export type CliOptionValueType = keyof ICliOptionTypeMap;

/**
 * An individual option for the command line
 */
export interface ICliOptionDescription<
	OptionValueType extends CliOptionValueType,
> {
	/**
	 * The name of the argument to pass via command line
	 * @example 'hello-world' to pass as '--hello-world'
	 */
	arg: string;

	/**
	 * The name of the type that the parsed parameter value takes
	 */
	type: OptionValueType;
}

type CliOptionDescriptionOf<T extends CliOptionValueType> = T extends unknown
	? ICliOptionDescription<T>
	: never;

/**
 * Union of valid ICliOptionDescription types
 */
export type CliOptionDescription = CliOptionDescriptionOf<
	keyof ICliOptionTypeMap
>;

type ValueTypeOfDesc<T extends CliOptionDescription> =
	T extends CliOptionDescriptionOf<infer TValueType>
		? ICliOptionTypeMap[TValueType]
		: never;

/**
 * A group of options to be parsed by the command line
 */
export type CliOptionGroup = {
	[key: string]: CliOptionDescription;
};

/**
 * Options parsed from a CliOptionGroup to configure a build
 */
export type BuildOptionGroupOf<TCli extends CliOptionGroup> = {
	[P in keyof TCli]: ValueTypeOfDesc<TCli[P]>;
};

function makeCliOpts<T extends CliOptionGroup>(opts: T): T {
	return opts;
}

const stdOpts = makeCliOpts({
	isDevelopment: {
		arg: 'development',
		type: 'boolean',
	},
	sourceRoot: {
		arg: 'source-root',
		type: 'string',
	},
});

export type StdBuildOpts = BuildOptionGroupOf<typeof stdOpts>;

/**
 * All groups of options to be parsed by the command line
 */
export type CliOptions = {
	[key: string]: CliOptionGroup;
};

/**
 * All options parsed from CliOptions to configure a build
 */
export type BuildOptionsOf<TCli extends CliOptions> = {
	[P in keyof TCli]: BuildOptionGroupOf<TCli[P]>;
};

type ExtBuildOpts<TCliExt extends CliOptions> = StdBuildOpts & {
	ext: BuildOptionsOf<TCliExt>;
};

type StdBuildFn = (make: Makefile, opts: StdBuildOpts) => void;
type ExtBuildFn<TBuildOpts> = (make: Makefile, opts: TBuildOpts) => void;

type ArgLookup = {
	extKey?: string;
	buildKey: string;
};

function addOptions(
	cmd: Command,
	opts: CliOptionGroup,
	cache: Map<string, ArgLookup>,
	extKey?: string,
): void {
	for (const key in opts) {
		const { arg, type } = opts[key];

		const lkup = cache.get(arg);
		if (lkup) {
			const other = `${lkup.extKey || ''}.${lkup.buildKey}`;
			const me = `${extKey || ''}.${key}`;
			throw new Error(
				`Found conflicting command line arguments '${arg}': Build options "${other}" and "${me}"`,
			);
		}

		switch (type) {
			case 'boolean':
				cmd.option(`--${arg}`);
				break;
			case 'string':
				cmd.option(`--${arg} <value>`);
				break;
			default:
				throw new Error(`Unknown type '${type}' for CLI arg '${arg}'`);
		}
		cache.set(arg, { extKey, buildKey: key });
	}
}

function options(cmd: Command): Option[] {
	return (cmd as unknown as { options: Option[] }).options;
}

function parseOpts(
	cmd: Command,
	args: Map<string, ArgLookup>,
	opts?: CliOptions,
): ExtBuildOpts<CliOptions> {
	const parsedOpts = cmd.opts();
	const out: Partial<ExtBuildOpts<CliOptions>> = {};

	if (opts) {
		out.ext = {};
	}

	for (const opt of options(cmd)) {
		const arg = opt.name();
		const parsedValue = parsedOpts[opt.attributeName()];

		type OptionHolder = Record<string, OptionValues>;

		const { extKey, buildKey } = args.get(arg);
		let optGroup: CliOptionGroup = stdOpts;
		let obj = out as OptionHolder;
		if (extKey) {
			optGroup = opts[extKey];
			const extHolder = out as Record<string, OptionHolder>;
			obj = extHolder[extKey] = extHolder[extKey] || {};
		}

		const cliOpt = optGroup[buildKey];

		switch (cliOpt.type) {
			case 'string':
				obj[buildKey] = parsedValue;
				break;
			case 'boolean':
				obj[buildKey] = !!parsedValue;
				break;
			default:
				throw new Error(
					`Unhandled cli option type '${(cliOpt as { type: unknown }).type}'`,
				);
		}
	}

	return out as ExtBuildOpts<CliOptions>;
}

export function cli(fn: StdBuildFn): void;
export function cli<T extends CliOptions>(
	fn: ExtBuildFn<ExtBuildOpts<T>>,
	opts: T,
): void;
export function cli(
	fn: StdBuildFn | ExtBuildFn<ExtBuildOpts<CliOptions>>,
	opts?: CliOptions,
): void {
	const program = new Command();
	const args = new Map<string, ArgLookup>();
	addOptions(program, stdOpts, args);

	if (opts) {
		for (const extKey in opts) {
			addOptions(program, opts[extKey], args);
		}
	}

	const makeMakefile = () => {
		const buildOpts = parseOpts(program, args, opts);
		const make = new Makefile({ srcRoot: buildOpts.sourceRoot });
		fn(make, buildOpts);
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
		.action(async () => {
			const make = makeMakefile();
			//const targetPath = target && Path.build(target);
			const display = new Vt100BuildInProgress(make);
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
