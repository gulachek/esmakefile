import { BuildPath, Path } from './Path';
import { SimpleShape, MappedShape } from './SimpleShape';

export type SourcePaths = SimpleShape<Path>;

// doesn't make sense to have a null target - would never be built
export type TargetPaths = SimpleShape<BuildPath>;

export interface IHasSourcesTargets {
	sources(): SourcePaths;
	targets(): TargetPaths;
}

export interface IRecipeBuildArgs<T extends IHasSourcesTargets> {
	sources: MappedShape<ReturnType<T['sources']>, string>;
	targets: MappedShape<ReturnType<T['targets']>, string>;
}

/**
 * A recipe to build targets from sources
 */
export interface IRecipe<Impl extends IHasSourcesTargets>
	extends IHasSourcesTargets {
	/**
	 * Source files that the recipe needs to build
	 */
	sources(): ReturnType<Impl['sources']>;

	/**
	 * Target files that are outputs of the recipe's build
	 */
	targets(): ReturnType<Impl['targets']>;

	/**
	 * Generate targets from sources
	 */
	buildAsync(args: IRecipeBuildArgs<Impl>): Promise<boolean>;
}
