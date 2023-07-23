import { Path, PathLike } from './Path';

export type RecipePaths =
	| PathLike
	| PathLike[]
	| Record<string, PathLike>
	| null;

export type MappedRecordPaths<T extends Record<string, PathLike>, TValue> = {
	[P in keyof T]: TValue;
};

export type MappedPaths<T extends RecipePaths, TValue> = T extends null
	? null
	: T extends PathLike
	? TValue
	: T extends PathLike[]
	? TValue[]
	: T extends Record<string, PathLike>
	? MappedRecordPaths<T, TValue>
	: never;

function isPathLike(paths: RecipePaths): paths is PathLike {
	return typeof paths === 'string' || paths instanceof Path;
}

function isNull(obj: any): obj is null {
	return obj === null;
}

export function mapPaths<T extends RecipePaths, TValue>(
	paths: T,
	fn: (p: PathLike) => TValue,
): MappedPaths<T, TValue> {
	if (isNull(paths)) {
		return null;
	}

	if (isPathLike(paths)) {
		return fn(paths) as MappedPaths<T, TValue>;
	}

	if (Array.isArray(paths)) {
		return paths.map((p) => fn(p)) as MappedPaths<T, TValue>;
	}

	const pathsRecord = paths as Record<string, PathLike>;
	const obj: Record<string, TValue> = {};
	for (const key in pathsRecord) {
		obj[key] = fn(pathsRecord[key]);
	}
	return obj as MappedPaths<T, TValue>;
}

export function* iteratePaths<T extends RecipePaths>(
	paths: T,
): Generator<PathLike> {
	if (isNull(paths)) return;

	if (isPathLike(paths)) {
		yield paths;
		return;
	}

	if (Array.isArray(paths)) {
		for (const p of paths) yield p;
		return;
	}

	let key: keyof T;
	for (key in paths) {
		yield paths[key] as PathLike;
	}
}

/*
export class RecipePathGroup<T extends RecipePaths> {
	private paths: T;
	mapped: MappedPaths<T, string>;

	constructor( paths: T) {
		this.mapped = mapPaths(paths, (p) => mapPath(p, root));
		this.pathObjs =  
	}

	relativePaths(): string[] {
		if (isNull(this.paths)) return [];

		if (typeof this.mapped === 'string') return [this.mapped];

		if (Array.isArray(this.mapped)) return this.mapped;

		const out: string[] = [];
		const mapped = this.mapped as Record<string, string>;
		let key: keyof typeof mapped;
		for (key in mapped) out.push(mapped[key]);
		return out;
	}
}
*/

export interface IRecipeBuildArgs<T extends IRecipe> {
	sources: MappedPaths<ReturnType<T['sources']>, string>;
	targets: MappedPaths<ReturnType<T['targets']>, string>;
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
