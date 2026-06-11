import {
	ILoggerProvider,
	LoggerEventEmitter,
	GetLoggerOpts,
	LogLevel,
	LogRecord,
	Logger,
} from './logs.js';
import EventEmitter from 'node:events';

export class InMemoryLoggerProvider implements ILoggerProvider {
	private evt = new EventEmitter() as LoggerEventEmitter;

	public logs: LogRecord[] = [];

	constructor() {
		this.evt.on('log', (l) => this._log(l));
	}

	getLogger(opts: GetLoggerOpts): Logger {
		return new Logger(this.evt, opts);
	}

	clear(): void {
		this.logs = [];
	}

	find(level: LogLevel, pattern: string | RegExp): LogRecord | null {
		const match = new RegExp(pattern);
		for (const l of this.logs) {
			if (l.level !== level) continue;
			if (match.test(l.body.toString())) return l;
		}
		return null;
	}

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
