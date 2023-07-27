import {
	IHasSourcesTargets,
	IRecipe,
	IRecipeBuildArgs,
	SourcePaths,
} from './Recipe';
import { ElemOf, SimpleShape, MappedShape, mapShape } from './SimpleShape';

import { mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { BuildPath, Path, PathType, isPathLike, isBuildPathLike } from './Path';

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

	async build(target: string): Promise<void> {
		const info = this._targets.get(target);
		if (!info) throw new Error(`Target ${target} does not exist`);

		// build sources
		for (const src of info.sources) {
			if (src.type === PathType.build) {
				await this.build(src.rel());
			}
		}

		const targetAbs = BuildPath.from(target).abs(this.buildRoot);
		if (
			!needsBuild(
				targetAbs,
				info.sources.map((p) => this.abs(p)),
			)
		)
			return;

		for (const target of info.targets) {
			mkdirSync(dirname(target.abs(this.buildRoot)), { recursive: true });
		}

		await info.buildAsync();
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

		const rawSources = recipe.sources();
		const rawTargets = recipe.targets();

		type Ret = ElemOf<typeof rawSources>;

		const args: IRecipeBuildArgs<T> = {
			sources: mapShape(
				rawSources,
				(p): p is ElemOf<TSources> => p instanceof Path,
				(pL) => {
					const p = Path.src(pL);
					sources.push(p);
					return this.abs(p);
				},
			),
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
