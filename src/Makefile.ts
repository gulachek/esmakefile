import { IRule, RecipeFunction, ruleTargets } from './Rule.js';
import { Lock, Mutex } from './Mutex.js';
import {
	IBuildPath,
	BuildPathLike,
	PathLike,
	Path,
	isBuildPathLike,
	isPathLike,
} from './Path.js';
import { Build, IBuild } from './Build.js';

import { resolve } from 'node:path';

export interface IMakefileOpts {
	buildRoot?: string;
	srcRoot?: string;
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

function normalizePrereqs(p: Prereqs): Path | Path[] {
	if (isPathLike(p)) return Path.src(p);
	return p.map((p) => Path.src(p));
}

export class Makefile {
	readonly buildRoot: string;
	readonly srcRoot: string;

	private _mutex = new Mutex();
	private _rules: IRule[] = []; // index is RuleID
	private _targets = new Map<string, TargetInfo>();

	private _prevBuild: Build | null = null;

	constructor(opts?: IMakefileOpts) {
		opts = opts || {};
		this.srcRoot = resolve(opts.srcRoot || '.');
		this.buildRoot = resolve(opts.buildRoot || 'build');
	}

	/**
	 * Lock Makefile for building
	 * @returns A Promise that resolves with a Lock object when available
	 */
	lockAsync(): Promise<Lock> {
		return this._mutex.lockAsync();
	}

	public *rules(): Generator<{ rule: IRule; id: RuleID }> {
		for (let id = 0; id < this._rules.length; ++id) {
			yield { id, rule: this._rules[id] };
		}
	}

	public rule(id: RuleID): IRule {
		if (id >= this._rules.length) {
			throw new Error(`Rule with ID ${id} does not exist`);
		}

		return this._rules[id];
	}

	// TODO - make { path: IBuildPath, target: TargetInfo }
	public targets(): string[] {
		return [...this._targets.keys()];
	}

	public target(path: BuildPathLike): TargetInfo {
		const rel = Path.build(path).rel();
		const info = this._targets.get(rel);
		if (!info) {
			throw new Error(`Target with path '${rel}' not defined in Makefile`);
		}

		return info;
	}

	add(rule: IRule): RuleID;
	add(targets: Targets, recipe: RecipeFunction): RuleID;
	add(targets: Targets, prereqs: Prereqs, recipe?: RecipeFunction): RuleID;
	add(
		ruleOrTargets: IRule | Targets,
		prereqsOrRecipe?: Prereqs | RecipeFunction,
		recipeFn?: RecipeFunction,
	): RuleID {
		let rule: IRule;
		if (recipeFn) {
			// targets, prereqs, recipe
			rule = {
				targets() {
					return normalizeTargets(ruleOrTargets as Targets);
				},
				prereqs() {
					return normalizePrereqs(prereqsOrRecipe as Prereqs);
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
					return normalizePrereqs(prereqsOrRecipe);
				},
			};
		} else if (isRule(ruleOrTargets)) {
			// rule
			rule = ruleOrTargets;
		} else {
			// targets
			throw new Error(`Added targets without any prereqs or recipe`);
		}

		using lock = this._mutex.tryLock();
		if (!lock) {
			throw new Error('Cannot add while Makefile is locked');
		}

		const id: RuleID = this._rules.length;
		const hasRecipe = !!rule.recipe;
		this._rules.push(rule);

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

	public get defaultGoal(): IBuildPath {
		return this._firstTarget();
	}

	private _firstTarget(): IBuildPath {
		for (let id = 0; id < this._rules.length; ++id) {
			const rule = this._rules[id];

			for (const t of ruleTargets(rule)) return t;
		}

		throw new Error('No targets exist in Makefile');
	}

	abs(path: Path): string {
		return path.abs({
			src: this.srcRoot,
			build: this.buildRoot,
		});
	}
}

export type RuleID = number;

export function isRuleID(id: unknown): id is RuleID {
	return typeof id === 'number';
}

export type TargetInfo = {
	rules: Set<RuleID>;
	recipeRule: RuleID | null;
};
