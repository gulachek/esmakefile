import {
	IRecipe,
	RecipePaths,
	RecipePathGroup,
	IRecipeBuildArgs,
} from './Recipe';

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

type TargetInfo = {
	recipe: IRecipe;
	sources: RecipePathGroup<RecipePaths>;
	targets: RecipePathGroup<RecipePaths>;
};

export interface ICookbookOpts {
	buildRoot?: string;
	srcRoot?: string;
}

function mainExecutableDir(): string {
	return require && require.main && require.main.path;
}

export class Cookbook {
	private _targets = new Map<string, TargetInfo>();
	private _buildRoot: string;
	private _srcRoot: string;

	constructor(opts?: ICookbookOpts) {
		opts = opts || {};
		this._srcRoot = opts.srcRoot || mainExecutableDir();

		if (!this._srcRoot) {
			throw new Error(`No source root is available.`);
		}

		this._buildRoot = opts.buildRoot || join(this._srcRoot, 'build');
	}

	add(recipe: IRecipe): void {
		const sources = new RecipePathGroup(this._srcRoot, recipe.sources());
		const targets = new RecipePathGroup(this._buildRoot, recipe.targets());

		for (const p of targets.relativePaths()) {
			this._targets.set(p, {
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
			sources: info.sources.mapped,
			targets: info.targets.mapped,
		};

		info.targets.relativePaths().forEach((p) => {
			mkdirSync(dirname(p), { recursive: true });
		});

		await info.recipe.buildAsync(args);
	}
}
