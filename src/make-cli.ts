#!/usr/bin/env node
import { MakefileFn } from './Makefile.js';
import { ArtifactStore, setArtifactStoreImpl } from './artifacts.js';
import { InMemoryArtifactStore } from './InMemoryArtifactStore.js';
import { MakeProgram } from './MakeProgram.js';

import { Command } from 'commander';
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

program.option(
	'-C, --directory <dir>',
	'Change to directory prior to configuring build system or updating targets',
);

program.option('--trace', 'Sets the log level to "trace"', false);
program.option('-v, --debug', 'Sets the log level to "debug"', false);

const makeProgram = async () => {
	let mod: IMakefileModule | null;
	try {
		mod = await loadMakefileModule(logger);
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

	return new MakeProgram(mod.main, { path: mod.path });
};

const parseLogLevel = (): LogLevel => {
	const opts = program.opts();

	const i = LogLevel.info;
	if (!opts) return i;
	if (typeof opts !== 'object') return i;
	if (opts['trace']) return LogLevel.trace;
	if (opts['debug']) return LogLevel.debug;
	return i;
};

const processGlobalOpts = async (opts: { suppressLogs?: boolean }) => {
	const programOpts = program.opts();
	loggerProvider.setLogLevel(parseLogLevel());
	if (!opts.suppressLogs) loggerProvider.resume();

	const d = programOpts['directory'] as string | undefined;
	if (d) {
		logger.debug(`Changing directory to '${d}'`);
		process.chdir(d);
	}

	const make = await makeProgram();

	if (!make) {
		loggerProvider.resume(); // log even if suppressed
		logger.fatal({
			body: 'Failed to create Makefile',
		});
		process.exit(1);
	}

	return {
		make,
	};
};

program
	.command('build', { isDefault: true })
	.description('Build a specified target')
	.argument('[goal]', 'The goal target to be built')
	.action(async function (goal?: string) {
		const { make } = await processGlobalOpts({});

		const result = await make.update(goal);

		process.exit(result ? 0 : 1);
	});

program
	.command('watch')
	.description('Rebuild top level targets when a source file changes')
	.argument('[goal]', 'The goal target to be built')
	.action(async function (goal?: string) {
		const { make } = await processGlobalOpts({});

		const watcher = new SourceWatcher('.', {
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

		logger.info(`Watching '${resolve('.')}'`);
		logger.info('Close input stream to stop (usually Ctrl+D)');
		make.update(goal);
	});

program
	.command('list')
	.description('List all targets')
	.action(async function () {
		const { make } = await processGlobalOpts({ suppressLogs: true });

		const targets = await make.targets();
		for (const t of targets) {
			console.log(t);
		}
	});

program.parseAsync();

interface IMakefileModule {
	main: MakefileFn;
	path: string;
}

async function loadMakefileModule(
	logger: Logger,
): Promise<IMakefileModule | null> {
	const trace = logger.enabled({ level: LogLevel.trace });
	const debug = logger.enabled({ level: LogLevel.debug });
	if (trace) {
		logger.trace(`Scanning '${resolve('.')}' for Makefile`);
	}
	const basenames = ['esmakefile', 'makefile', 'Makefile'];
	const exts = ['.mjs', '.cjs', '.js'];

	for (const b of basenames) {
		for (const e of exts) {
			const f = b + e;
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
				return { main: mod.default as MakefileFn, path: f };
			}

			if ('main' in mod && typeof mod.main === 'function') {
				if (debug) {
					logger.debug(
						`Module has export of function type named 'main'. Considering successful load.`,
					);
				}
				return { main: mod.main as MakefileFn, path: f };
			}
		}
	}

	logger.error('Did not successfully load any candidates as Makefile');
	return null;
}
