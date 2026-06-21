import {
	IRule,
	RecipeFunction,
	ruleTargets,
	RuleID,
	isRuleID,
	rulePrereqs,
	ruleRecipe,
} from './Rule.js';
import {
	IBuildPath,
	BuildPathLike,
	PathLike,
	Path,
	isBuildPathLike,
	isPathLike,
	IPathRoots,
} from './Path.js';

import { resolve } from 'node:path';
import { MakeDatabase, MakefileInfo, TargetInfo } from './MakeDatabase.js';

export interface IMakefileOpts {
	buildRoot?: string;
	srcRoot?: string;
	db: MakeDatabase;
	path: IBuildPath;
}

type Prereqs = PathLike | PathLike[];
type Targets = BuildPathLike | BuildPathLike[];

function isRule(ruleOrTargets: IRule | Targets): ruleOrTargets is IRule {
	if (typeof ruleOrTargets === 'string') return false;
	return 'targets' in ruleOrTargets;
}

function normalizeTargets(t: Targets): IBuildPath | IBuildPath[] {
	if (isBuildPathLike(t)) return Path.build(t);

	return t.map((t) => Path.build(t));
}

export type MakefileFn = (make: Makefile) => void | Promise<void>;

export class Makefile {
	readonly buildRoot: string;
	readonly srcRoot: string;

	private _path: IBuildPath;
	private _db: MakeDatabase;
	private _roots: IPathRoots;
	private _targets = new Map<string, TargetInfo>();

	constructor(opts: IMakefileOpts) {
		this.srcRoot = resolve(opts.srcRoot || '.');
		this.buildRoot = resolve(opts.buildRoot || 'build');
		this._roots = {
			src: this.srcRoot,
			build: this.buildRoot,
		};
		this._db = opts.db;
		this._path = opts.path;

		// register with db
		this._db.insertMakefile(this._path);
	}

	private _info(): MakefileInfo {
		const info = this._db.selectMakefile(this._path);
		if (!info) {
			throw new Error(`Makefile '${this._path.rel()}' not found`);
		}
		return info;
	}

	public targets(): string[] {
		return [...this._targets.keys()];
	}

	/**
	 * @internal
	 */
	public target(path: BuildPathLike): TargetInfo {
		const rel = Path.build(path).rel();
		const info = this._targets.get(rel);
		if (!info) {
			throw new Error(`Target with path '${rel}' not defined in Makefile`);
		}

		return info;
	}

	public hasTarget(target: BuildPathLike): boolean {
		const path = Path.build(target);
		return !!this._targets.get(path.rel());
	}

	public add(rule: IRule): RuleID;
	public add(targets: Targets, recipe: RecipeFunction): RuleID;
	public add(
		targets: Targets,
		prereqs: Prereqs,
		recipe?: RecipeFunction,
	): RuleID;
	public add(
		ruleOrTargets: IRule | Targets,
		prereqsOrRecipe?: Prereqs | RecipeFunction,
		recipeFn?: RecipeFunction,
	): RuleID {
		const norm = this.normalizePrereqs.bind(this);

		let rule: IRule;
		if (recipeFn) {
			// targets, prereqs, recipe
			rule = {
				targets() {
					return normalizeTargets(ruleOrTargets as Targets);
				},
				prereqs() {
					return norm(prereqsOrRecipe as Prereqs);
				},
				recipe: recipeFn,
			};
		} else if (typeof prereqsOrRecipe === 'function') {
			// targets, recipe
			rule = {
				targets() {
					return normalizeTargets(ruleOrTargets as Targets);
				},
				recipe: prereqsOrRecipe,
			};
		} else if (prereqsOrRecipe) {
			// targets, prereqs
			rule = {
				targets() {
					return normalizeTargets(ruleOrTargets as Targets);
				},
				prereqs() {
					return norm(prereqsOrRecipe);
				},
			};
		} else if (isRule(ruleOrTargets)) {
			// rule
			rule = ruleOrTargets;
		} else {
			// targets
			throw new Error(`Added targets without any prereqs or recipe`);
		}

		const { isParsed } = this._info();
		if (isParsed) {
			throw new Error('Cannot add() to a Makefile that is done parsing');
		}

		const hasRecipe = !!rule.recipe;
		const { id } = this._db.insertRule({
			targets: ruleTargets(rule),
			prereqs: rulePrereqs(rule),
			recipe: ruleRecipe(rule),
		});

		for (const p of ruleTargets(rule)) {
			const rel = p.rel();
			let targetInfo = this._targets.get(rel);
			if (!targetInfo) {
				targetInfo = {
					rules: new Set(),
					recipeRule: null,
				};
				this._targets.set(rel, targetInfo);
			}

			if (hasRecipe) {
				if (isRuleID(targetInfo.recipeRule))
					throw new Error(
						`Target '${rel}' already has a recipe specified. Cannot add another one.`,
					);

				targetInfo.recipeRule = id;
			}

			targetInfo.rules.add(id);
		}

		return id;
	}

	public include(target: BuildPathLike, mkFn: MakefileFn): IBuildPath {
		const path = Path.build(target);
		mkFn(this);
		return path;
	}

	private normalizeIndividualPrereq(prereq: PathLike): Path {
		if (typeof prereq === 'string') {
			if (this.hasTarget(prereq)) {
				return Path.build(prereq);
			} else {
				return Path.src(prereq);
			}
		} else {
			return prereq;
		}
	}

	private normalizePrereqs(p: Prereqs): Path | Path[] {
		if (isPathLike(p)) return this.normalizeIndividualPrereq(p);
		return p.map((p) => this.normalizeIndividualPrereq(p));
	}

	public abs(path: Path): string {
		return path.abs(this._roots);
	}
}
