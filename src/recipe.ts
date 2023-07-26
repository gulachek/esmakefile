import { PathLike, BuildPathLike } from './Path';
import { SimpleShape, MappedShape } from './SimpleShape';

export type SourcePaths = SimpleShape<PathLike>;

// doesn't make sense to have a null target - would never be built
export type TargetPaths =
	| string
	| BuildPathLike
	| BuildPathLike[]
	| Record<string, BuildPathLike>;

export interface IRecipeBuildArgs<T extends IRecipe> {
	sources: MappedShape<ReturnType<T['sources']>, string>;
	targets: MappedShape<ReturnType<T['targets']>, string>;
}

class GenericRecipe {
	sources(): SourcePaths {
		return null;
	}

	targets(): TargetPaths {
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
	sources(): SourcePaths;

	/**
	 * Target files that are outputs of the recipe's build
	 */
	targets(): TargetPaths;

	/**
	 * Generate targets from sources
	 */
	buildAsync(args: IRecipeBuildArgs<Impl>): Promise<boolean>;
}
