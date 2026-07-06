#!/usr/bin/env node
import { MakefileFn } from './Makefile.js';
import { ArtifactStore, setArtifactStoreImpl } from './artifacts.js';
import { InMemoryArtifactStore } from './InMemoryArtifactStore.js';
import { MakeProgram } from './MakeProgram.js';

import { Command, OptionValues } from 'commander';
import { LogLevel, setLoggerProvider, Logger } from './logs.js';
import { SourceWatcher } from './SourceWatcher.js';
import {
	ATTR_SERVICE_NAME,
	ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { CliLoggerProvider } from './CliLoggerProvider.js';
import { resolve } from 'node:path';
import { Stats, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const artifactImpl = new InMemoryArtifactStore();
setArtifactStoreImpl(artifactImpl);
const store = new ArtifactStore(artifactImpl);

const loggerProvider = setLoggerProvider(
	new CliLoggerProvider(performance.now(), store),
);

const sdk = new NodeSDK({
	resource: resourceFromAttributes({
		[ATTR_SERVICE_NAME]: 'esmakefile',
		[ATTR_SERVICE_VERSION]: '0.6.3', // TODO: make this more automatic
	}),
});
sdk.start();

const program = new Command();
const logger = loggerProvider.getLogger({ name: 'esmakefile.cli' });

const devDesc = 'Specifies this is a development build';
program.option('--development', devDesc, false);

program.option(
	'-C, --directory <dir>',
	"Root directory of the build system (default is '.')",
);

program.option('--trace', 'Sets the log level to "trace"', false);
program.option('-v, --debug', 'Sets the log level to "debug"', false);

const makeProgram = async (cmdOpts: OptionValues) => {
	const opts = { ...program.opts(), ...cmdOpts };

	let mod: IMakefileModule | null;
	try {
		mod = await loadMakefileModule(opts['directory'] || '.', logger);
	} catch (exception) {
		logger.fatal({
			body: 'Scan for Makefile threw an exception',
			exception,
		});
		process.exit(1);
	}

	if (!mod) {
		logger.fatal('Failed to load a Makefile module');
		process.exit(1);
	}

	return MakeProgram.parse(mod.main, {
		rootDir: opts['directory'],
	});
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

program
	.command('build', { isDefault: true })
	.description('Build a specified target')
	.argument('[goal]', 'The goal target to be built')
	.action(async function (goal?: string) {
		const opts = this.opts();
		loggerProvider.setLogLevel(parseLogLevel(opts));
		loggerProvider.resume();

		const make = await makeProgram(opts);

		if (!make) {
			logger.fatal({
				body: 'Failed to create Makefile',
			});
			process.exit(1);
		}

		const result = await make.update(goal);

		process.exit(result ? 0 : 1);
	});

program
	.command('watch')
	.description('Rebuild top level targets when a source file changes')
	.argument('[goal]', 'The goal target to be built')
	.option('--development', devDesc, true)
	.action(async function (goal?: string) {
		const opts = this.opts();
		loggerProvider.setLogLevel(parseLogLevel(opts));
		loggerProvider.resume();

		const make = await makeProgram(opts);

		if (!make) {
			logger.fatal({
				body: 'Failed to create Makefile',
			});
			process.exit(1);
		}

		const watcher = new SourceWatcher(make.rootDir, {
			debounceMs: 300,
			// TODO - have a way to ignore a directory while watching
			excludeDir: '__TODO__',
		});

		watcher.on('change', () => {
			loggerProvider.resetClock();
			logger.info('Detected change. Restarting update.');
			make.update(goal);
		});

		watcher.on('unknown', (type: string) => {
			logger.warn(`Unhandled ${SourceWatcher.name} event type '${type}'`);
		});

		const closeWatcher = () => watcher.close();
		const drainStdin = () => process.stdin.read();
		process.stdin.on('close', closeWatcher);
		process.stdin.on('data', drainStdin);

		logger.info(`Watching '${make.rootDir}'`);
		logger.info('Close input stream to stop (usually Ctrl+D)');
		make.update(goal);
	});

program
	.command('list')
	.description('List all targets')
	.action(async function () {
		const make = await makeProgram(this.opts());
		if (!make) {
			// TODO - make this command work with logs
			loggerProvider.resume();
			logger.fatal({
				body: 'Failed to create Makefile',
			});
			process.exit(1);
		}

		for (const t of make.targets()) {
			console.log(t);
		}
	});

program.parseAsync();

interface IMakefileModule {
	main: MakefileFn;
}

async function loadMakefileModule(
	rootDir: string,
	logger: Logger,
): Promise<IMakefileModule | null> {
	const trace = logger.enabled({ level: LogLevel.trace });
	const debug = logger.enabled({ level: LogLevel.debug });
	if (trace) {
		logger.trace(`Scanning directory '${rootDir}' for Makefile`);
	}
	const basenames = ['esmakefile', 'makefile', 'Makefile'];
	const exts = ['.mjs', '.cjs', '.js'];

	for (const b of basenames) {
		for (const e of exts) {
			const f = resolve(rootDir, b + e);
			if (trace) {
				logger.trace(`Trying '${f}' as Makefile`);
			}

			let st: Stats;
			try {
				st = statSync(f, { throwIfNoEntry: false });
			} catch (ex) {
				logger.warn({
					body: `Failed to statSync('${f}')`,
					exception: ex,
				});
			}

			if (!st) {
				if (trace) {
					logger.trace(`Dismissing '${f}' because statSync() failed`);
				}
				continue;
			}

			const url = pathToFileURL(f).href;
			if (debug) {
				logger.debug(`Attempting import('${url}')`);
			}

			let mod: unknown;
			try {
				mod = await import(url);
			} catch (exception) {
				logger.error({
					body: `Failed to import('${url}')`,
					exception,
				});
			}

			if (!mod) {
				if (trace) {
					logger.trace(`Dismissing '${f}' because import() failed`);
				}
				continue;
			}

			if (debug) {
				logger.debug(`import('${url}') succeeded`);
			}

			if (typeof mod !== 'object') {
				logger.error('Result of import() is not of type object');
				continue;
			}

			if ('default' in mod && typeof mod.default === 'function') {
				if (debug) {
					logger.debug(
						`Module has default export of function type named '${mod.default.name}'. Considering successful load.`,
					);
				}
				return { main: mod.default as MakefileFn };
			}

			if ('main' in mod && typeof mod.main === 'function') {
				if (debug) {
					logger.debug(
						`Module has export of function type named 'main'. Considering successful load.`,
					);
				}
				return { main: mod.main as MakefileFn };
			}
		}
	}

	logger.error('Did not successfully load any candidates as Makefile');
	return null;
}
