import { IRecipe, RecipeBuildArgs, MappedPaths, SourcePaths } from './Recipe';
import { mapShape } from './SimpleShape';

import { mkdirSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { BuildPath, isBuildPath, Path } from './Path';
import { Mutex } from './Mutex';

type TargetInfo = {
	buildAsync(results: BuildResults): Promise<boolean>;
	sources: Path[];
	targets: BuildPath[];
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

	addRuntimeSrc(targets: BuildPath[], srcAbs: Set<string>): void {
		for (const t of targets) {
			this._runtimeSrcMap.set(t.rel(), srcAbs);
		}
	}

	runtimeSrc(target: BuildPath): Set<string> {
		const src = this._runtimeSrcMap.get(target.rel());
		if (src) return src;
		return new Set<string>();
	}
}

export class Cookbook {
	private _mutex = new Mutex();
	private _targets = new Map<string, TargetInfo>();
	readonly buildRoot: string;
	readonly srcRoot: string;
	private _buildInProgress = new Map<string, Promise<boolean>>();
	private _prevBuild: BuildResults | null = null;

	constructor(opts?: ICookbookOpts) {
		opts = opts || {};
		this.srcRoot = opts.srcRoot || resolve('.');

		if (!this.srcRoot) {
			throw new Error(`No source root is available.`);
		}

		this.buildRoot = opts.buildRoot || join(this.srcRoot, 'build');
	}

	add(recipe: IRecipe): void {
		const unlock = this._mutex.tryLock();
		if (!unlock) {
			throw new Error('Cannot add while build is in progress');
		}

		try {
			const info = this.normalizeRecipe(recipe);

			for (const p of info.targets) {
				this._targets.set(p.rel(), info);
			}
		} finally {
			unlock();
		}
	}

	targets() {
		return [...this._targets.keys()];
	}

	/**
	 * Top level build function. Runs exclusively
	 * @param target The target to build
	 * @returns A promise that resolves when the build is done
	 */
	async build(target: BuildPath): Promise<boolean> {
		const unlock = await this._mutex.lockAsync();
		let result = false;
		const prevBuildAbs = this.abs(
			BuildPath.from('__gulpachek__/previous-build.json'),
		);

		try {
			const buildResults =
				this._prevBuild ||
				(await BuildResults.readFile(prevBuildAbs)) ||
				new BuildResults();

			await this._findOrStartBuild(target, buildResults);

			await buildResults.writeFile(prevBuildAbs);
			this._prevBuild = buildResults;
		} finally {
			unlock();
		}

		return result;
	}

	private async _findOrStartBuild(
		target: BuildPath,
		buildResults: BuildResults,
	): Promise<boolean> {
		const rel = target.rel();
		const info = this._targets.get(rel);
		if (!info) throw new Error(`Target ${target} does not exist`);

		const currentBuild = this._buildInProgress.get(rel);
		if (currentBuild) {
			return currentBuild;
		} else {
			const { promise, resolve, reject } = makePromise<boolean>();
			this._buildInProgress.set(rel, promise);

			let result = false;

			try {
				result = await this._startBuild(info, target, buildResults);
				resolve(result);
			} catch (err) {
				reject(err);
			} finally {
				this._buildInProgress.delete(rel);
			}

			return result;
		}
	}

	private async _startBuild(
		info: TargetInfo,
		target: BuildPath,
		buildResults: BuildResults,
	): Promise<boolean> {
		// build sources
		for (const src of info.sources) {
			if (isBuildPath(src)) {
				await this._findOrStartBuild(src, buildResults);
			}
		}

		if (
			!needsBuild(
				this.abs(target),
				info.sources.map((p) => this.abs(p)),
				buildResults.runtimeSrc(target),
			)
		)
			return true;

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

	normalizeRecipe(recipe: IRecipe): TargetInfo {
		const sources: Path[] = [];
		const targets: BuildPath[] = [];

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
				(p): p is BuildPath => p instanceof BuildPath,
				(pL) => {
					const p = BuildPath.from(pL);
					targets.push(p);
					return p.abs(this.buildRoot);
				},
			),
		};

		const buildAsync = async (results: BuildResults) => {
			const src = new Set<string>();
			const buildArgs = new RecipeBuildArgs(mappedPaths, src);
			const result = await recipe.buildAsync(buildArgs);
			results.addRuntimeSrc(targets, src);
			return result;
		};

		return { sources, targets, buildAsync };
	}
}

function needsBuild(
	target: string,
	sources: string[],
	runtimeSrc: Set<string>,
): boolean {
	const targetStats = statSync(target, { throwIfNoEntry: false });
	if (!targetStats) return true;

	for (const src of sources) {
		const srcStat = statSync(src);
		if (srcStat.mtimeMs > targetStats.mtimeMs) return true;
	}

	for (const src of runtimeSrc) {
		const srcStat = statSync(src, { throwIfNoEntry: false });
		if (!srcStat) return true; // need to see if still needed
		if (srcStat.mtimeMs > targetStats.mtimeMs) return true;
	}

	return false;
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
