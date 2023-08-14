import { IRecipe, RecipeBuildArgs, MappedPaths, SourcePaths } from './Recipe';
import { mapShape } from './SimpleShape';

import { FSWatcher, mkdirSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { IBuildPath, BuildPathLike, Path } from './Path';
import { Mutex, UnlockFunction } from './Mutex';
import { watch } from 'node:fs';
import EventEmitter from 'node:events';

type RecipeInfo = {
	buildAsync(results: BuildResults): Promise<boolean>;
	sources: Path[];
	targets: IBuildPath[];
};

export interface ICookbookOpts {
	buildRoot?: string;
	srcRoot?: string;
}

interface IBuildResultsJson {
	runtimeSrc: [string, string[]][];
}

class BuildResults {
	private _runtimeSrcMap = new Map<string, Set<string>>();

	static async readFile(abs: string): Promise<BuildResults | null> {
		try {
			const contents = await readFile(abs, 'utf8');
			const json = JSON.parse(contents) as IBuildResultsJson;
			const results = new BuildResults();
			for (const entry of json.runtimeSrc) {
				const [target, src] = entry;
				results._runtimeSrcMap.set(target, new Set<string>(src));
			}

			return results;
		} catch {
			return null;
		}
	}

	async writeFile(abs: string): Promise<void> {
		const json: IBuildResultsJson = {
			runtimeSrc: [],
		};

		for (const [target, src] of this._runtimeSrcMap) {
			json.runtimeSrc.push([target, [...src]]);
		}

		mkdirSync(dirname(abs), { recursive: true });
		await writeFile(abs, JSON.stringify(json), 'utf8');
	}

	addRuntimeSrc(targets: IBuildPath[], srcAbs: Set<string>): void {
		for (const t of targets) {
			this._runtimeSrcMap.set(t.rel(), srcAbs);
		}
	}

	runtimeSrc(target: IBuildPath): Set<string> {
		const src = this._runtimeSrcMap.get(target.rel());
		if (src) return src;
		return new Set<string>();
	}
}

type RecipeID = number;
function isRecipeID(id: any): id is RecipeID {
	return typeof id === 'number';
}

export class Cookbook {
	private _mutex = new Mutex();
	private _buildLock: UnlockFunction | null = null;
	private _recipes: RecipeInfo[] = []; // index is RecipeID
	private _targets = new Map<string, RecipeID>();
	readonly buildRoot: string;
	readonly srcRoot: string;
	private _buildInProgress = new Map<RecipeID, Promise<boolean>>();
	private _prevBuild: BuildResults | null = null;

	constructor(opts?: ICookbookOpts) {
		opts = opts || {};
		this.srcRoot = resolve(opts.srcRoot || '.');
		this.buildRoot = resolve(opts.buildRoot || 'build');
	}

	add(recipe: IRecipe): void {
		const unlock = this._mutex.tryLock();
		if (!unlock) {
			throw new Error('Cannot add while build is in progress');
		}

		try {
			const info = this.normalizeRecipe(recipe);
			const id: RecipeID = this._recipes.length;
			this._recipes.push(info);

			for (const p of info.targets) {
				this._targets.set(p.rel(), id);
			}
		} finally {
			unlock();
		}
	}

	targets() {
		return [...this._targets.keys()];
	}

	async watch(): Promise<void> {
		await this.build();

		const watcher = new SourceWatcher(this.srcRoot, { debounceMs: 300 });

		console.log(
			`Watching '${this.srcRoot}'\nClose input stream to stop (usually Ctrl+D)`,
		);

		let foundChange = false;
		watcher.on('change', async () => {
			if (foundChange) return;
			foundChange = true;
			this._buildLock = await this._mutex.lockAsync();
			foundChange = false;

			try {
				await this.build();
			} finally {
				this._buildLock && this._buildLock();
				this._buildLock = null;
			}
		});

		watcher.on('unknown', (type: string) => {
			console.log(`Unhandled event type '${type}'`);
		});

		const closePromise = new Promise<void>((res) => {
			watcher.on('close', () => res());
		});

		process.stdin.on('close', () => {
			watcher.close();
		});

		process.stdin.on('data', () => {
			// drain input
			process.stdin.read();
		});

		return closePromise;
	}

	private _recipe(target: BuildPathLike): RecipeID | null {
		const rel = typeof target === 'string' ? target : target.rel();
		const recipe = this._targets.get(rel);
		if (isRecipeID(recipe)) return recipe;
		return null;
	}

	/**
	 * Top level build function. Runs exclusively
	 * @param target The target to build
	 * @returns A promise that resolves when the build is done
	 */
	async build(target?: IBuildPath): Promise<boolean> {
		let unlock: UnlockFunction | null = null;
		if (!this._buildLock) {
			unlock = await this._mutex.lockAsync();
		}

		let result = true;
		const prevBuildAbs = this.abs(
			Path.build('__gulpachek__/previous-build.json'),
		);

		const recipe = target && this._recipe(target);

		try {
			const buildResults =
				this._prevBuild ||
				(await BuildResults.readFile(prevBuildAbs)) ||
				new BuildResults();

			const recipes = isRecipeID(recipe)
				? [recipe]
				: this.__topLevelRecipes(buildResults);

			for (const r of recipes) {
				result = result && (await this._findOrStartBuild(r, buildResults));
			}

			await buildResults.writeFile(prevBuildAbs);
			this._prevBuild = buildResults;
		} finally {
			unlock && unlock();
		}

		return result;
	}

	private *__topLevelRecipes(buildResults: BuildResults): Generator<RecipeID> {
		// top level recipes are those that nobody depends on
		const srcIds = new Set<RecipeID>();

		for (let id = 0; id < this._recipes.length; ++id) {
			const info = this._recipes[id];
			const runtimeSrc = buildResults.runtimeSrc(info.targets[0]);
			for (const src of runtimeSrc) {
				const srcId = this._recipe(src);
				if (isRecipeID(srcId)) srcIds.add(srcId);
			}

			const { sources } = info;
			for (const s of sources) {
				if (!s.isBuildPath()) continue;
				const srcId = this._recipe(s);
				if (isRecipeID(srcId)) srcIds.add(srcId);
			}
		}

		for (let id = 0; id < this._recipes.length; ++id) {
			if (!srcIds.has(id)) {
				yield id;
			}
		}
	}

	private async _findOrStartBuild(
		recipe: RecipeID | null,
		buildResults: BuildResults,
	): Promise<boolean> {
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
				result = await this._startBuild(info, recipe, buildResults);
				resolve(result);
			} catch (err) {
				reject(err);
			} finally {
				this._buildInProgress.delete(recipe);
			}

			return result;
		}
	}

	private async _startBuild(
		info: RecipeInfo,
		recipe: RecipeID,
		buildResults: BuildResults,
	): Promise<boolean> {
		// build sources
		for (const src of info.sources) {
			if (src.isBuildPath()) {
				const srcId = this._recipe(src);
				const result = await this._findOrStartBuild(srcId, buildResults);
				if (!result) return false;
			}
		}

		const runtimeSrc = buildResults.runtimeSrc(info.targets[0]);
		for (const src of runtimeSrc) {
			if (src.startsWith(this.buildRoot)) {
				const path = Path.build(src.slice(this.buildRoot.length));
				const srcId = this._recipe(path);
				const result = await this._findOrStartBuild(srcId, buildResults);
				if (!result) return false;
			}
		}

		const recipeStatus = needsBuild(
			info.targets.map((p) => this.abs(p)),
			info.sources.map((p) => this.abs(p)),
			runtimeSrc,
		);

		if (recipeStatus === NeedsBuildValue.error) return false;
		if (recipeStatus === NeedsBuildValue.upToDate) return true;

		for (const target of info.targets) {
			mkdirSync(dirname(target.abs(this.buildRoot)), { recursive: true });
		}

		return info.buildAsync(buildResults);
	}

	abs(path: Path): string {
		return path.abs({
			src: this.srcRoot,
			build: this.buildRoot,
		});
	}

	normalizeRecipe(recipe: IRecipe): RecipeInfo {
		const sources: Path[] = [];
		const targets: IBuildPath[] = [];

		const rawSources: SourcePaths | undefined = recipe.sources?.();
		const rawTargets = recipe.targets();

		const mappedPaths: MappedPaths<IRecipe> = {
			sources:
				rawSources &&
				mapShape(
					rawSources,
					(p): p is Path => p instanceof Path,
					(pL) => {
						const p = Path.src(pL);
						sources.push(p);
						return this.abs(p);
					},
				),
			targets: mapShape(
				rawTargets,
				(p): p is IBuildPath => p instanceof Path,
				(pL) => {
					const p = Path.build(pL);
					targets.push(p);
					return p.abs(this.buildRoot);
				},
			),
		};

		const buildAsync = async (results: BuildResults) => {
			const src = new Set<string>();
			const buildArgs = new RecipeBuildArgs(mappedPaths, src);
			let result = false;
			try {
				result = await recipe.buildAsync(buildArgs);
			} catch (ex) {
				return false;
			}
			results.addRuntimeSrc(targets, src);
			return result;
		};

		return { sources, targets, buildAsync };
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
	runtimeSrc: Set<string>,
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

	for (const src of runtimeSrc) {
		const srcStat = statSync(src, { throwIfNoEntry: false });
		if (!srcStat) return NeedsBuildValue.stale; // need to see if still needed
		if (srcStat.mtimeMs > oldestTargetMtimeMs) return NeedsBuildValue.stale;
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

class SourceWatcher extends EventEmitter {
	private _watcher: FSWatcher;
	private _debounceMs: number;
	private _count: number = 0;

	constructor(dir: string, opts: { debounceMs: number }) {
		super();
		this._debounceMs = opts.debounceMs;

		this._watcher = watch(dir, { recursive: true });
		this._watcher.on('change', this._onChange.bind(this));
		this._watcher.on('close', () => this.emit('close'));
	}

	close() {
		this._watcher.close();
	}

	private _onChange(type: string, _filename: string): void {
		if (type === 'rename') {
			this._queueChange();
		} else {
			this.emit('unknown', type);
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
