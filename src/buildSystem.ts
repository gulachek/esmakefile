import asyncDone from 'async-done';

import * as path from 'path';
import * as fs from 'fs';
import { ChildProcess } from 'child_process';

import {
	Path,
	PathType,
	PathLike
} from './path';	

interface IToTarget
{
	toTarget(): TargetLike;
}

interface ITrace
{
	// unique to a target
	id: number;
	// increment with each async-done step
	step: number;
	// initiating target build
	parent: ITrace | null;
}

function traceStr(trace: ITrace): string
{
	const pieces: string[] = [];
	while (trace)
	{
		const piece = trace.step ? `${trace.id}.${trace.step}` : `${trace.id}`;
		pieces.unshift(piece);
		trace = trace.parent;
	}

	return pieces.join(':');
}

function hasToTarget(obj: any): obj is IToTarget
{
	return typeof obj.toTarget === 'function';
}

// build system can convert any of these to a Target
type TargetLike = Target | IToTarget | PathLike;

function isIterableTargetLike(obj: TargetLike | Iterable<TargetLike>):
	obj is Iterable<TargetLike>
{
	return typeof (obj as any)[Symbol.iterator] === 'function';
}

export class Target
{
	private _sys: BuildSystem;
	private _path: Path | null;
	private _explicitDeps: TargetLike[] = [];

	constructor(sys: BuildSystem, p?: PathLike)
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

	get sys(): BuildSystem
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

	build(cb: ErrorFirstCallback): AsyncDoneable | void
	{
		return Promise.resolve();
	}

	static invokeBuild(t: Target, cb: ErrorFirstCallback): AsyncDoneable | void
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

		return t.build(cb);
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

export interface IBuildSystemOpts
{
	srcDir?: string;
	buildDir?: string;
	isDebug?: boolean;
}

export class BuildSystem
{
	private _srcDir: string = '';
	private _buildDir: string = '';

	private _isDebug: boolean = false;
	private _buildingTargets: Map<Target | string, Promise<void>> = new Map();
	private _showLog: boolean;
	private _logLineNumber: number = 1;

	constructor(passedOpts?: IBuildSystemOpts)
	{
		const defaults: IBuildSystemOpts = {
			srcDir: require && require.main && require.main.path,
			buildDir: 'build',
			isDebug: true
		};

		const opts: IBuildSystemOpts =
			Object.assign(defaults, passedOpts || {});

		this._isDebug = opts.isDebug;
		this._srcDir = opts.srcDir;
		this._buildDir = opts.buildDir;
		this._showLog = 'GULPACHEK_DEBUG_LOG' in process.env;
	}

	abs(tLike: TargetLike): string
	{
		const t = this.#toTarget(tLike);
		const { type, components } = t.path;

		let base;

		switch (type)
		{
			case PathType.src:
				base = this._srcDir;
				break;
			case PathType.build:
				base = this._buildDir;
				break;
			case PathType.external:
				base = '/';
				break;
			default:
				throw new Error(`Unknown PathType: ${type}`);
				break;
		}

		return path.resolve(base, ...components);
	}

	#toTarget(t: TargetLike): Target
	{
		if (t instanceof Target)
		{
			if (t.sys !== this)
				throw new Error(`Target belongs to different system ${t}`);

			return t;
		}

		if (hasToTarget(t))
		{
			return this.#toTarget(t);
		}

		return new Target(this, t);
	}

	#log(trace: ITrace, ...msg: any[])
	{
		const prefix = `[${this._logLineNumber++}/${traceStr(trace)}]`;
		console.log(prefix, ...msg);
	}

	isDebugBuild() {
		return this._isDebug;
	}

	// convert system path into a target
	ext(absPath: string): Target
	{
		if (!path.isAbsolute(absPath))
			throw new Error(`External paths must be referenced as absolute: ${absPath}`);

		return new Target(this, Path.from(absPath));
	}

	// convert a TargetLike object to a Target in this system
	src(t: TargetLike): Target
	{
		return this.#toTarget(t);
	}

	#recursiveAsyncDone(work: AsyncWork | undefined, trace: ITrace): Promise<void>
	{
		return new Promise((resolve, reject) => {
			const { id, step, parent } = trace;
			const nextStep = { id, parent, step: step + 1 };

			const wrapCb = (err: Error, result?: AsyncWork | undefined) => {
				if (err) reject(err);
				else resolve(this.#recursiveAsyncDone(result, nextStep));
			};

			// Break recursion
			if (!work) {
				return resolve();
			}

			// BuildTask
			if (typeof work === 'function') {
				return asyncDone(work, wrapCb);
			}

			// AsyncDoneable
			if (isAsyncDoneable(work)) {
				return asyncDone(() => work, wrapCb);
			}

			// TargetLike
			return resolve(this.#buildTarget(work, nextStep));
		});
	}

	async #buildTargetMutex(t: Target, trace: ITrace): Promise<void>
	{
		const deps = Target.getDeps(t).map(t => this.#toTarget(t));

		if (this._showLog)
		{
			const n = deps.length;
			const depsWord = n === 1 ? 'dep' : 'deps';
			this.#log(trace, `${deps.length} ${depsWord} for ${t}`);
			for (const dep of deps)
			{
				this.#log(trace, `    ${t} -> ${dep}`);
			}
		}

		try {
			const depTasks = deps.map((d, i) => {
				return this.#buildTarget(d, { id: i, step: 0, parent: trace });
			});
			await Promise.all(depTasks);
		} catch (e) {
			e.message += `\nBuilding dependency of ${t}`;
			throw e;
		} finally {
			if (this._showLog && deps.length)
				this.#log(trace, `done evaluating deps for ${t}`);
		}

		const selfMtime = t.mtime();
		let buildReason: string | null = selfMtime ? null : 'mtime is null';

		if (!buildReason)
		{
			for (const dep of deps)
			{
				const mtime = dep.mtime();
				if (!mtime)
				{
					buildReason = `${dep}.mtime is null`;
					break;
				}
				else if (mtime > selfMtime)
				{
					let comparison = '';
					if (this._showLog)
					{
						const depDate = mtime.toLocaleDateString();
						const date = selfMtime.toLocaleDateString();
						const depTime = mtime.toLocaleTimeString();
						const time = selfMtime.toLocaleTimeString();

						if (depDate !== date)
							comparison = `${depDate} > ${date}`;
						else
							comparison = `${depTime} > ${time}`;
					}

					buildReason = `${dep}.mtime is newer (${comparison})`;
					break;
				}
			}
		}

		if (buildReason) {
			try {
				if (this._showLog)
					this.#log(trace, `building ${t} because ${buildReason}`);

				await this.#recursiveAsyncDone(Target.invokeBuild.bind(Target, t), trace);
			} catch (err) {
				err.message += `\nBuilding ${t}`;
				throw err;
			} finally {
				if (this._showLog)
					this.#log(trace, `done building ${t}`);
			}
		}
	}

	#trackTarget(t: Target): Function
	{
		let resolve: Function;
		const promise = new Promise<void>((res) => {
			resolve = res;
		});
		
		if (t.hasPath)
			this._buildingTargets.set(t.abs, promise);
		else
			this._buildingTargets.set(t, promise);

		return resolve;
	}

	#untrackTarget(t: Target): void
	{
		if (t.hasPath)
			this._buildingTargets.delete(t.abs);
		else
			this._buildingTargets.delete(t);
	}

	#getTrackedTarget(t: Target): Promise<void> | null
	{
		if (t.hasPath)
			return this._buildingTargets.get(t.abs);
		else
			return this._buildingTargets.get(t);
	}

	async #buildTarget(tLike: TargetLike, trace: ITrace): Promise<void>
 	{
		const t = this.#toTarget(tLike);
		if (this._showLog)
			this.#log(trace, `evaluating ${t}`);

		let promise: Promise<void> | null = this.#getTrackedTarget(t);

		if (promise)
		{
			if (this._showLog)
				this.#log(trace, `build already in progress ${t}`);

			return promise;
		}

		if (this._showLog)
			this.#log(trace, `tracking ${t}`);

		const resolve = this.#trackTarget(t);

		promise = this.#buildTargetMutex(t, trace);
		resolve(promise);

		try {
			await promise;
		} finally {
			if (this._showLog)
				this.#log(trace, `done evaluating ${t}`);

			this.#untrackTarget(t);
		}
	}

	build(work: AsyncWork): Promise<void>
	{
		return this.#recursiveAsyncDone(work, { id: 0, step: 0, parent: null });
	}
}

export type ErrorFirstCallback = (err?: Error, ...rest: any[]) => any;
type AsyncDoneable = Promise<any> | ChildProcess;
type BuildTask = (cb: ErrorFirstCallback) => AsyncDoneable | void;

type AsyncWork = BuildTask | AsyncDoneable | TargetLike;

function isAsyncDoneable(obj: any): obj is AsyncDoneable
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

