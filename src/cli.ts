import { Makefile, MakefileFn } from './Makefile.js';
import { Path, IBuildPath } from './Path.js';
import { Build } from './Build.js';
import { ArtifactStore, setArtifactStoreImpl } from './artifacts.js';
import { InMemoryArtifactStore } from './InMemoryArtifactStore.js';

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

	const makeMakefile = async (cmdOpts: OptionValues) => {
		const opts = { ...program.opts(), ...cmdOpts };
		const make = new Makefile({
			srcRoot: opts['srcdir'],
			buildRoot: opts['outdir'],
		});
		await Promise.resolve(fn(make));
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
			loggerProvider.setLogLevel(parseLogLevel(opts));
			loggerProvider.resume();

			let make: Makefile;
			try {
				make = await makeMakefile(opts);
			} catch (ex) {
				logger.fatal({
					body: 'Failed to create Makefile',
					exception: ex,
				});
				process.exit(1);
			}

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
			loggerProvider.setLogLevel(parseLogLevel(opts));
			loggerProvider.resume();

			let make: Makefile;
			try {
				make = await makeMakefile(opts);
			} catch (ex) {
				logger.fatal({
					body: 'Failed to create Makefile',
					exception: ex,
				});
				process.exit(1);
			}

			const goalPath = goal && Path.build(goal);

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
		.action(async function () {
			let make: Makefile;
			try {
				make = await makeMakefile(this.opts());
			} catch (ex) {
				// TODO - make this command work with logs
				loggerProvider.resume();
				logger.fatal({
					body: 'Failed to create Makefile',
					exception: ex,
				});
				process.exit(1);
			}

			for (const t of make.targets()) {
				console.log(t);
			}
		});

	program.parse();
}
