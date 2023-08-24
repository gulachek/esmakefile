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
		return this._chunks.map((b) => b.toString()).join('');
	}

	vtOn<E extends BuildEvent>(e: E, l: Listener<E>): void {
		this._events.on(e, l);
	}

	vtOff<E extends BuildEvent>(e: E, l: Listener<E>): void {
		this._events.off(e, l);
	}

	private _emit<E extends BuildEvent>(e: E, ...args: BuildEventMap[E]): void {
		this._events.emit(e, ...args);
	}
}

type BuildEventMap = {
	data: [Buffer];
};

type BuildEvent = keyof BuildEventMap;

type Listener<E extends BuildEvent> = (...data: BuildEventMap[E]) => void;

type ErrorCallback = (err: Error | null) => void;
type Chunk = {
	chunk: Buffer;
	encoding: never;
};
