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
	#sys: BuildSystem;
	#path: Path | null;
	#explicitDeps: TargetLike[] = [];

	constructor(sys: BuildSystem, p?: PathLike)
	{
		this.#sys = sys;
		this.#path = p ? Path.from(p) : null;
	}

	toString(): string
	{
		return this.constructor.name;
	}

	get sys(): BuildSystem
	{
		return this.#sys;
	}

	get hasPath(): boolean
	{
		return !!this.#path;
	}

	get path(): Path
	{
		if (!this.hasPath)
			throw new Error(`Cannot access null path: ${this}`);

		return this.#path;
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
			this.#explicitDeps.push(t);
	}

	static getDeps(t: Target): TargetLike[]
	{
		const deps = [...t.#explicitDeps];

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
	#srcDir: string = '';
	#buildDir: string = '';

	#isDebug: boolean = false;
	#buildingTargets: Map<Target, Promise<void>> = new Map();

	constructor(passedOpts?: IBuildSystemOpts)
	{
		const defaults: IBuildSystemOpts = {
			srcDir: require && require.main && require.main.path,
			buildDir: 'build',
			isDebug: true
		};

		const opts: IBuildSystemOpts =
			Object.assign(defaults, passedOpts || {});

		this.#isDebug = opts.isDebug;
		this.#srcDir = opts.srcDir;
		this.#buildDir = opts.buildDir;
	}

	abs(tLike: TargetLike): string
	{
		const t = this.#toTarget(tLike);
		const { type, components } = t.path;

		let base;

		switch (type)
		{
			case PathType.src:
				base = this.#srcDir;
				break;
			case PathType.build:
				base = this.#buildDir;
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

	isDebugBuild() {
		return this.#isDebug;
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

	#recursiveAsyncDone(work?: AsyncWork | undefined): Promise<void>
	{
		return new Promise((resolve, reject) => {
			const wrapCb = (err: Error, result?: AsyncWork | undefined) => {
				if (err) reject(err);
				else resolve(this.#recursiveAsyncDone(result));
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
			return resolve(this.#buildTarget(work));
		});
	}

	async #buildTargetMutex(t: Target): Promise<void>
	{
		const deps = Target.getDeps(t).map(t => this.#toTarget(t));
		const depTasks = deps.map(d => this.#buildTarget(d));

		try {
			await Promise.all(depTasks);
		} catch (e) {
			e.message += `\nBuilding dependency of ${t}`;
			throw e;
		}

		const selfMtime = t.mtime();
		let needsBuild = !selfMtime;

		if (!needsBuild)
		{
			for (const dep of deps)
			{
				const mtime = dep.mtime();
				if (!mtime || mtime > selfMtime)
				{
					needsBuild = true;
					break;
				}
			}
		}

		if (needsBuild) {
			try {
				await this.#recursiveAsyncDone(Target.invokeBuild.bind(Target, t));
			} catch (err) {
				err.message += `\nBuilding ${t}`;
				throw err;
			}
		}
	}

	async #buildTarget(tLike: TargetLike): Promise<void>
 	{
		const t = this.#toTarget(tLike);

		let promise: Promise<void> | null = this.#buildingTargets.get(t);

		if (promise)
			return promise;

		promise = this.#buildTargetMutex(t);
		this.#buildingTargets.set(t, promise);

		try {
			await promise;
		} finally {
			this.#buildingTargets.delete(t);
		}
	}

	build(work: AsyncWork): Promise<void>
	{
		return this.#recursiveAsyncDone(work);
	}

	/*
	mtime(...paths) {
		const mtimes = paths.map((p) => {
			const t = this.path(p);
			return normalizeMtime(t);
		});

		return Math.max(...mtimes);
	}
 */
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

