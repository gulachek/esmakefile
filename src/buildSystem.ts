import asyncDone from 'async-done';

import * as path from 'path';

import {
	Path,
	PathType
} from './path';	

import {
	Target,
	TargetLike,
	hasToTarget,
	AsyncWork,
	isAsyncDoneable
} from './target';

import { ParamsFile } from './paramsFile';
import { createHash } from 'node:crypto';

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

	return pieces.join('/');
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

	abs(tLike: TargetLike, pathMod?: any): string
	{
		pathMod = pathMod || path;
		const t = this.#toTarget(tLike, pathMod);
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

		return pathMod.resolve(base, ...components);
	}

	#toTarget(t: TargetLike, pathMod?: any): Target
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
		const prefix = `[${this._logLineNumber++}:/${traceStr(trace)}]`;
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
			const prevStep = { id, parent, step: step - 1 };

			const wrapCb = (err: Error, result?: AsyncWork | undefined) => {
				if (err)
				{
					if (this._showLog)
						this.#log(trace, `encountered error ${err}`);

					reject(err);
				}
				else
				{
					if (result && this._showLog)
						this.#log(trace, `continuing in step ${traceStr(nextStep)} with ${result}`);
					resolve(this.#recursiveAsyncDone(result, nextStep));
				}
			};

			// Break recursion
			if (!work) {
				if (this._showLog)
					this.#log(prevStep, `work complete`);

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
			return resolve(this.#buildTarget(work, trace));
		});
	}

	#getDeps(t: Target): Target[]
	{
		const deps = Target.getDeps(t).map(t => this.#toTarget(t));

		if (t.hasPath && t.path.writable)
		{
			const depsHash = createHash('md5');
			for (const dep of deps)
			{
				if (dep.hasPath)
					depsHash.update(dep.path.toString());
			}

			if (deps.length)
				deps.push(new ParamsFile(t, 'deps', depsHash.digest()));

			// inject more dependencies here
			const hash = Target.hashParams(t);
			if (hash)
				deps.push(new ParamsFile(t, 'params', hash));

		}

		return deps;
	}

	async #buildTargetMutex(t: Target, trace: ITrace): Promise<void>
	{
		const deps = this.#getDeps(t);

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

		const selfMtime = Target.mtime(t);
		let buildReason: string | null = selfMtime ? null : 'mtime is null';

		if (!buildReason)
		{
			for (const dep of deps)
			{
				const mtime = Target.mtime(dep);
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
							comparison = `${depTime} >= ${time}`;
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

				await this.#recursiveAsyncDone(Target.makeRecipe.bind(Target, t), trace);
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
		const trace: ITrace = { id: 0, step: 0, parent: null };
		if (this._showLog)
			this.#log(trace, `initiating build for ${work}`);

		return this.#recursiveAsyncDone(work, trace);
	}
}

