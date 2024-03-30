import {
	IRule,
	RecipeArgs,
	RecipeFunction,
	rulePrereqs,
	ruleRecipe,
	ruleTargets,
} from './Rule.js';
import { Mutex, UnlockFunction } from './Mutex.js';
import {
	IBuildPath,
	BuildPathLike,
	PathLike,
	Path,
	isBuildPathLike,
	isPathLike,
} from './Path.js';
import {
	Build,
	RuleID,
	RuleInfo,
	TargetInfo,
	isRuleID,
	IBuild,
} from './Build.js';

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
	private _buildLock: UnlockFunction | null = null;
	private _rules: RuleInfo[] = []; // index is RuleID
	private _targets = new Map<string, TargetInfo>();

	private _prevBuild: Build | null = null;

	constructor(opts?: IMakefileOpts) {
		opts = opts || {};
		this.srcRoot = resolve(opts.srcRoot || '.');
		this.buildRoot = resolve(opts.buildRoot || 'build');
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

		const unlock = this._mutex.tryLock();
		if (!unlock) {
			throw new Error('Cannot add while build is in progress');
		}

		try {
			const id: RuleID = this._rules.length;
			const info = this.normalizeRecipe(id, rule);
			const hasRecipe = !!info.recipe;
			this._rules.push(info);

			for (const p of info.targets) {
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
		} finally {
			unlock();
		}
	}

	targets() {
		return [...this._targets.keys()];
	}

	/**
	 * Top level build function. Runs exclusively
	 * @param target The target to build
	 * @param cb Callback to be invoked with IBuild observing the current build
	 * @returns A promise that resolves when the build is done
	 */
	async build(
		target?: IBuildPath,
		cb?: (build: IBuild) => Promise<void>,
	): Promise<boolean> {
		let unlock: UnlockFunction | null = null;
		if (!this._buildLock) {
			unlock = await this._mutex.lockAsync();
		}

		let result = true;

		try {
			const prevBuildAbs = this.abs(
				Path.build('__esmakefile__/previous-build.json'),
			);

			target = target || this._firstTarget();

			this._prevBuild = this._prevBuild || (await Build.readFile(prevBuildAbs));
			const curBuild = new Build({
				rules: this._rules,
				targets: this._targets,
				prevBuild: this._prevBuild,
				buildRoot: this.buildRoot,
				srcRoot: this.srcRoot,
			});

			await cb?.(curBuild);

			result = await curBuild.runAll([target]);

			await curBuild.writeFile(prevBuildAbs);
			this._prevBuild = curBuild;
		} finally {
			unlock && unlock();
		}

		return result;
	}

	private _firstTarget(): IBuildPath {
		for (let id = 0; id < this._rules.length; ++id) {
			const info = this._rules[id];

			for (const t of info.targets) return t;
		}

		throw new Error('No targets exist in Makefile');
	}

	abs(path: Path): string {
		return path.abs({
			src: this.srcRoot,
			build: this.buildRoot,
		});
	}

	normalizeRecipe(id: RuleID, rule: IRule): RuleInfo {
		const prereqs = rulePrereqs(rule);
		const targets = ruleTargets(rule);
		const innerRecipe = ruleRecipe(rule);

		let recipe: (build: Build) => Promise<boolean> | null = null;
		if (innerRecipe) {
			recipe = async (build: Build) => {
				const src = new Set<string>();
				const stream = build.createLogStream(id);
				const recipeArgs = new RecipeArgs(this, src, stream);

				const result = await innerRecipe(recipeArgs);

				build.addPostreq(id, src);

				return result;
			};
		}

		const name = id.toString(); // TODO - remove
		return { sources: prereqs, targets, recipe, name };
	}
}
