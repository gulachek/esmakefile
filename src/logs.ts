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

/**
 * Options to obtain a {@link Logger}
 * @see {@link https://opentelemetry.io/docs/specs/otel/logs/api/#get-a-logger | OpenTelemetry's "Get a Logger"}
 */
export interface GetLoggerOpts {
	/** Name identifying the instrumentation scope, e.g. the module emitting logs */
	name: string;
	/** Version of the instrumentation scope */
	version?: string;
	/** Attributes describing the instrumentation scope */
	attributes?: Attributes;
	// TODO schemaUrl
}

/**
 * Options to emit a {@link LogRecord}
 * @see https://opentelemetry.io/docs/specs/otel/logs/api/#emit-a-logrecord
 */
export interface LoggerEmitOpts {
	/** Time the log record was emitted, defaulting to `performance.now()` */
	timeStamp?: number;
	/** Severity of the log record */
	level?: LogLevel;
	/** Display message of the log record */
	body: string;
	/** Context in which the log record was emitted, defaulting to the active context */
	context?: Context;
	/** Exception associated with the log record, recorded as attributes */
	exception?: Error;
	/** Attributes describing the log record */
	attributes?: Attributes;
	/** Name identifying the event, if this log record represents an event */
	eventName?: string;
	// TODO some others
}

/**
 * Options to check whether a {@link Logger} is enabled
 * @see https://opentelemetry.io/docs/specs/otel/logs/api/#enabled
 */
export interface LoggerEnabledOpts {
	/** Severity to check against the logger's configured level */
	level?: LogLevel;
	/** Context to check */
	context?: Context;
	/** Name identifying the event to check */
	eventName?: string;
}

export type LoggerEventTypeMap = {
	log: [LogRecord];
};

export type LoggerEventEmitter = EventEmitter<LoggerEventTypeMap>;

/**
 * Emits {@link LogRecord | LogRecords} for a given instrumentation scope
 * @remarks Obtain instances with {@link getLogger}
 */
export class Logger {
	private evt: LoggerEventEmitter;
	private scope: InstrumentationScope;
	private level: LogLevel;

	/**
	 * @internal
	 */
	constructor(evt: LoggerEventEmitter, opts: GetLoggerOpts) {
		this.evt = evt;
		this.scope = { name: opts.name };
		if (opts.version) this.scope.version = opts.version;
		if (opts.attributes) this.scope.attributes = opts.attributes;
		this.level = LogLevel.info;
	}

	/**
	 * Set the minimum level of log records this logger will emit
	 * @param level The minimum level
	 */
	setLogLevel(level: LogLevel): void {
		this.level = level;
	}

	/**
	 * Check whether this logger would emit a log record given the options
	 * @param opts Options describing the log record to check
	 * @returns `true` if the logger is enabled for the given options
	 */
	enabled(opts: LoggerEnabledOpts): boolean {
		const { level } = opts;
		if (level && level < this.level) return false;
		return true;
	}

	/**
	 * Emit a log record
	 * @param opts Options describing the log record
	 */
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

	private _emitWithLevel(level: LogLevel, opts: string | LoggerEmitOpts): void {
		if (typeof opts === 'string') {
			this.emit({ level, body: opts });
		} else {
			this.emit({ ...opts, level });
		}
	}

	/**
	 * Emit a {@link LogLevel.trace} log record
	 * @param msg The display message of the log record
	 */
	trace(msg: string): void;
	/**
	 * Emit a {@link LogLevel.trace} log record
	 * @param opts Options describing the log record
	 */
	trace(opts: LoggerEmitOpts): void;
	trace(opts: string | LoggerEmitOpts): void {
		this._emitWithLevel(LogLevel.trace, opts);
	}

	/**
	 * Emit a {@link LogLevel.debug} log record
	 * @param msg The display message of the log record
	 */
	debug(msg: string): void;
	/**
	 * Emit a {@link LogLevel.debug} log record
	 * @param opts Options describing the log record
	 */
	debug(opts: LoggerEmitOpts): void;
	debug(opts: string | LoggerEmitOpts): void {
		this._emitWithLevel(LogLevel.debug, opts);
	}

	/**
	 * Emit a {@link LogLevel.info} log record
	 * @param msg The display message of the log record
	 */
	info(msg: string): void;
	/**
	 * Emit a {@link LogLevel.info} log record
	 * @param opts Options describing the log record
	 */
	info(opts: LoggerEmitOpts): void;
	info(opts: string | LoggerEmitOpts): void {
		this._emitWithLevel(LogLevel.info, opts);
	}

	/**
	 * Emit a {@link LogLevel.warn} log record
	 * @param msg The display message of the log record
	 */
	warn(msg: string): void;
	/**
	 * Emit a {@link LogLevel.warn} log record
	 * @param opts Options describing the log record
	 */
	warn(opts: LoggerEmitOpts): void;
	warn(opts: string | LoggerEmitOpts): void {
		this._emitWithLevel(LogLevel.warn, opts);
	}

	/**
	 * Emit a {@link LogLevel.error} log record
	 * @param msg The display message of the log record
	 */
	error(msg: string): void;
	/**
	 * Emit a {@link LogLevel.error} log record
	 * @param opts Options describing the log record
	 */
	error(opts: LoggerEmitOpts): void;
	error(opts: string | LoggerEmitOpts): void {
		this._emitWithLevel(LogLevel.error, opts);
	}

	/**
	 * Emit a {@link LogLevel.fatal} log record
	 * @param msg The display message of the log record
	 */
	fatal(msg: string): void;
	/**
	 * Emit a {@link LogLevel.fatal} log record
	 * @param opts Options describing the log record
	 */
	fatal(opts: LoggerEmitOpts): void;
	fatal(opts: string | LoggerEmitOpts): void {
		this._emitWithLevel(LogLevel.fatal, opts);
	}
}

/**
 * Provides {@link Logger} instances
 * @remarks Configure a custom implementation with {@link setLoggerProvider}
 */
export interface ILoggerProvider {
	/**
	 * Obtain a {@link Logger}
	 * @param opts Options describing the logger's instrumentation scope
	 */
	getLogger(opts: GetLoggerOpts): Logger;
}

class NoopLoggerProvider implements ILoggerProvider {
	private evt = new EventEmitter() as LoggerEventEmitter;
	getLogger(opts: GetLoggerOpts): Logger {
		return new Logger(this.evt, opts);
	}
}

let loggerProvider: ILoggerProvider = new NoopLoggerProvider();

/**
 * Configure an {@link ILoggerProvider} implementation for the process
 * @param provider The implementation
 * @returns The given `provider`
 * @remarks This will cause all callers of {@link getLogger} to use the given implementation
 */
export function setLoggerProvider<T extends ILoggerProvider>(provider: T): T {
	return (loggerProvider = provider);
}

/**
 * Obtain a {@link Logger} from the configured {@link ILoggerProvider}
 * @param opts Options describing the logger's instrumentation scope
 * @returns A {@link Logger}
 */
export function getLogger(opts: GetLoggerOpts): Logger {
	return loggerProvider.getLogger(opts);
}

/**
 * Log level (a.k.a. severity)
 */
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

/**
 * Identifies the module/library that emits log records
 * @see {@link https://opentelemetry.io/docs/concepts/instrumentation-scope/ | Instrumentation Scope}
 */
export type InstrumentationScope = {
	/** Name of the instrumentation scope */
	name: string;
	/** Version of the instrumentation scope */
	version?: string;
	/** Attributes describing the instrumentation scope */
	attributes?: Attributes;
};

/**
 * A single log record emitted by a {@link Logger}
 */
export type LogRecord = {
	/** Severity of the log record */
	level: LogLevel;
	/** Time the log record was emitted, from `performance.now()` */
	timeStamp: number;
	/** Display message of the log record */
	body: string;
	/** Context in which the log record was emitted */
	context: Context;
	/** Instrumentation scope of the {@link Logger} that emitted the log record */
	instrumentationScope: InstrumentationScope;
	/** Attributes describing the log record */
	attributes?: Attributes;
	/** Name identifying the event, if this log record represents an event */
	eventName?: string;
};
