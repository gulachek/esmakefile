import { IHasSourcesTargets, IRecipe, IRecipeBuildArgs } from './Recipe';
import { ElemOf, mapShape } from './SimpleShape';

import { mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { BuildPath, isBuildPath, Path, PathType } from './Path';

type TargetInfo = {
	buildAsync(): Promise<boolean>;
	sources: Path[];
	targets: BuildPath[];
};

export interface ICookbookOpts {
	buildRoot?: string;
	srcRoot?: string;
}

export class Cookbook {
	private _targets = new Map<string, TargetInfo>();
	readonly buildRoot: string;
	readonly srcRoot: string;
	private _buildInProgress = new Map<string, Promise<boolean>>();

	constructor(opts?: ICookbookOpts) {
		opts = opts || {};
		this.srcRoot = opts.srcRoot || resolve('.');

		if (!this.srcRoot) {
			throw new Error(`No source root is available.`);
		}

		this.buildRoot = opts.buildRoot || join(this.srcRoot, 'build');
	}

	add<T extends IHasSourcesTargets>(recipe: IRecipe<T>): void {
		const info = this.normalizeRecipe(recipe);

		for (const p of info.targets) {
			this._targets.set(p.rel(), info);
		}
	}

	targets() {
		return [...this._targets.keys()];
	}

	async build(target: BuildPath): Promise<boolean> {
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

			return result;
		}
	}

	private async _startBuild(
		info: TargetInfo,
		targetAbs: string,
	): Promise<boolean> {
		// build sources
		for (const src of info.sources) {
			if (isBuildPath(src)) {
				await this.build(src);
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

	normalizeRecipe<T extends IHasSourcesTargets>(
		recipe: IRecipe<T>,
	): TargetInfo {
		const sources: Path[] = [];
		const targets: BuildPath[] = [];

		type TSources = ReturnType<T['sources']>;
		type TTargets = ReturnType<T['targets']>;

		const rawSources: TSources | undefined = recipe.sources?.();
		const rawTargets = recipe.targets();

		const args: IRecipeBuildArgs<T> = {
			sources:
				rawSources &&
				(mapShape(
					rawSources,
					(p): p is ElemOf<TSources> => p instanceof Path,
					(pL) => {
						const p = Path.src(pL);
						sources.push(p);
						return this.abs(p);
					},
				) as IRecipeBuildArgs<T>['sources']),
			targets: mapShape(
				rawTargets,
				(p): p is ElemOf<TTargets> => p instanceof BuildPath,
				(pL) => {
					const p = BuildPath.from(pL);
					targets.push(p);
					return p.abs(this.buildRoot);
				},
			),
		};

		const buildAsync = () => {
			return recipe.buildAsync(args);
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
