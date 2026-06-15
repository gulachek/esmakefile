import { Makefile } from './Makefile.js';
import { Path, IBuildPath } from './Path.js';
import { Build } from './Build.js';
import { ArtifactStore, setArtifactStoreImpl } from './artifacts.js';
import { InMemoryArtifactStore } from './InMemoryArtifactStore.js';

import { Command, OptionValues } from 'commander';
import chalk from 'chalk';
import {
	LogLevel,
	logLevelToStr,
	LogRecord,
	Logger,
	ILoggerProvider,
	LoggerEventEmitter,
	GetLoggerOpts,
	setLoggerProvider,
} from './logs.js';
import { fmtElapsedTime } from './fmtElapsedTime.js';
import { SourceWatcher } from './SourceWatcher.js';
import EventEmitter from 'node:events';
import { Readable } from 'node:stream';
import {
	ATTR_EXCEPTION_MESSAGE,
	ATTR_EXCEPTION_STACKTRACE,
	ATTR_EXCEPTION_TYPE,
	ATTR_SERVICE_NAME,
	ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import {
	ATTR_ARTIFACT_ID,
	EVENT_RECIPE_CHILD_PROCESS_OUTPUT,
} from './names.js';

const sdk = new NodeSDK({
	resource: resourceFromAttributes({
		[ATTR_SERVICE_NAME]: 'esmakefile',
		[ATTR_SERVICE_VERSION]: '0.6.3', // TODO: make this more automatic
	}),
});
sdk.start();

export interface ICliFnOpts {
	isDevelopment: boolean;
}

export type CliFn = (make: Makefile, opts: ICliFnOpts) => void;

export function cli(fn: CliFn): void {
	const artifactImpl = new InMemoryArtifactStore();
	setArtifactStoreImpl(artifactImpl);
	const store = new ArtifactStore(artifactImpl);

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

	program.option('--trace', 'Sets the log level to "trace"', false);
	program.option('-v, --debug', 'Sets the log level to "debug"', false);

	const makeMakefile = (cmdOpts: OptionValues) => {
		const opts = { ...program.opts(), ...cmdOpts };
		const make = new Makefile({
			srcRoot: opts['srcdir'],
			buildRoot: opts['outdir'],
		});
		fn(make, { isDevelopment: !!opts['development'] });
		return make;
	};

	const parseLogLevel = (cmdOpts: OptionValues): LogLevel => {
		const opts = { ...program.opts(), ...cmdOpts };

		const i = LogLevel.info;
		if (!opts) return i;
		if (typeof opts !== 'object') return i;
		if (opts['trace']) return LogLevel.trace;
		if (opts['debug']) return LogLevel.debug;
		return i;
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
			setLoggerProvider(
				new CliLoggerProvider(performance.now(), parseLogLevel(opts), store),
			);
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
			const loggerProvider = new CliLoggerProvider(
				performance.now(),
				parseLogLevel(opts),
				store,
			);
			setLoggerProvider(loggerProvider);
			const make = makeMakefile(opts);
			const goalPath = goal && Path.build(goal);

			const logger = loggerProvider.getLogger({ name: 'esmakefile.cli.watch' });

			const watcher = new SourceWatcher(make.srcRoot, {
				debounceMs: 300,
				excludeDir: make.buildRoot,
			});

			watcher.on('change', () => {
				loggerProvider.resetClock();
				logger.info('Detected change. Restarting update.');
				runBuild(make, goalPath);
			});

			watcher.on('unknown', (type: string) => {
				logger.warn(`Unhandled ${SourceWatcher.name} event type '${type}'`);
			});

			const closeWatcher = () => watcher.close();
			const drainStdin = () => process.stdin.read();
			process.stdin.on('close', closeWatcher);
			process.stdin.on('data', drainStdin);

			logger.info(`Watching '${make.srcRoot}'`);
			logger.info('Close input stream to stop (usually Ctrl+D)');
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

function fmtLogLevel(level: LogLevel): string {
	// This will throw if level is invalid. Not throwing means
	// range is valid
	const s = logLevelToStr(level).padEnd(6);

	if (level < LogLevel.debug)
		// trace
		return chalk.bold.magenta(s);
	else if (level < LogLevel.info)
		// debug
		return chalk.bold.cyan(s);
	else if (level < LogLevel.warn)
		// info
		return chalk.bold.white(s);
	else if (level < LogLevel.error)
		// warn
		return chalk.bold.yellow(s);
	else if (level < LogLevel.fatal)
		// error
		return chalk.bold.red(s);
	// fatal
	else return chalk.bold.bgRed.white(s);
}

class CliLoggerProvider implements ILoggerProvider {
	private tStart: number; // performance.now()
	private level: LogLevel = LogLevel.info;
	private evt: LoggerEventEmitter;
	private logger: Logger;
	private store: ArtifactStore;
	private paused: boolean = false;
	private q: LogRecord[] = [];

	constructor(tStart: number, level: LogLevel, store: ArtifactStore) {
		this.store = store;
		this.level = level;
		this.evt = new EventEmitter() as LoggerEventEmitter;
		this.evt.on('log', (r) => this.log(r));
		this.logger = this.getLogger({ name: 'esmakefile.CliLoggerProvider' });
		this.resetClock(tStart);
	}

	resetClock(tStart?: number): void {
		this.tStart = tStart || performance.now();
		const dStart = new Date(performance.timeOrigin + this.tStart);
		this.logger.debug(
			`Set ${CliLoggerProvider.name} clock to ${dStart.toISOString()}`,
		);
	}

	getLogger(opts: GetLoggerOpts): Logger {
		const l = new Logger(this.evt, opts);
		l.setLogLevel(this.level);
		return l;
	}

	private log(l: LogRecord): void {
		if (l.level < this.level) return;
		if (this.paused) {
			this.q.push(l);
		} else {
			this.printLog(l);
		}
	}

	private printLog(l: LogRecord): void {
		const { timeStamp, body, level, eventName, attributes } = l;

		const tStr =
			'[' + chalk.cyan(fmtElapsedTime(timeStamp - this.tStart)) + ']';
		const levelStr = fmtLogLevel(level);
		console.log(`${tStr} ${levelStr}`, trimConsoleMsg(body));

		// also log exception if it's in an attribute
		const ex = parseAttrException(l);
		if (ex) {
			const { stack, type, message } = ex;
			if (stack) {
				console.log(stack);
			} else {
				console.log(`${type}: ${message}`);
			}
		}

		if (eventName === EVENT_RECIPE_CHILD_PROCESS_OUTPUT) {
			const artifactId = attributes && attributes[ATTR_ARTIFACT_ID];
			if (typeof artifactId !== 'string') return;

			this.paused = true;
			this.store
				.getStream(artifactId)
				.then((artifact) => {
					if (!artifact) {
						this.logger.error(
							`Failed to get stream for artifact '${artifactId}'`,
						);
						return;
					}
					return new Promise<void>((resolve, reject) => {
						const readable = Readable.fromWeb(artifact.content);
						readable.pipe(process.stdout, { end: false });
						readable.on('end', resolve);
						readable.on('error', reject);
					});
				})
				.catch((e) => {
					this.logger.error({
						body: `Failed to get artifact ${artifactId}`,
						exception: e,
					});
				})
				.finally(() => {
					this.paused = false;
					this.processQ();
				});
		}
	}

	private processQ(): void {
		while (this.q.length > 0) {
			const l = this.q.shift();
			this.printLog(l);
		}
	}
}

function trimConsoleMsg(msg: string): string {
	return msg.trim().replaceAll(/\s+/g, ' ');
}

type AttrException = {
	type: string;
	message: string;
	stack?: string;
};

function parseAttrException(r: LogRecord): AttrException | null {
	const a = r.attributes;
	if (!a) return null;

	let type: string;
	if (typeof a[ATTR_EXCEPTION_TYPE] === 'string') type = a[ATTR_EXCEPTION_TYPE];

	let message: string;
	if (typeof a[ATTR_EXCEPTION_MESSAGE] === 'string')
		message = a[ATTR_EXCEPTION_MESSAGE];

	let stack: string;
	if (typeof a[ATTR_EXCEPTION_STACKTRACE] === 'string')
		stack = a[ATTR_EXCEPTION_STACKTRACE];

	if (!(type && message)) {
		return null;
	}

	return { type, message, stack };
}
