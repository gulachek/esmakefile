import { IRule, RecipeFunction, ruleTargets } from './Rule.js';
import { Lock, Mutex } from './Mutex.js';
import {
	IBuildPath,
	BuildPathLike,
	PathLike,
	Path,
	isBuildPathLike,
	isPathLike,
	IPathRoots,
} from './Path.js';

import { stat, readFile, writeFile, mkdir } from 'node:fs/promises';

import { resolve, dirname } from 'node:path';

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

export class Makefile {
	readonly buildRoot: string;
	readonly srcRoot: string;

	private _roots: IPathRoots;
	private _mutex = new Mutex();
	private _rules: IRule[] = []; // index is RuleID
	private _targets = new Map<string, TargetInfo>();
	private _writtenMtime: Date | null = null;

	constructor(opts?: IMakefileOpts) {
		opts = opts || {};
		this.srcRoot = resolve(opts.srcRoot || '.');
		this.buildRoot = resolve(opts.buildRoot || 'build');
		this._roots = {
			src: this.srcRoot,
			build: this.buildRoot,
		};
	}

	/**
	 * For internal use only. Lock Makefile for building
	 * @internal
	 * @returns A Promise that resolves with a Lock object when available
	 */
	public _lockAsync(): Promise<Lock> {
		return this._mutex.lockAsync();
	}

	/**
	 * For internal use only. Loads previously saved state
	 * @internal
	 */
	public async _load(): Promise<void> {
		const abs = this.abs(statePath);

		try {
			const { mtime } = await stat(abs);
			if (this._writtenMtime && this._writtenMtime >= mtime) {
				return;
			}
		} catch (_err) {
			return;
		}

		const contents = await readFile(this.abs(statePath), 'utf8');

		const state = JSON.parse(contents) as IStateFile;

		if (typeof state.schemaVersion !== 'number') {
			throw new Error(
				'schemaVersion not found as number property in state file',
			);
		}

		if (schemaVersion !== state.schemaVersion) {
			throw new Error(
				'Previously built with an incompatible version of esmakefile. Clean build directory before attempting to rebuild or revert to previous version of esmakefile.',
			);
		}

		for (const rule of state.rules) {
			const recipe = rule.recipe;

			if (!recipe) {
				continue;
			}

			for (const t of rule.targets) {
				const info = this._targets.get(t);
				if (!info) {
					continue;
				}

				info.postreqs = recipe.postreqs;
			}
		}
	}

	/**
	 * For internal use only. Saves gathered state
	 * @internal
	 */
	public async _save(recipeResults: RecipeResults[]): Promise<void> {
		const rules: IStateFileRule[] = [];

		for (const { ruleId, postreqs } of recipeResults) {
			const rule = this._rules[ruleId];
			const targets = ruleTargets(rule).map((t) => t.rel());

			for (const t of targets) {
				const info = this._targets.get(t);
				info.postreqs = postreqs;
			}

			rules.push({
				targets,
				recipe: {
					postreqs,
				},
			});
		}

		const state: IStateFile = {
			schemaVersion,
			rules,
		};

		const abs = this.abs(statePath);
		await mkdir(dirname(abs), { recursive: true });
		await writeFile(abs, JSON.stringify(state), 'utf8');
		this._writtenMtime = new Date();
	}

	/**
	 * @internal
	 */
	public *rules(): Generator<{ rule: IRule; id: RuleID }> {
		for (let id = 0; id < this._rules.length; ++id) {
			yield { id, rule: this._rules[id] };
		}
	}

	/**
	 * @internal
	 */
	public rule(id: RuleID): IRule {
		if (id >= this._rules.length) {
			throw new Error(`Rule with ID ${id} does not exist`);
		}

		return this._rules[id];
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
		const self = this;

		let rule: IRule;
		if (recipeFn) {
			// targets, prereqs, recipe
			rule = {
				targets() {
					return normalizeTargets(ruleOrTargets as Targets);
				},
				prereqs() {
					return self.normalizePrereqs(prereqsOrRecipe as Prereqs);
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
					return self.normalizePrereqs(prereqsOrRecipe);
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

	private _firstTarget(): IBuildPath {
		for (let id = 0; id < this._rules.length; ++id) {
			const rule = this._rules[id];

			for (const t of ruleTargets(rule)) return t;
		}

		throw new Error('No targets exist in Makefile');
	}

	public abs(path: Path): string {
		return path.abs(this._roots);
	}
}

export type RuleID = number;

export function isRuleID(id: unknown): id is RuleID {
	return typeof id === 'number';
}

export type TargetInfo = {
	rules: Set<RuleID>;
	recipeRule: RuleID | null;
	postreqs?: string[];
};

export type RecipeResults = {
	ruleId: RuleID;
	postreqs: string[];
};

const statePath = Path.build('__esmakefile__/state.json');
const schemaVersion = 1;

interface IStateFile {
	schemaVersion: number;
	rules: IStateFileRule[];
}

interface IStateFileRule {
	targets: string[];
	recipe?: IStateFileRecipe;
}

interface IStateFileRecipe {
	postreqs: string[];
}
