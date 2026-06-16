import {
	LogLevel,
	LoggerEventEmitter,
	ILoggerProvider,
	Logger,
	LogRecord,
	GetLoggerOpts,
	logLevelToStr,
} from './logs.js';
import { ArtifactStore } from './artifacts.js';
import chalk from 'chalk';
import { fmtElapsedTime } from './fmtElapsedTime.js';
import { Readable } from 'node:stream';
import {
	ATTR_EXCEPTION_MESSAGE,
	ATTR_EXCEPTION_STACKTRACE,
	ATTR_EXCEPTION_TYPE,
} from '@opentelemetry/semantic-conventions';
import {
	ATTR_ARTIFACT_ID,
	EVENT_RECIPE_CHILD_PROCESS_OUTPUT,
} from './names.js';
import { WeakLinkedList } from './WeakLinkedList.js';
import EventEmitter from 'node:events';

export class CliLoggerProvider implements ILoggerProvider {
	private tStart: number; // performance.now()
	private level: LogLevel = LogLevel.info;
	private evt: LoggerEventEmitter;
	private logger: Logger;
	private store: ArtifactStore;
	private paused: boolean = true;
	private q: LogRecord[] = [];
	private loggers = new WeakLinkedList<Logger>();

	constructor(tStart: number, store: ArtifactStore) {
		this.store = store;
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
		this.loggers.push(l);
		return l;
	}

	setLogLevel(level: LogLevel): LogLevel {
		for (const l of this.loggers) {
			l.setLogLevel(level);
		}
		return (this.level = level);
	}

	pause(): void {
		this.paused = true;
	}

	resume(): void {
		this.paused = false;
		this.processQ();
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

			this.pause();
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
					this.resume();
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
