import { IBuildPath, Path, BuildPathLike } from './Path.js';
import { Vt100Stream } from './Vt100Stream.js';

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';

/**
 * Public interface of build introspection
 */
export interface IBuild {
	readonly buildRoot: string;
	readonly srcRoot: string;

	nameOf(recipe: RecipeID): string;
	elapsedMsOf(recipe: RecipeID, now?: number): number;
	resultOf(recipe: RecipeID): boolean | null;
	contentOfLog(recipe: RecipeID): string | null;
	thrownExceptionOf(recipe: RecipeID): Error;

	on<Event extends BuildEvent>(event: Event, listener: Listener<Event>): void;

	off<Event extends BuildEvent>(event: Event, listener: Listener<Event>): void;
}

export type RecipeID = number;

export function isRecipeID(id: unknown): id is RecipeID {
	return typeof id === 'number';
}

export type RuleInfo = {
	name: string;
	recipe: (build: Build) => Promise<boolean> | null;
	sources: Path[];
	targets: IBuildPath[];
};

type InProgressInfo = {
	complete: false;

	/** performance.now() when recipe() was started */
	startTime: number;
};

enum CompleteReason {
	upToDate,
	missingSrc,
	built,
}

type CompleteInfo = {
	complete: true;
	completeReason: CompleteReason;

	/** performance.now() when recipe() was started */
	startTime: number;

	/** performance.now() when recipe() resolved */
	endTime: number;

	/** return val of recipe() */
	result: boolean;

	/** if recipe() threw an exception */
	exception?: Error;
};

type RecipeBuildInfo = InProgressInfo | CompleteInfo;

interface IBuildJson {
	targets: [string, RecipeID][];
	sources: [RecipeID, string[]][];
	runtimeSrc: [RecipeID, string[]][];
}

interface IBuildOpts {
	rules: RuleInfo[];
	prevBuild: Build | null;
	buildRoot: string;
	srcRoot: string;
}

export class Build implements IBuild {
	readonly buildRoot: string;
	readonly srcRoot: string;

	private _event = new EventEmitter();
	private _rules: RuleInfo[] = [];
	private _prevBuild: Build | null;

	private _targets = new Map<string, RecipeID>();
	private _buildInProgress = new Map<RecipeID, Promise<boolean>>();
	private _info = new Map<RecipeID, RecipeBuildInfo>();
	private _runtimeSrcMap = new Map<RecipeID, Set<string>>();
	private _logs = new Map<RecipeID, Vt100Stream>();

	constructor(opts?: IBuildOpts) {
		if (opts) {
			const { rules } = opts;

			this.buildRoot = opts.buildRoot;
			this.srcRoot = opts.srcRoot;
			this._rules = rules;
			this._prevBuild = opts.prevBuild;

			for (let id = 0; id < rules.length; ++id) {
				this.register(id);
			}
		}
	}

	on<E extends BuildEvent>(e: E, l: Listener<E>): void {
		this._event.on(e, l);
	}

	off<E extends BuildEvent>(e: E, l: Listener<E>): void {
		this._event.off(e, l);
	}

	nameOf(recipe: RecipeID): string {
		return this._rules[recipe].name;
	}

	elapsedMsOf(recipe: RecipeID, now?: number): number {
		const info = this._info.get(recipe);
		if (info.complete) {
			return info.endTime - info.startTime;
		} else {
			return (now || performance.now()) - info.startTime;
		}
	}

	resultOf(recipe: RecipeID): boolean | null {
		const info = this._info.get(recipe);
		if (info.complete) {
			return info.result;
		}

		return null;
	}

	contentOfLog(recipe: RecipeID): string | null {
		const stream = this._logs.get(recipe);
		if (!stream) return null;
		return stream.contents();
	}

	thrownExceptionOf(recipe: number): Error | null {
		const info = this._info.get(recipe);
		if (info.complete) {
			return info.exception || null;
		}

		return null;
	}

	private _emit<E extends BuildEvent>(e: E, ...data: BuildEventMap[E]): void {
		this._event.emit(e, ...data);
	}

	async runAll(recipes: Iterable<RecipeID>): Promise<boolean> {
		const promises: Promise<boolean>[] = [];

		for (const r of recipes) {
			promises.push(this._findOrStartBuild(r));
		}

		const results = await Promise.all(promises);
		return results.every((b) => b);
	}

	createLogStream(recipe: RecipeID): Writable {
		const stream = new Vt100Stream();
		stream.vtOn('data', (buf: Buffer) => {
			this._emit('recipe-log', recipe, buf);
		});
		this._logs.set(recipe, stream);
		return stream;
	}

	private async _findOrStartBuild(recipe: RecipeID | null): Promise<boolean> {
		if (!isRecipeID(recipe) || recipe >= this._rules.length) {
			throw new Error(`Invalid recipe`);
		}

		const currentBuild = this._buildInProgress.get(recipe);
		if (currentBuild) {
			return currentBuild;
		} else {
			const { promise, resolve, reject } = makePromise<boolean>();
			this._buildInProgress.set(recipe, promise);

			let result = false;

			try {
				result = await this._startBuild(recipe);
				resolve(result);
			} catch (err) {
				reject(err);
			} finally {
				this._buildInProgress.delete(recipe);
			}

			return result;
		}
	}

	private abs(p: Path) {
		if (p.isBuildPath()) {
			return p.abs(this.buildRoot);
		} else {
			return p.abs(this.srcRoot);
		}
	}

	private async _startBuild(id: RecipeID): Promise<boolean> {
		const info = this._rules[id];

		// build sources
		const srcToBuild = [] as RecipeID[];
		for (const src of info.sources) {
			if (src.isBuildPath()) {
				srcToBuild.push(this._recipe(src));
			}
		}

		if (!(await this.runAll(srcToBuild))) {
			this._info.set(id, {
				complete: true,
				completeReason: CompleteReason.missingSrc,
				result: false,
				startTime: -1,
				endTime: -1,
			});
			this._emit('end-recipe', id);
			return false;
		}

		const runtimeSrc = this._prevBuild?.runtimeSrc(info.targets[0]);

		const recipeStatus = needsBuild(
			info.targets.map((p) => this.abs(p)),
			info.sources.map((p) => this.abs(p)),
			runtimeSrc,
		);

		if (recipeStatus === NeedsBuildValue.missingSrc) {
			this._info.set(id, {
				complete: true,
				completeReason: CompleteReason.missingSrc,
				result: false,
				startTime: -1,
				endTime: -1,
			});
			this._emit('end-recipe', id);
			return false;
		}

		if (recipeStatus === NeedsBuildValue.upToDate) {
			this._info.set(id, {
				complete: true,
				completeReason: CompleteReason.upToDate,
				result: true,
				startTime: -1,
				endTime: -1,
			});
			this._emit('end-recipe', id);
			return true;
		}

		for (const target of info.targets) {
			await mkdir(target.dir().abs(this.buildRoot), { recursive: true });
		}

		const buildInfo: RecipeBuildInfo = {
			complete: false,
			startTime: performance.now(),
		};

		this._info.set(id, buildInfo);

		this._emit('start-recipe', id);

		try {
			const result = await info.recipe(this);
			this._info.set(id, {
				...buildInfo,
				complete: true,
				completeReason: CompleteReason.built,
				endTime: performance.now(),
				result,
			});
			return result;
		} catch (err) {
			this._info.set(id, {
				...buildInfo,
				complete: true,
				completeReason: CompleteReason.built,
				endTime: performance.now(),
				result: false,
				exception: err,
			});
			return false;
		} finally {
			this._emit('end-recipe', id);
		}
	}

	static async readFile(abs: string): Promise<Build | null> {
		try {
			const contents = await readFile(abs, 'utf8');
			const json = JSON.parse(contents) as IBuildJson;
			const results = new Build();

			for (const [rel, id] of json.targets) {
				results._targets.set(rel, id);
			}

			for (const [recipe, src] of json.runtimeSrc) {
				results._runtimeSrcMap.set(recipe, new Set<string>(src));
			}

			return results;
		} catch {
			return null;
		}
	}

	async writeFile(abs: string): Promise<void> {
		const json: IBuildJson = {
			runtimeSrc: [],
			targets: [],
			sources: [],
		};

		for (const [recipe, src] of this._runtimeSrcMap) {
			json.runtimeSrc.push([recipe, [...src]]);
		}

		for (let id = 0; id < this._rules.length; ++id) {
			const rel = this._rules[id].sources.map((p) => this.abs(p));
			json.sources.push([id, rel]);
		}

		for (const [target, recipe] of this._targets) {
			json.targets.push([target, recipe]);
		}

		await mkdir(dirname(abs), { recursive: true });
		await writeFile(abs, JSON.stringify(json), 'utf8');
	}

	addRuntimeSrc(recipe: RecipeID, srcAbs: Set<string>): void {
		this._runtimeSrcMap.set(recipe, srcAbs);
	}

	private _recipe(target: BuildPathLike): RecipeID | null {
		const rel = typeof target === 'string' ? target : target.rel();
		const recipe = this._targets.get(rel);
		if (isRecipeID(recipe)) return recipe;
		return null;
	}

	private register(recipe: RecipeID): void {
		for (const t of this._rules[recipe].targets) {
			this._targets.set(t.rel(), recipe);
		}
	}

	runtimeSrc(target: IBuildPath): Set<string> {
		const recipe = this._targets.get(target.rel());
		const src = isRecipeID(recipe) && this._runtimeSrcMap.get(recipe);
		if (src) return src;
		return new Set<string>();
	}
}

enum NeedsBuildValue {
	stale,
	missingSrc,
	upToDate,
}

function needsBuild(
	targets: string[],
	sources: string[],
	runtimeSrc: Set<string> | null,
): NeedsBuildValue {
	let oldestTargetMtimeMs = Infinity;
	for (const t of targets) {
		const targetStats = statSync(t, { throwIfNoEntry: false });
		if (!targetStats) return NeedsBuildValue.stale;
		oldestTargetMtimeMs = Math.min(targetStats.mtimeMs, oldestTargetMtimeMs);
	}

	for (const src of sources) {
		const srcStat = statSync(src, { throwIfNoEntry: false });
		if (!srcStat) {
			return NeedsBuildValue.missingSrc;
		}
		if (srcStat.mtimeMs > oldestTargetMtimeMs) return NeedsBuildValue.stale;
	}

	if (runtimeSrc) {
		for (const src of runtimeSrc) {
			const srcStat = statSync(src, { throwIfNoEntry: false });
			if (!srcStat) return NeedsBuildValue.stale; // need to see if still needed
			if (srcStat.mtimeMs > oldestTargetMtimeMs) return NeedsBuildValue.stale;
		}
	}

	return NeedsBuildValue.upToDate;
}

interface IPromisePieces<T> {
	promise: Promise<T>;
	resolve: (val: T) => Promise<T> | void;
	reject: (err: Error) => void;
}

function makePromise<T>(): IPromisePieces<T> {
	let resolve, reject;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { resolve, reject, promise };
}

type BuildEventMap = {
	'start-recipe': [RecipeID];
	'end-recipe': [RecipeID];
	'recipe-log': [RecipeID, Buffer];
};

type BuildEvent = keyof BuildEventMap;

type Listener<E extends BuildEvent> = (...data: BuildEventMap[E]) => void;
