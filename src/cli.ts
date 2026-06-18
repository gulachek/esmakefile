import { MakefileFn } from './Makefile.js';
import { Path } from './Path.js';
import { ArtifactStore, setArtifactStoreImpl } from './artifacts.js';
import { InMemoryArtifactStore } from './InMemoryArtifactStore.js';
import { MakeProgram } from './MakeProgram.js';

import { Command, OptionValues } from 'commander';
import { LogLevel, setLoggerProvider } from './logs.js';
import { SourceWatcher } from './SourceWatcher.js';
import {
	ATTR_SERVICE_NAME,
	ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { CliLoggerProvider } from './CliLoggerProvider.js';

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

export function cli(fn: MakefileFn): void {
	const program = new Command();
	const logger = loggerProvider.getLogger({ name: 'esmakefile.cli' });

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

	const makeProgram = async (cmdOpts: OptionValues) => {
		const opts = { ...program.opts(), ...cmdOpts };
		return MakeProgram.parse(fn, {
			srcRoot: opts['srcdir'],
			buildRoot: opts['outdir'],
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

			let prg: MakeProgram;
			try {
				prg = await makeProgram(opts);
			} catch (ex) {
				logger.fatal({
					body: 'Failed to create Makefile',
					exception: ex,
				});
				process.exit(1);
			}

			const goalPath = goal && Path.build(goal);
			const result = await prg.update(goalPath);

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

			let prg: MakeProgram;
			try {
				prg = await makeProgram(opts);
			} catch (ex) {
				logger.fatal({
					body: 'Failed to create Makefile',
					exception: ex,
				});
				process.exit(1);
			}

			const goalPath = goal && Path.build(goal);

			const watcher = new SourceWatcher(prg.srcRoot, {
				debounceMs: 300,
				excludeDir: prg.buildRoot,
			});

			watcher.on('change', () => {
				loggerProvider.resetClock();
				logger.info('Detected change. Restarting update.');
				prg.update(goalPath);
			});

			watcher.on('unknown', (type: string) => {
				logger.warn(`Unhandled ${SourceWatcher.name} event type '${type}'`);
			});

			const closeWatcher = () => watcher.close();
			const drainStdin = () => process.stdin.read();
			process.stdin.on('close', closeWatcher);
			process.stdin.on('data', drainStdin);

			logger.info(`Watching '${prg.srcRoot}'`);
			logger.info('Close input stream to stop (usually Ctrl+D)');
			prg.update(goalPath);
		});

	program
		.command('list')
		.description('List all targets')
		.action(async function () {
			let prg: MakeProgram;
			try {
				prg = await makeProgram(this.opts());
			} catch (ex) {
				// TODO - make this command work with logs
				loggerProvider.resume();
				logger.fatal({
					body: 'Failed to create Makefile',
					exception: ex,
				});
				process.exit(1);
			}

			for (const t of prg.targets()) {
				console.log(t);
			}
		});

	program.parse();
}
