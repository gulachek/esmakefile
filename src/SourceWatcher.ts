import { FSWatcher } from 'node:fs';
import { watch } from 'node:fs';
import EventEmitter from 'node:events';
import { resolve } from 'node:path';

export class SourceWatcher extends EventEmitter {
	private _watcher: FSWatcher;
	private _debounceMs: number;
	private _excludeDir: string;
	private _count: number = 0;

	constructor(dir: string, opts: { debounceMs: number; excludeDir: string }) {
		super();
		this._debounceMs = opts.debounceMs;
		this._excludeDir = opts.excludeDir;

		this._watcher = watch(dir, { recursive: true });
		this._watcher.on('change', this._onChange.bind(this));
		this._watcher.on('close', () => this.emit('close'));
	}

	close() {
		this._watcher.close();
	}

	private _onChange(type: string, filename: string): void {
		switch (type) {
			case 'rename':
			case 'change':
				if (!resolve(filename).startsWith(this._excludeDir))
					this._queueChange();
				break;
			default:
				this.emit('unknown', type);
				break;
		}
	}

	private _queueChange() {
		const count = ++this._count;
		setTimeout(() => {
			if (this._count === count) {
				this.emit('change');
			}
		}, this._debounceMs);
	}
}
