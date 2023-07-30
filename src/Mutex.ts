type UnlockFunction = () => void;
type ResolveFunction = (unlock: UnlockFunction) => void;

export class Mutex {
	private _isLocked: boolean = false;
	private _queue: ResolveFunction[] = [];

	tryLock(): UnlockFunction | null {
		if (!this._isLocked) {
			this._isLocked = true;
			return this.unlockFn();
		}

		return null;
	}

	lockAsync(): Promise<UnlockFunction> {
		const unlock = this.tryLock();
		if (unlock) return Promise.resolve(unlock);

		return new Promise<UnlockFunction>((res) => {
			this._queue.push(res);
		});
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
			resolveNext(this.unlockFn());
		} else {
			this._isLocked = false;
		}
	}
}
