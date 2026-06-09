// Inspired by otel log data model
// https://opentelemetry.io/docs/specs/otel/logs/data-model/
// https://opentelemetry.io/docs/specs/otel/logs/api/
import { EventEmitter } from 'node:events';
import { Context, context, Attributes } from '@opentelemetry/api';
import {
	ATTR_EXCEPTION_TYPE,
	ATTR_EXCEPTION_MESSAGE,
	ATTR_EXCEPTION_STACKTRACE,
} from '@opentelemetry/semantic-conventions';

// https://opentelemetry.io/docs/specs/otel/logs/api/#get-a-logger
export interface GetLoggerOpts {
	name: string;
	version?: string;
	attributes?: Attributes;
	// TODO schemaUrl
}

// https://opentelemetry.io/docs/specs/otel/logs/api/#emit-a-logrecord
export interface LoggerEmitOpts {
	timeStamp?: number;
	level?: LogLevel; // Severity Number
	body: string;
	context?: Context;
	exception?: Error;
	attributes?: Attributes;
	eventName?: string;
	// TODO some others
}

export type LoggerEventTypeMap = {
	log: [LogRecord];
};

export type LoggerEventEmitter = EventEmitter<LoggerEventTypeMap>;

export class Logger {
	private evt: LoggerEventEmitter;
	private scope: InstrumentationScope;

	/**
	 * @internal
	 */
	constructor(evt: LoggerEventEmitter, opts: GetLoggerOpts) {
		this.evt = evt;
		this.scope = { name: opts.name };
		if (opts.version) this.scope.version = opts.version;
		if (opts.attributes) this.scope.attributes = opts.attributes;
	}

	emit(opts: LoggerEmitOpts): void {
		const record: LogRecord = {
			timeStamp: opts.timeStamp || performance.now(),
			body: opts.body,
			level: opts.level || LogLevel.info,
			context: opts.context || context.active(),
			instrumentationScope: this.scope,
		};

		if (opts.attributes) record.attributes = opts.attributes;
		if (opts.eventName) record.eventName = opts.eventName;

		const ex = opts.exception;
		if (ex) {
			if (!record.attributes) record.attributes = {};
			const attrs = record.attributes;
			attrs[ATTR_EXCEPTION_TYPE] = ex.name;
			attrs[ATTR_EXCEPTION_MESSAGE] = ex.message;
			if (ex.stack) attrs[ATTR_EXCEPTION_STACKTRACE] = ex.stack;
		}

		this.evt.emit('log', record);
	}

	_emitWithLevel(level: LogLevel, opts: string | LoggerEmitOpts): void {
		if (typeof opts === 'string') {
			this.emit({ level, body: opts });
		} else {
			this.emit({ ...opts, level });
		}
	}

	trace(msg: string): void;
	trace(opts: LoggerEmitOpts): void;
	trace(opts: string | LoggerEmitOpts): void {
		this._emitWithLevel(LogLevel.trace, opts);
	}

	debug(msg: string): void;
	debug(opts: LoggerEmitOpts): void;
	debug(opts: string | LoggerEmitOpts): void {
		this._emitWithLevel(LogLevel.debug, opts);
	}

	info(msg: string): void;
	info(opts: LoggerEmitOpts): void;
	info(opts: string | LoggerEmitOpts): void {
		this._emitWithLevel(LogLevel.info, opts);
	}

	warn(msg: string): void;
	warn(opts: LoggerEmitOpts): void;
	warn(opts: string | LoggerEmitOpts): void {
		this._emitWithLevel(LogLevel.warn, opts);
	}

	error(msg: string): void;
	error(opts: LoggerEmitOpts): void;
	error(opts: string | LoggerEmitOpts): void {
		this._emitWithLevel(LogLevel.error, opts);
	}

	fatal(msg: string): void;
	fatal(opts: LoggerEmitOpts): void;
	fatal(opts: string | LoggerEmitOpts): void {
		this._emitWithLevel(LogLevel.fatal, opts);
	}
}

export interface ILoggerProvider {
	getLogger(opts: GetLoggerOpts): Logger;
}

class NoopLoggerProvider implements ILoggerProvider {
	private evt = new EventEmitter() as LoggerEventEmitter;
	getLogger(opts: GetLoggerOpts): Logger {
		return new Logger(this.evt, opts);
	}
}

let loggerProvider: ILoggerProvider = new NoopLoggerProvider();

export function setLoggerProvider(provider: ILoggerProvider): ILoggerProvider {
	return (loggerProvider = provider);
}

export function getLogger(opts: GetLoggerOpts): Logger {
	return loggerProvider.getLogger(opts);
}

export enum LogLevel {
	trace = 1,
	debug = 5,
	info = 9,
	warn = 13,
	error = 17,
	fatal = 21,
}

export function isLogLevel(level: LogLevel | number): level is LogLevel {
	return level >= LogLevel.trace && level <= 24 && level === Math.round(level);
}

// https://opentelemetry.io/docs/specs/otel/logs/data-model/#field-severitynumber
export function logLevelToStr(level: LogLevel | number) {
	if (!isLogLevel(level)) {
		throw new Error(`Invalid LogLevel '${level}'`);
	}

	return [
		'TRACE',
		'TRACE1',
		'TRACE2',
		'TRACE3',
		'DEBUG',
		'DEBUG1',
		'DEBUG2',
		'DEBUG3',
		'INFO',
		'INFO1',
		'INFO2',
		'INFO3',
		'WARN',
		'WARN1',
		'WARN2',
		'WARN3',
		'ERROR',
		'ERROR1',
		'ERROR2',
		'ERROR3',
		'FATAL',
		'FATAL1',
		'FATAL2',
		'FATAL3',
	][level - 1];
}

export type InstrumentationScope = {
	name: string;
	version?: string;
	attributes?: Attributes;
};

export type LogRecord = {
	level: LogLevel;
	timeStamp: number; // performance.now()
	body: string;
	context: Context;
	instrumentationScope: InstrumentationScope;
	attributes?: Attributes;
	eventName?: string;
};
