export class Mutex {
	private _isLocked: boolean = false;
	private _queue: ResolveFunction[] = [];

	tryLock(): Lock | null {
		if (!this._isLocked) {
			this._isLocked = true;
			return this.makeLock();
		}

		return null;
	}

	lockAsync(): Promise<Lock> {
		const lock = this.tryLock();
		if (lock) return Promise.resolve(lock);

		return new Promise<Lock>((res) => {
			this._queue.push(res);
		});
	}

	private makeLock(): Lock {
		return new Lock(this.unlockFn());
	}

	private unlockFn(): UnlockFunction {
		let called = false;
		return () => {
			if (!called) {
				called = true;
				this.unlock();
			}
		};
	}

	private unlock() {
		const resolveNext = this._queue.shift();
		if (resolveNext) {
			resolveNext(this.makeLock());
		} else {
			this._isLocked = false;
		}
	}
}

export class Lock implements Disposable {
	private _unlock: UnlockFunction;

	/** @internal */
	public constructor(unlock: UnlockFunction) {
		this._unlock = unlock;
	}

	public [Symbol.dispose]() {
		this._unlock();
	}
}

export type UnlockFunction = () => void;

type ResolveFunction = (lock: Lock) => void;
