import { PathLike, Path } from "./path";

export interface IRecipeBuildArgs {}

/**
 * A recipe to build targets from sources
 */
export interface IRecipe {
  /**
   * Source files that the recipe needs to build
   */
  sources(): PathLike | Iterable<PathLike> | null;

  /**
   * Target files that are outputs of the recipe's build
   */
  targets(): PathLike | Iterable<PathLike> | null;

  /**
   * Generate targets from sources
   */
  buildAsync(args: IRecipeBuildArgs): Promise<boolean>;
}

function isIterable(obj: any): obj is Iterable<any> {
  return obj && typeof obj[Symbol.iterator] === "function";
}

function* iterate<T>(obj: T | Iterable<T>) {
  if (isIterable(obj)) {
    for (const elem of obj) yield elem;
  } else {
    yield obj;
  }
}

/**
 * Get the normalized sources of the recipe
 * @param recipe The recipe whose sources are of interest
 * @returns An array of paths
 */
export function ingredientsOf(recipe: IRecipe): Path[] {
  const sources = recipe.sources();
  if (!sources) return [];

  const paths: Path[] = [];
  for (const src of iterate(sources)) {
    paths.push(Path.from(src));
  }

  return paths;
}
