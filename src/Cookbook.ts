import { IRecipe, RecipePaths, IRecipeBuildArgs } from './Recipe';
import { iterateShape, mapShape } from './SimpleShape';

import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { BuildPath, Path, PathType, isPathLike } from './Path';

type TargetInfo = {
	recipe: IRecipe;
	sources: RecipePaths;
	targets: RecipePaths;
};

export interface ICookbookOpts {
	buildRoot?: string;
	srcRoot?: string;
}

export class Cookbook {
	private _targets = new Map<string, TargetInfo>();
	private _buildRoot: string;
	private _srcRoot: string;

	constructor(opts?: ICookbookOpts) {
		opts = opts || {};
		this._srcRoot = opts.srcRoot || resolve('.');

		if (!this._srcRoot) {
			throw new Error(`No source root is available.`);
		}

		this._buildRoot = opts.buildRoot || join(this._srcRoot, 'build');
	}

	add(recipe: IRecipe): void {
		const sources = recipe.sources();
		const targets = recipe.targets();

		for (const p of iterateShape(targets, isPathLike)) {
			let buildPath: BuildPath;
			if (typeof p === 'string') {
				buildPath = BuildPath.from(p);
			} else if (p instanceof Path) {
				if (p.type !== PathType.build) {
					throw new Error('Target can only be build paths');
				}

				buildPath = new BuildPath(p.components);
			} else {
				throw new Error(`Unexpected path type ${p}`);
			}

			this._targets.set(buildPath.rel(), {
				recipe,
				sources,
				targets,
			});
		}
	}

	targets() {
		return [...this._targets.keys()];
	}

	async build(target: string): Promise<void> {
		const info = this._targets.get(target);
		if (!info) throw new Error(`Target ${target} does not exist`);

		const args: IRecipeBuildArgs<IRecipe> = {
			sources: mapShape(info.sources, isPathLike, (p) =>
				Path.src(p).abs(this._srcRoot),
			),
			targets: mapShape(info.targets, isPathLike, (p) =>
				BuildPath.from(p).abs(this._buildRoot),
			),
		};

		for (const p of iterateShape(info.targets, isPathLike)) {
			const abs = BuildPath.from(p).abs(this._buildRoot);
			mkdirSync(dirname(abs), { recursive: true });
		}

		await info.recipe.buildAsync(args);
	}
}
