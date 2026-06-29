import { IRule, RecipeArgs } from './Rule.js';
import { resolve } from 'node:path';
import { MakeDatabase, MakefileInfo } from './MakeDatabase.js';

export interface IMakefileOpts {
	buildRoot?: string;
	srcRoot?: string;
	db: MakeDatabase;
	path: string;
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

export type MakefileFn = (make: Makefile) => void | Promise<void>;

export class Makefile {
	readonly buildRoot: string;
	readonly srcRoot: string;

	private _path: string;
	private _db: MakeDatabase;

	constructor(opts: IMakefileOpts) {
		this.srcRoot = resolve(opts.srcRoot || '.');
		this.buildRoot = resolve(opts.buildRoot || 'build');
		this._db = opts.db;
		this._path = opts.path;
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

		this._db.insertRule({
			targets,
			prereqs,
			recipe,
		});
	}

	public include(target: string, mkFn: MakefileFn): void {
		this._db.insertMakefile(target, mkFn);
	}
}
