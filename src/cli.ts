import { Command } from 'commander';
import { Cookbook } from './Cookbook';

interface ICliOptionTypeMap {
	boolean: boolean;
	string: string;
}

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

type CliOptionDescriptionOf<T extends CliOptionValueType> = T extends any
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

type StdBuildFn = (book: Cookbook, opts: StdBuildOpts) => void;
type ExtBuildFn<TBuildOpts> = (book: Cookbook, opts: TBuildOpts) => void;

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
		const { arg } = opts[key];

		const lkup = cache.get(arg);
		if (lkup) {
			const other = `${lkup.extKey || ''}.${lkup.buildKey}`;
			const me = `${extKey || ''}.${key}`;
			throw new Error(
				`Found conflicting command line arguments '${arg}': Build options "${other}" and "${me}"`,
			);
		}

		cmd.option(`--${arg}`);
		cache.set(arg, { extKey, buildKey: key });
	}
}

function parseOpts(
	cmd: Command,
	args: Map<string, ArgLookup>,
	opts?: CliOptions,
): ExtBuildOpts<CliOptions> {
	const parsedOpts = cmd.opts();
	const out: any = {};
	if (opts) {
		out.ext = {};
	}

	for (const opt of (cmd as any).options) {
		const arg = opt.name();
		const parsedValue = parsedOpts[opt.attributeName()];

		const { extKey, buildKey } = args.get(arg);
		let optGroup: CliOptionGroup = stdOpts;
		let obj = out;
		if (extKey) {
			optGroup = opts[extKey];
			obj = out[extKey] = out[extKey] || {};
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
				throw new Error(`Unhandled cli option type '${(cliOpt as any).type}'`);
		}
	}

	return out as ExtBuildOpts<CliOptions>;
}

export function cli(fn: StdBuildFn): void;
export function cli<T extends CliOptions>(
	fn: ExtBuildFn<ExtBuildOpts<T>>,
	opts: T,
): void;
export function cli(fn: Function, opts?: CliOptions): void {
	const program = new Command();
	const args = new Map<string, ArgLookup>();
	addOptions(program, stdOpts, args);

	if (opts) {
		for (const extKey in opts) {
			addOptions(program, opts[extKey], args);
		}
	}

	const makeCookbook = () => {
		const buildOpts = parseOpts(program, args, opts);

		const book = new Cookbook();
		fn(book, buildOpts);
		return book;
	};

	program
		.command('build', { isDefault: true })
		.description('Build a specified target')
		.argument('target', 'The target to be built')
		.action((target: string) => {
			const book = makeCookbook();
			book.build(target);
		});

	program
		.command('list')
		.description('List all targets')
		.action(() => {
			const book = makeCookbook();
			for (const t of book.targets()) {
				console.log(t);
			}
		});

	program.parse();
}
