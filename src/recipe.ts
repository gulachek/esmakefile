import { PathLike, Path } from './path';
import { iterate } from './iterableUtil';

export type PathOrString = Path | string;

export type RecipePaths =
	| PathOrString
	| PathOrString[]
	| Record<string, PathOrString>
	| null;

export type MappedRecordPaths<T extends Record<string, PathOrString>> = {
	[P in keyof T]: string;
};

export type MappedPaths<T extends RecipePaths> = T extends null
	? null
	: T extends PathOrString
	? string
	: T extends PathOrString[]
	? string[]
	: T extends Record<string, PathOrString>
	? MappedRecordPaths<T>
	: never;

function isPathOrString(paths: RecipePaths): paths is PathOrString {
	return typeof paths === 'string' || paths instanceof Path;
}

function mapPath(path: PathOrString, root: string): string {
	const src = Path.from(path);
	const joined = src.components.join('/');
	return `${root}/${joined}` as string;
}

function isNull(obj: any): obj is null {
	return obj === null;
}

function mapPaths<T extends RecipePaths>(
	paths: T,
	root: string,
): MappedPaths<T> {
	if (isNull(paths)) {
		return null;
	}

	if (isPathOrString(paths)) {
		return mapPath(paths, root) as MappedPaths<T>;
	}

	if (Array.isArray(paths)) {
		return paths.map((p) => mapPath(p, root)) as MappedPaths<T>;
	}

	const pathsRecord = paths as Record<string, PathOrString>;
	const obj: Record<string, string> = {};
	for (const key in pathsRecord) {
		obj[key] = mapPath(pathsRecord[key], root);
	}
	return obj as MappedPaths<T>;
}

export class RecipePathGroup<T extends RecipePaths> {
	private isSrc: boolean;
	mapped: MappedPaths<T>;

	constructor(type: 'source' | 'target', paths: T) {
		this.isSrc = type === 'source';
		this.mapped = mapPaths(paths, this.isSrc ? '.' : './build');
	}

	paths(): string[] {
		if (isNull(this.mapped)) return [];

		if (typeof this.mapped === 'string') return [this.mapped];

		if (Array.isArray(this.mapped)) return this.mapped;

		const out: string[] = [];
		const mapped = this.mapped as Record<string, string>;
		let key: keyof typeof mapped;
		for (key in mapped) out.push(mapped[key]);
		return out;
	}
}

export interface IRecipeBuildArgs<T extends IRecipe> {
	sources: MappedPaths<ReturnType<T['sources']>>;
	targets: MappedPaths<ReturnType<T['targets']>>;
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
