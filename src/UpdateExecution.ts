import { Makefile, TargetInfo } from './Makefile.js';
import {
	IRule,
	rulePrereqs,
	ruleTargets,
	ruleRecipe,
	RecipeArgs,
	RuleID,
	isRuleID,
} from './Rule.js';
import { IBuildPath, IPathRoots, Path } from './Path.js';

import { mkdir } from 'node:fs/promises';
import { statSync, Stats } from 'node:fs';
import { resolve } from 'node:path';
import { CycleDetector } from './CycleDetector.js';
import { Logger, getLogger } from './logs.js';
import {
	EVENT_RECIPE_BEGIN,
	EVENT_RECIPE_EXCEPTION,
	EVENT_TARGET_STALE_NO_RECIPE,
	EVENT_TARGET_UP_TO_DATE,
} from './names.js';

type RecipeInProgressInfo = {
	complete: false;

	/** performance.now() when recipe() was started */
	startTime: number;

	completePromise: Promise<RecipeCompleteInfo>;
};

type RecipeCompleteInfo = {
	complete: true;

	/** performance.now() when recipe() was started */
	startTime: number;

	/** performance.now() when recipe() resolved */
	endTime: number;

	/** return val of recipe() */
	result: boolean;

	/** if recipe() threw an exception */
	exception?: Error;
};

type TargetCompleteInfo = {
	result: boolean;
};

type RecipeBuildInfo = RecipeInProgressInfo | RecipeCompleteInfo;

export class UpdateExecution {
	private _roots: IPathRoots;
	private _mk: Makefile;

	private _rules = new Map<RuleID, RuleInfo>();

	private _targets = new Map<string, TargetInfo>();
	private _builtTargets = new Map<string, TargetCompleteInfo>();

	private _info = new Map<RuleID, RecipeBuildInfo>();
	private _logger: Logger;

	constructor(mk: Makefile) {
		this._mk = mk;
		this._roots = { build: mk.buildRoot, src: mk.srcRoot };
		this._logger = getLogger({ name: 'esmakefile.Build' });

		for (const { rule, id } of mk.rules()) {
			this._rules.set(id, this.normalizeRule(id, rule));
		}
	}

	private normalizeRule(_: RuleID, rule: IRule): RuleInfo {
		const prereqs = rulePrereqs(rule);
		const targets = ruleTargets(rule);
		const innerRecipe = ruleRecipe(rule);

		let recipe: () => Promise<boolean> | null = null;
		if (innerRecipe) {
			recipe = async () => {
				const src = new Set<string>();
				const recipeArgs = new RecipeArgs(this._roots, src);

				const result = await innerRecipe(recipeArgs);

				return result;
			};
		}

		return { sources: prereqs, targets, recipe };
	}

	private _reportCycle(): boolean {
		const cd = new CycleDetector();

		for (const [t, targetInfo] of this._targets) {
			const tPath = Path.build(t);
			for (const rule of targetInfo.rules) {
				const { sources } = this._rules.get(rule);
				for (const p of sources) {
					if (p.isBuildPath()) {
						cd.addEdge(tPath, p);
					}
				}
			}
		}

		const cycle = cd.findCycle();
		if (cycle) {
			const pathStr = cycle.path.map((p) => p.rel()).join(' -> ');
			this._logger.error(`Circular dependency detected: ${pathStr}`);
			return true;
		}

		return false;
	}

	/**
	 * Top level build function. Runs exclusively
	 * @param goal The goal to update
	 * @returns A promise that resolves when the build is done
	 */
	async run(goal: IBuildPath): Promise<boolean> {
		const { src, build } = this._roots;
		let stats: Stats | null = null;
		try {
			stats = statSync(src, { throwIfNoEntry: false });
		} catch (_) {
			// will pick up that stats don't exist right below
		}

		if (!(stats && stats.isDirectory())) {
			this._logger.error(
				`Source directory '${src}' is not a readable directory`,
			);
			return false;
		}

		const esmakefileDir = resolve(build, '__esmakefile__');

		try {
			await mkdir(esmakefileDir, { recursive: true });
		} catch (ex) {
			this._logger.error(
				`Failed to make build directory ${build}: ${ex.message}`,
			);
			return false;
		}

		this._targets = new Map<string, TargetInfo>();
		for (const t of this._mk.targets()) {
			this._targets.set(t, this._mk.target(t));
		}

		if (this._reportCycle()) {
			return false;
		}

		this._logger.info(`Updating goal '${goal.rel()}'`);
		const result = await this.updateAll([goal]);
		if (result) {
			this._logger.info(`Successfully updated goal '${goal.rel()}'`);
		} else {
			this._logger.error(`Failed to update goal '${goal.rel()}'`);
		}

		return result;
	}

	private async updateAll(targets: Iterable<IBuildPath>): Promise<boolean> {
		const promises: Promise<boolean>[] = [];

		for (const t of targets) {
			promises.push(this._findOrStartBuild(t));
		}

		const results = await Promise.all(promises);
		return results.every((b) => b);
	}

	private async _findOrStartBuild(target: IBuildPath): Promise<boolean> {
		const rel = target.rel();
		this._logger.trace(`_findOrStartBuild('${rel}')`);

		const built = this._builtTargets.get(rel);
		if (built) {
			this._logger.trace(
				`_findOrStartBuild: '${rel}' is already updated. Skipping.`,
			);
			return built.result;
		}

		let result = false;

		let targetGroup = [target];
		const info = this._targets.get(rel);
		if (!info) {
			this._logger.error(`Makefile has no target '${rel}'.`);
			return false;
		}

		const { recipeRule } = info;
		if (isRuleID(recipeRule)) {
			const ruleInfo = this._rules.get(recipeRule);
			targetGroup = ruleInfo.targets;
		}

		result = await this._startBuild(targetGroup, recipeRule, target);
		for (const t of targetGroup) {
			this._builtTargets.set(t.rel(), { result });
		}

		return result;
	}

	private abs(p: Path) {
		return p.abs(this._roots);
	}

	private endTarget(result: boolean): boolean {
		return result;
	}

	private async _startBuild(
		targetGroup: IBuildPath[],
		recipeRule: RuleID | null,
		requestedTarget: IBuildPath,
	): Promise<boolean> {
		const srcToBuild: IBuildPath[] = [];
		const allSrc: Path[] = [];
		const allPostreq: string[] = [];

		for (const target of targetGroup) {
			const { rules, postreqs } = this._targets.get(target.rel());

			for (const ruleId of rules) {
				const ruleInfo = this._rules.get(ruleId);

				// build sources
				for (const src of ruleInfo.sources) {
					allSrc.push(src);
					if (src.isBuildPath()) {
						srcToBuild.push(src);
					}
				}
			}

			if (postreqs) allPostreq.push(...postreqs);
		}

		if (!(await this.updateAll(srcToBuild))) {
			return this.endTarget(false);
		}

		const targetStatus = this._needsBuild(targetGroup, allSrc, allPostreq);

		if (targetStatus === NeedsBuildValue.missingSrc) {
			return this.endTarget(false);
		}

		if (targetStatus === NeedsBuildValue.upToDate) {
			this._logger.debug({
				eventName: EVENT_TARGET_UP_TO_DATE,
				body: `Target '${requestedTarget.rel()}' is up to date`,
			});
			return this.endTarget(true);
		}

		if (!isRuleID(recipeRule)) {
			if (targetStatus === NeedsBuildValue.stale) {
				const rels = targetGroup.map((t) => t.rel()).join(', ');
				this._logger.warn({
					eventName: EVENT_TARGET_STALE_NO_RECIPE,
					body: `Target '${rels}' is out of date, but it has no recipe to update. Assuming it is up to date. Consider giving it a recipe, removing unnecessary prereqs, or entirely removing the target.`,
				});
			}

			return this.endTarget(true);
		}

		const prevAttempt = this._info.get(recipeRule);
		if (prevAttempt) {
			// for some reason need to compare to true for compiler
			if (prevAttempt.complete === true) {
				return prevAttempt.result;
			} else {
				const complete = await prevAttempt.completePromise;
				return complete.result;
			}
		}

		const { promise, resolve } = makePromise<RecipeCompleteInfo>();

		const buildInfo: RecipeInProgressInfo = {
			complete: false,
			startTime: performance.now(),
			completePromise: promise,
		};

		this._info.set(recipeRule, buildInfo);

		const recipeInfo = this._rules.get(recipeRule);
		for (const t of targetGroup) {
			await mkdir(t.dir().abs(this._roots.build), { recursive: true });
		}

		let result = false;
		let exception: Error | undefined;

		try {
			this._logger.debug({
				eventName: EVENT_RECIPE_BEGIN,
				body: `Updating target '${requestedTarget.rel()}'`,
			});
			result = await recipeInfo.recipe();
		} catch (err) {
			exception = err;
			result = false;
			this._logger.error({
				eventName: EVENT_RECIPE_EXCEPTION,
				body: 'Recipe threw an exception',
				exception: err,
			});
		}

		const completeInfo: RecipeCompleteInfo = {
			...buildInfo,
			complete: true,
			endTime: performance.now(),
			result,
			exception,
		};

		if (!result) {
			this._logger.error(`Failed to update target '${requestedTarget.rel()}'`);
		}

		resolve(completeInfo);
		this._info.set(recipeRule, completeInfo);
		return this.endTarget(result);
	}

	private _needsBuild(
		targetGroup: IBuildPath[],
		prereqs: Path[],
		postreqs: string[],
	): NeedsBuildValue {
		let newestDepMtimeMs = -Infinity;

		for (const prereq of prereqs) {
			const abs = this.abs(prereq);
			const preStat = statSync(abs, { throwIfNoEntry: false });
			if (preStat) {
				newestDepMtimeMs = Math.max(preStat.mtimeMs, newestDepMtimeMs);
			} else if (prereq.isBuildPath() && this._targets.has(prereq.rel())) {
				newestDepMtimeMs = Infinity;
			} else {
				this._logger.error(`Missing prereq file '${abs}'.`);
				return NeedsBuildValue.missingSrc;
			}
		}

		let oldestTargetMtimeMs = Infinity;
		for (const t of targetGroup) {
			const stat = statSync(this.abs(t), { throwIfNoEntry: false });
			if (stat) {
				oldestTargetMtimeMs = Math.min(stat.mtimeMs, oldestTargetMtimeMs);
			} else {
				return NeedsBuildValue.missing;
			}
		}

		for (const post of postreqs) {
			const postStat = statSync(post, { throwIfNoEntry: false });
			if (!postStat) return NeedsBuildValue.stale; // need to see if still needed
			newestDepMtimeMs = Math.max(postStat.mtimeMs, newestDepMtimeMs);
		}

		if (newestDepMtimeMs > oldestTargetMtimeMs) return NeedsBuildValue.stale;

		return NeedsBuildValue.upToDate;
	}

	public *recipesInProgress(): Generator<[RuleID, RuleInfo]> {
		for (const [id, info] of this._info) {
			if (!info.complete) {
				yield [id, this._rules.get(id)];
			}
		}
	}

	public *completedRecipes(): Generator<
		[RuleID, RuleInfo, RecipeCompleteInfo]
	> {
		for (const [id, info] of this._info) {
			if (info.complete) {
				yield [id, this._rules.get(id), info];
			}
		}
	}
}

enum NeedsBuildValue {
	stale,
	missing,
	missingSrc,
	upToDate,
}

interface IPromisePieces<T> {
	promise: Promise<T>;
	resolve: (val: T) => Promise<T> | void;
	reject: (err: Error) => void;
}

function makePromise<T>(): IPromisePieces<T> {
	let resolve, reject;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { resolve, reject, promise };
}

type RuleInfo = {
	recipe: () => Promise<boolean> | null;
	sources: Path[];
	targets: IBuildPath[];
};
