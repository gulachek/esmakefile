import { IRule, RuleID, RecipeArgs } from './Rule.js';
import {
	BuildPathLike,
	PathLike,
	Path,
	isBuildPathLike,
	isPathLike,
	IPathRoots,
} from './Path.js';

import { resolve } from 'node:path';
import { MakeDatabase, MakefileInfo } from './MakeDatabase.js';

export interface IMakefileOpts {
	buildRoot?: string;
	srcRoot?: string;
	db: MakeDatabase;
	path: string;
}

type Prereqs = PathLike | PathLike[];
type Targets = PathLike | PathLike[];

type RecipeFunction = (
	args: RecipeArgs,
) => Promise<boolean | void> | boolean | void;

function isRule(ruleOrTargets: IRule | Targets): ruleOrTargets is IRule {
	if (typeof ruleOrTargets === 'string') return false;
	return 'targets' in ruleOrTargets;
}

function normalizeTargets(t: Targets): Path[] {
	if (isBuildPathLike(t)) return [Path.build(t)];
	if (isPathLike(t)) return [Path.src(t)];
	return t.map((t) => (isBuildPathLike(t) ? Path.build(t) : Path.src(t)));
}

function normalizePrereqs(p: Prereqs): Path[] {
	if (isPathLike(p)) return [Path.src(p)];
	return p.map((p) => Path.src(p));
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
	private _roots: IPathRoots;

	constructor(opts: IMakefileOpts) {
		this.srcRoot = resolve(opts.srcRoot || '.');
		this.buildRoot = resolve(opts.buildRoot || 'build');
		this._roots = {
			src: this.srcRoot,
			build: this.buildRoot,
		};
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

	public rule(rule: IRule): RuleID;
	public rule(targets: Targets, recipe: RecipeFunction): RuleID;
	public rule(
		targets: Targets,
		prereqs?: Prereqs,
		recipe?: RecipeFunction,
	): RuleID;
	public rule(
		ruleOrTargets: IRule | Targets,
		prereqsOrRecipe?: Prereqs | RecipeFunction,
		recipeFn?: RecipeFunction,
	): RuleID {
		let targets: Path[];
		let prereqs: Path[];
		let recipe: (args: RecipeArgs) => Promise<boolean> | null = null;
		if (recipeFn) {
			// targets, prereqs, recipe
			targets = normalizeTargets(ruleOrTargets as Targets);
			prereqs = normalizePrereqs(prereqsOrRecipe as Prereqs);
			recipe = normalizeRecipe(undefined, recipeFn);
		} else if (typeof prereqsOrRecipe === 'function') {
			// targets, recipe
			targets = normalizeTargets(ruleOrTargets as Targets);
			prereqs = [];
			recipe = normalizeRecipe(undefined, prereqsOrRecipe);
		} else if (prereqsOrRecipe) {
			// targets, prereqs
			targets = normalizeTargets(ruleOrTargets as Targets);
			prereqs = normalizePrereqs(prereqsOrRecipe);
		} else if (isRule(ruleOrTargets)) {
			// rule
			targets = normalizeTargets(ruleOrTargets.targets());
			prereqs = ruleOrTargets.prereqs
				? normalizePrereqs(ruleOrTargets.prereqs())
				: [];
			recipe = normalizeRecipe(ruleOrTargets, ruleOrTargets.recipe);
		} else {
			// targets
			targets = normalizeTargets(ruleOrTargets as Targets);
			prereqs = [];
		}

		const { isParsed } = this._info();
		if (isParsed) {
			throw new Error('Cannot add a rule to a Makefile that is done parsing');
		}

		const { id } = this._db.insertRule({
			targets: targets.map((p) => p.rel()),
			prereqs,
			recipe,
		});

		return id;
	}

	public include(target: BuildPathLike, mkFn: MakefileFn): Path {
		const path = Path.build(target);
		this._db.insertMakefile(path.rel(), mkFn);
		return path;
	}

	public abs(path: Path): string {
		return path.abs(this._roots);
	}
}
