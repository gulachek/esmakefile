import { Path, PathLike } from './Path';
import { SimpleShape, MappedShape } from './SimpleShape';

export type RecipePaths = SimpleShape<PathLike>;

export interface IRecipeBuildArgs<T extends IRecipe> {
	sources: MappedShape<ReturnType<T['sources']>, string>;
	targets: MappedShape<ReturnType<T['targets']>, string>;
}

class GenericRecipe {
	sources(): RecipePaths {
		return null;
	}

	targets(): RecipePaths {
		return null;
	}

	buildAsync(_args: IRecipeBuildArgs<GenericRecipe>): Promise<boolean> {
		return Promise.resolve(false);
	}
}

/**
 * A recipe to build targets from sources
 */
export interface IRecipe<Impl extends IRecipe = GenericRecipe> {
	/**
	 * Source files that the recipe needs to build
	 */
	sources(): RecipePaths;

	/**
	 * Target files that are outputs of the recipe's build
	 */
	targets(): RecipePaths;

	/**
	 * Generate targets from sources
	 */
	buildAsync(args: IRecipeBuildArgs<Impl>): Promise<boolean>;
}
