import { IRule, RecipeArgs } from './Rule.js';
import { MakeDatabase, MakefileInfo, PathInfo } from './MakeDatabase.js';
import { getLogger, Logger, LogLevel } from './logs.js';
import { ATTR_MAKEFILE_PATH } from './names.js';

export interface IMakefileOpts {
	db: MakeDatabase;
	path: PathInfo;
}

type RecipeFunction = (
	args: RecipeArgs,
) => Promise<boolean | void> | boolean | void;

function isRule(
	ruleOrTargets: IRule | string | string[],
): ruleOrTargets is IRule {
	if (typeof ruleOrTargets === 'string') return false;
	return 'targets' in ruleOrTargets;
}

function normalizeToArray(x: string | string[]): string[] {
	if (typeof x === 'string') return [x];
	return x;
}

function normalizeRecipe(
	instance: IRule | undefined,
	fn?: RecipeFunction,
): (args: RecipeArgs) => Promise<boolean> | null {
	if (fn) {
		return async (args: RecipeArgs) => {
			const result = await fn.call(instance, args);
			if (typeof result === 'undefined') return true;
			return result;
		};
	}

	return null;
}

/**
 * A function that defines a {@link Makefile}'s rules
 * @param make The {@link Makefile} whose rules should be defined
 * @returns A boolean value indicating whether the parse was successful. `false` indicates failure, and `true` (or `undefined`) indicates success. A `Promise` may be returned, too.
 */
export type MakefileFn = (
	make: Makefile,
) => (void | boolean) | Promise<void | boolean>;

/**
 * A set of rules describing how to update targets
 * @remarks Passed to a {@link MakefileFn}. Not constructed directly by users; see {@link MakeProgram}
 */
export class Makefile {
	private _path: PathInfo;
	private _db: MakeDatabase;
	private _logger: Logger;

	/**
	 * @internal
	 */
	constructor(opts: IMakefileOpts) {
		this._db = opts.db;
		this._path = opts.path;
		this._logger = getLogger({
			name: 'esmakefile.Makefile',
			attributes: {
				[ATTR_MAKEFILE_PATH]: this._path.path,
			},
		});
	}

	private _info(): MakefileInfo {
		const info = this._db.selectMakefile(this._path);
		if (!info) {
			throw new Error(`Makefile '${this._path}' not found`);
		}
		return info;
	}

	/**
	 * Add a rule from an {@link IRule} instance
	 * @param rule The rule definition
	 */
	public rule(rule: IRule): void;
	/**
	 * Add a rule with targets and a recipe
	 * @param targets The target(s) the recipe updates
	 * @param recipe The recipe used to update `targets`
	 */
	public rule(targets: string | string[], recipe: RecipeFunction): void;
	/**
	 * Add a rule with targets, prerequisites, and an optional recipe
	 * @param targets The target(s) the recipe updates
	 * @param prereqs The prerequisite(s) needed to update `targets`
	 * @param recipe The recipe used to update `targets`
	 */
	public rule(
		targets: string | string[],
		prereqs?: string | string[],
		recipe?: RecipeFunction,
	): void;
	public rule(
		ruleOrTargets: IRule | string | string[],
		prereqsOrRecipe?: string | string[] | RecipeFunction,
		recipeFn?: RecipeFunction,
	): void {
		let targets: string[];
		let prereqs: string[];
		let recipe: (args: RecipeArgs) => Promise<boolean> | null = null;
		if (recipeFn) {
			// targets, prereqs, recipe
			targets = normalizeToArray(ruleOrTargets as string | string[]);
			prereqs = normalizeToArray(prereqsOrRecipe as string | string[]);
			recipe = normalizeRecipe(undefined, recipeFn);
		} else if (typeof prereqsOrRecipe === 'function') {
			// targets, recipe
			targets = normalizeToArray(ruleOrTargets as string | string[]);
			prereqs = [];
			recipe = normalizeRecipe(undefined, prereqsOrRecipe);
		} else if (prereqsOrRecipe) {
			// targets, prereqs
			targets = normalizeToArray(ruleOrTargets as string | string[]);
			prereqs = normalizeToArray(prereqsOrRecipe);
		} else if (isRule(ruleOrTargets)) {
			// rule
			targets = normalizeToArray(ruleOrTargets.targets());
			prereqs = ruleOrTargets.prereqs
				? normalizeToArray(ruleOrTargets.prereqs())
				: [];
			recipe = normalizeRecipe(ruleOrTargets, ruleOrTargets.recipe);
		} else {
			// targets
			targets = normalizeToArray(ruleOrTargets as string | string[]);
			prereqs = [];
		}

		const { isParsed } = this._info();
		if (isParsed) {
			throw new Error('Cannot add a rule to a Makefile that is done parsing');
		}

		if (this._logger.enabled({ level: LogLevel.trace })) {
			const tStr = JSON.stringify(targets);
			const pStr = JSON.stringify(prereqs);
			const fnStr = recipe ? recipe.name || '(+recipe)' : 'null';
			this._logger.trace(`rule(${tStr}, ${pStr}, ${fnStr})`);
		}

		this._db.insertRule({
			targets,
			prereqs,
			recipe,
		});
	}

	/**
	 * Include a nested {@link Makefile}
	 * @param target A path identifying the nested Makefile as a target
	 * @param mkFn The function defining the nested Makefile's rules
	 */
	public include(target: string, mkFn: MakefileFn): void {
		if (this._logger.enabled({ level: LogLevel.trace })) {
			this._logger.trace(`include(${target})`);
		}

		this._db.insertMakefile(target, mkFn);
	}
}
