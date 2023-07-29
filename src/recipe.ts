import { BuildPath, Path } from './Path';
import { SimpleShape, MappedShape } from './SimpleShape';

export type SourcePaths = SimpleShape<Path>;

// doesn't make sense to have a null target - would never be built
export type TargetPaths = SimpleShape<BuildPath>;

type MappedPathsWithSources<T extends IRecipe> = {
	sources: MappedShape<ReturnType<T['sources']>, string>;
	targets: MappedShape<ReturnType<T['targets']>, string>;
};

type MappedPathsWithoutSources<T extends IRecipe> = {
	targets: MappedShape<ReturnType<T['targets']>, string>;
};

export type MappedPaths<T extends IRecipe> = 'sources' extends keyof T
	? MappedPathsWithSources<T>
	: MappedPathsWithoutSources<T>;

export class RecipeBuildArgs {
	private _mappedPaths: MappedPaths<IRecipe>;

	constructor(mappedPaths: MappedPaths<IRecipe>) {
		this._mappedPaths = mappedPaths;
	}

	paths<T extends IRecipe>(): MappedPaths<T> {
		return this._mappedPaths as MappedPaths<T>;
	}
}

/**
 * A recipe to build targets from sources
 */
export interface IRecipe {
	/**
	 * Source files that the recipe needs to build
	 */
	sources?(): SourcePaths;

	/**
	 * Target files that are outputs of the recipe's build
	 */
	targets(): TargetPaths;

	/**
	 * Generate targets from sources
	 */
	buildAsync(args: RecipeBuildArgs): Promise<boolean>;
}
