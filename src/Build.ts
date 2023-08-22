import { IBuildPath, Path, BuildPathLike } from './Path';

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { Vt100Stream } from './Vt100Stream';

/**
 * Public interface of build introspection
 */
export interface IBuild {
	readonly buildRoot: string;
	readonly srcRoot: string;

	on<Event extends BuildEvent>(event: Event, listener: Listener<Event>): void;

	off<Event extends BuildEvent>(event: Event, listener: Listener<Event>): void;
}

export type RecipeID = number;

export function isRecipeID(id: any): id is RecipeID {
	return typeof id === 'number';
}

export type RecipeInfo = {
	name: string;
	buildAsync(build: Build): Promise<boolean>;
	sources: Path[];
	targets: IBuildPath[];
};

interface IBuildJson {
	targets: [string, RecipeID][];
	sources: [RecipeID, string[]][];
	runtimeSrc: [RecipeID, string[]][];
}

interface IBuildOpts {
	recipes: RecipeInfo[];
	prevBuild: Build | null;
	buildRoot: string;
	srcRoot: string;
}

export class Build implements IBuild {
	readonly buildRoot: string;
	readonly srcRoot: string;

	private _event = new EventEmitter();
	private _recipes: RecipeInfo[] = [];
	private _prevBuild: Build | null;

	private _targets = new Map<string, RecipeID>();
	private _buildInProgress = new Map<RecipeID, Promise<boolean>>();
	private _runtimeSrcMap = new Map<RecipeID, Set<string>>();
	private _logs = new Map<RecipeID, Vt100Stream>();

	constructor(opts?: IBuildOpts) {
		if (opts) {
			const { recipes } = opts;

			this.buildRoot = opts.buildRoot;
			this.srcRoot = opts.srcRoot;
			this._recipes = recipes;
			this._prevBuild = opts.prevBuild;

			for (let id = 0; id < recipes.length; ++id) {
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

	private _emit<E extends BuildEvent>(e: E, ...data: BuildEventMap[E]): void {
		this._event.emit(e, ...data);
	}

	async runAll(recipes: Iterable<RecipeID>): Promise<boolean> {
		for (const r of recipes) {
			const result = await this._findOrStartBuild(r);
			if (!result) return false;
		}

		return true;
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
		if (!isRecipeID(recipe) || recipe >= this._recipes.length) {
			throw new Error(`Invalid recipe`);
		}

		const info = this._recipes[recipe];

		const currentBuild = this._buildInProgress.get(recipe);
		if (currentBuild) {
			return currentBuild;
		} else {
			const { promise, resolve, reject } = makePromise<boolean>();
			this._buildInProgress.set(recipe, promise);

			let result = false;

			try {
				result = await this._startBuild(recipe, info);
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

	private async _startBuild(id: RecipeID, info: RecipeInfo): Promise<boolean> {
		// build sources
		for (const src of info.sources) {
			if (src.isBuildPath()) {
				const srcId = this._recipe(src);
				const result = await this._findOrStartBuild(srcId);
				if (!result) return false;
			}
		}

		const runtimeSrc = this._prevBuild?.runtimeSrc(info.targets[0]);

		const recipeStatus = needsBuild(
			info.targets.map((p) => this.abs(p)),
			info.sources.map((p) => this.abs(p)),
			runtimeSrc,
		);

		if (recipeStatus === NeedsBuildValue.error) return false;
		if (recipeStatus === NeedsBuildValue.upToDate) return true;

		for (const target of info.targets) {
			await mkdir(target.dir().abs(this.buildRoot), { recursive: true });
		}

		this._emit('start-recipe', id);
		const result = await info.buildAsync(this);
		this._emit('end-recipe', id);
		return result;
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

		for (let id = 0; id < this._recipes.length; ++id) {
			const rel = this._recipes[id].sources.map((p) => this.abs(p));
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
		for (const t of this._recipes[recipe].targets) {
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
	error,
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
			return NeedsBuildValue.error;
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
