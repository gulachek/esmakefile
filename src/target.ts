import {
	Path,
	PathLike
} from './path';	

import * as fs from 'fs';
import { ChildProcess } from 'child_process';

export interface IToTarget
{
	toTarget(): TargetLike;
}

export function hasToTarget(obj: any): obj is IToTarget
{
	return typeof obj.toTarget === 'function';
}

// system can convert any of these to a Target
export type TargetLike = Target | IToTarget | PathLike;

function isIterableTargetLike(obj: TargetLike | Iterable<TargetLike>):
	obj is Iterable<TargetLike>
{
	return typeof (obj as any)[Symbol.iterator] === 'function';
}

export interface IBuildSystem
{
	abs(tLike: TargetLike): string;
	build(work: AsyncWork): Promise<void>;
}

export class Target
{
	private _sys: IBuildSystem;
	private _path: Path | null;
	private _explicitDeps: TargetLike[] = [];

	constructor(sys: IBuildSystem, p?: PathLike)
	{
		this._sys = sys;
		this._path = p ? Path.from(p) : null;
	}

	toString(): string
	{
		const name = this.constructor.name;
		if (this.hasPath)
			return `${name}{${this.path}}`;
		else
			return name;
	}

	get sys(): IBuildSystem
	{
		return this._sys;
	}

	get hasPath(): boolean
	{
		return !!this._path;
	}

	get path(): Path
	{
		if (!this.hasPath)
			throw new Error(`Cannot access null path: ${this}`);

		return this._path;
	}
	
	get abs(): string
	{
		return this.sys.abs(this.path);
	}

	deps(): Iterable<TargetLike> | TargetLike | null
	{
		return null;
	}

	dependsOn(...ts: TargetLike[]): void
	{
		for (const t of ts)
			this._explicitDeps.push(t);
	}

	static getDeps(t: Target): TargetLike[]
	{
		const deps = [...t._explicitDeps];

		const implicitDeps = t.deps();
		if (implicitDeps)
		{
			if (isIterableTargetLike(implicitDeps))
			{
				for (const dep of implicitDeps)
					deps.push(dep);
			}
			else
			{
				deps.push(implicitDeps);
			}
		}

		return deps;
	}

	task(cb: ErrorFirstCallback): AsyncDoneable | void
	{
		return Promise.resolve();
	}

	static runTask(t: Target, cb: ErrorFirstCallback): AsyncDoneable | void
	{
		if (t.hasPath && t.path.writable)
		{
			try
			{
				fs.mkdirSync(t.sys.abs(t.path.dir), { recursive: true });
			}
			catch (err)
			{
				cb(err);
			}
		}

		return t.task(cb);
	}

	// Date object of mtime, null means out of date
	mtime(): Date | null
	{
		if (!this.hasPath)
			return null;

		const abs = this.abs;
		if (!fs.existsSync(abs)) { return null; }
		return fs.statSync(abs).mtime;
	}
}

export type ErrorFirstCallback = (err?: Error, ...rest: any[]) => any;
export type AsyncDoneable = Promise<any> | ChildProcess;
export type BuildTask = (cb: ErrorFirstCallback) => AsyncDoneable | void;
export type AsyncWork = BuildTask | AsyncDoneable | TargetLike;

export function isAsyncDoneable(obj: any): obj is AsyncDoneable
{
	if (typeof obj === 'undefined')
		return false;

	// promise
	if (typeof obj.then === 'function')
		return true;

	// stream
	if (typeof obj.on === 'function')
		return true;

	// something weird that gulp supports
	if (typeof obj.subscribe === 'function')
		return true;

	return false;
}
