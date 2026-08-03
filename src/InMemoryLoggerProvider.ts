import {
	ILoggerProvider,
	LoggerEventEmitter,
	GetLoggerOpts,
	LogLevel,
	LogRecord,
	Logger,
} from './logs.js';
import EventEmitter from 'node:events';

/**
 * A {@link ILoggerProvider} that accumulates log records in memory
 * @remarks Useful in tests to assert on emitted log records
 */
export class InMemoryLoggerProvider implements ILoggerProvider {
	private evt = new EventEmitter() as LoggerEventEmitter;

	/** All log records emitted so far */
	public logs: LogRecord[] = [];

	constructor() {
		this.evt.on('log', (l) => this._log(l));
	}

	getLogger(opts: GetLoggerOpts): Logger {
		return new Logger(this.evt, opts);
	}

	/**
	 * Remove all accumulated log records
	 */
	clear(): void {
		this.logs = [];
	}

	/**
	 * Find the first log record matching a level and message pattern
	 * @param level The severity to match
	 * @param pattern A string or `RegExp` to match against the log record's body
	 * @returns The matching log record, or `null` if none is found
	 */
	find(level: LogLevel, pattern: string | RegExp): LogRecord | null {
		const match = new RegExp(pattern);
		for (const l of this.logs) {
			if (l.level !== level) continue;
			if (match.test(l.body.toString())) return l;
		}
		return null;
	}

	/**
	 * Find all log records emitted for a given event name
	 * @param eventName The event name to match
	 * @returns All matching log records
	 */
	findEvents(eventName: string): LogRecord[] {
		const out: LogRecord[] = [];
		for (const l of this.logs) {
			if (l.eventName === eventName) {
				out.push(l);
			}
		}

		return out;
	}

	private _log(log: LogRecord) {
		this.logs.push(log);
	}
}
