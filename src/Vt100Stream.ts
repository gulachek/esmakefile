import { Writable } from 'node:stream';
import { EventEmitter } from 'node:events';

const MAX_LEN = 1000000;

export class Vt100Stream extends Writable {
	private _events = new EventEmitter();
	private _chunks: Buffer[] = [];
	private _len: number = 0;

	constructor() {
		super();
	}

	override _writev(chunks: Chunk[], callback: ErrorCallback) {
		for (const { chunk } of chunks) {
			if (chunk.length + this._len > MAX_LEN) {
				callback(new Error('Writing chunk would exceed maximum buffer length'));
				return;
			}

			this._chunks.push(chunk);
			this._len += chunk.length;
			this._emit('data', chunk);
		}

		callback(null);
	}

	contents() {
		return Buffer.concat(this._chunks);
	}

	vtOn<E extends Vt100StreamEvent>(e: E, l: Listener<E>): void {
		this._events.on(e, l);
	}

	vtOff<E extends Vt100StreamEvent>(e: E, l: Listener<E>): void {
		this._events.off(e, l);
	}

	private _emit<E extends Vt100StreamEvent>(
		e: E,
		...args: Vt100StreamEventMap[E]
	): void {
		this._events.emit(e, ...args);
	}
}

type Vt100StreamEventMap = {
	data: [Buffer];
};

type Vt100StreamEvent = keyof Vt100StreamEventMap;

type Listener<E extends Vt100StreamEvent> = (
	...data: Vt100StreamEventMap[E]
) => void;

type ErrorCallback = (err: Error | null) => void;
type Chunk = {
	chunk: Buffer;
	encoding: never;
};
