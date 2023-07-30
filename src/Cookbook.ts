import { IRecipe, RecipeBuildArgs, MappedPaths, SourcePaths } from './Recipe';
import { mapShape } from './SimpleShape';

import { mkdirSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { BuildPath, isBuildPath, Path } from './Path';
import { Mutex } from './Mutex';

type TargetInfo = {
	buildAsync(): Promise<boolean>;
	sources: Path[];
	targets: BuildPath[];
};

export interface ICookbookOpts {
	buildRoot?: string;
	srcRoot?: string;
}

class BuildResults {
	static async readFile(abs: string): Promise<BuildResults | null> {
		try {
			const contents = await readFile(abs, 'utf8');
			const json = JSON.parse(contents);
			return json as BuildResults;
		} catch {
			return null;
		}
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
			/*
			this._prevBuild =
				this._prevBuild || (await BuildResults.readFile(prevBuildAbs));
			 */

			const results = await this._findOrStartBuild(target);
		} finally {
			unlock();
		}

		return result;
	}

	private async _findOrStartBuild(target: BuildPath): Promise<BuildResults> {
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
				const targetAbs = target.abs(this.buildRoot);
				result = await this._startBuild(info, targetAbs);
				resolve(result);
			} catch (err) {
				reject(err);
			} finally {
				this._buildInProgress.delete(rel);
			}

			return new BuildResults();
		}
	}

	private async _startBuild(
		info: TargetInfo,
		targetAbs: string,
	): Promise<boolean> {
		// build sources
		for (const src of info.sources) {
			if (isBuildPath(src)) {
				await this._findOrStartBuild(src);
			}
		}

		if (
			!needsBuild(
				targetAbs,
				info.sources.map((p) => this.abs(p)),
			)
		)
			return true;

		for (const target of info.targets) {
			mkdirSync(dirname(target.abs(this.buildRoot)), { recursive: true });
		}

		return info.buildAsync();
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

		const buildAsync = () => {
			const src = new Set<string>();
			const buildArgs = new RecipeBuildArgs(mappedPaths, src);
			return recipe.buildAsync(buildArgs);
		};

		return { sources, targets, buildAsync };
	}
}

function needsBuild(target: string, sources: string[]): boolean {
	const targetStats = statSync(target, { throwIfNoEntry: false });
	if (!targetStats) return true;

	for (const src of sources) {
		const srcStat = statSync(src);
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
