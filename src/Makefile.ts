import { IRule, RecipeArgs } from './Rule.js';
import { MakeDatabase, MakefileInfo, PathInfo } from './MakeDatabase.js';
import { getLogger, Logger, LogLevel } from './logs.js';
import { ATTR_MAKEFILE_PATH } from './names.js';

export interface IMakefileOpts {
	db: MakeDatabase;
	path: PathInfo;
}

type Prereqs = string | string[];
type Targets = string | string[];

type RecipeFunction = (
	args: RecipeArgs,
) => Promise<boolean | void> | boolean | void;

function isRule(ruleOrTargets: IRule | Targets): ruleOrTargets is IRule {
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

export type MakefileFn = (
	make: Makefile,
) => (void | boolean) | Promise<void | boolean>;

export class Makefile {
	private _path: PathInfo;
	private _db: MakeDatabase;
	private _logger: Logger;

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

	public rule(rule: IRule): void;
	public rule(targets: Targets, recipe: RecipeFunction): void;
	public rule(
		targets: Targets,
		prereqs?: Prereqs,
		recipe?: RecipeFunction,
	): void;
	public rule(
		ruleOrTargets: IRule | Targets,
		prereqsOrRecipe?: Prereqs | RecipeFunction,
		recipeFn?: RecipeFunction,
	): void {
		let targets: string[];
		let prereqs: string[];
		let recipe: (args: RecipeArgs) => Promise<boolean> | null = null;
		if (recipeFn) {
			// targets, prereqs, recipe
			targets = normalizeToArray(ruleOrTargets as Targets);
			prereqs = normalizeToArray(prereqsOrRecipe as Prereqs);
			recipe = normalizeRecipe(undefined, recipeFn);
		} else if (typeof prereqsOrRecipe === 'function') {
			// targets, recipe
			targets = normalizeToArray(ruleOrTargets as Targets);
			prereqs = [];
			recipe = normalizeRecipe(undefined, prereqsOrRecipe);
		} else if (prereqsOrRecipe) {
			// targets, prereqs
			targets = normalizeToArray(ruleOrTargets as Targets);
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
			targets = normalizeToArray(ruleOrTargets as Targets);
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

	public include(target: string, mkFn: MakefileFn): void {
		if (this._logger.enabled({ level: LogLevel.trace })) {
			this._logger.trace(`include(${target})`);
		}

		this._db.insertMakefile(target, mkFn);
	}
}
