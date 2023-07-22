import {
	IRecipe,
	RecipePaths,
	RecipePathGroup,
	IRecipeBuildArgs,
} from './recipe';

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

type TargetInfo = {
	recipe: IRecipe;
	sources: RecipePathGroup<RecipePaths>;
	targets: RecipePathGroup<RecipePaths>;
};

export class Cookbook {
	private _targets = new Map<string, TargetInfo>();

	add(recipe: IRecipe): void {
		const sources = new RecipePathGroup('source', recipe.sources());
		const targets = new RecipePathGroup('target', recipe.targets());

		for (const p of targets.paths()) {
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

		info.targets.paths().forEach((p) => {
			mkdirSync(dirname(p), { recursive: true });
		});

		await info.recipe.buildAsync(args);
	}
}
