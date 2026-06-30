import { MakeDatabase, RuleId, TargetInfo, isRuleId } from './MakeDatabase.js';
import { RecipeArgs } from './Rule.js';

import { mkdir } from 'node:fs/promises';
import { statSync, Stats } from 'node:fs';
import * as nodePath from 'node:path';
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
	private _db: MakeDatabase;

	private _builtTargets = new Map<string, TargetCompleteInfo>();

	private _info = new Map<RuleId, RecipeBuildInfo>();
	private _logger: Logger;

	constructor(db: MakeDatabase) {
		this._db = db;
		this._logger = getLogger({ name: 'esmakefile.Build' });
	}

	private _reportCycle(): boolean {
		const cd = new CycleDetector();

		for (const targetInfo of this._db.selectTargets()) {
			for (const rule of targetInfo.rules) {
				const { prereqs } = this._db.selectRule(rule);
				for (const p of prereqs) {
					if (this._db.selectTarget(p)) {
						cd.addEdge(targetInfo.path, p);
					}
				}
			}
		}

		const cycle = cd.findCycle();
		if (cycle) {
			const pathStr = cycle.path.join(' -> ');
			this._logger.error(`Circular dependency detected: ${pathStr}`);
			return true;
		}

		return false;
	}

	async run(goal: TargetInfo): Promise<boolean> {
		const rootDir = this._db.rootDir;
		let stats: Stats | null = null;
		try {
			stats = statSync(rootDir, { throwIfNoEntry: false });
		} catch (_) {
			// will pick up that stats don't exist right below
		}

		if (!(stats && stats.isDirectory())) {
			this._logger.error(
				`Root directory '${rootDir}' is not a readable directory`,
			);
			return false;
		}

		const esmakefileDir = nodePath.resolve(rootDir, '__esmakefile__');

		try {
			await mkdir(esmakefileDir, { recursive: true });
		} catch (ex) {
			this._logger.error(
				`Failed to make directory '${esmakefileDir}': ${ex.message}`,
			);
			return false;
		}

		if (this._reportCycle()) {
			return false;
		}

		this._logger.info(`Updating goal '${goal.path}'`);
		const result = await this.updateAll([goal]);
		if (result) {
			this._logger.info(`Successfully updated goal '${goal.path}'`);
		} else {
			this._logger.error(`Failed to update goal '${goal.path}'`);
		}

		return result;
	}

	private async updateAll(targets: Iterable<TargetInfo>): Promise<boolean> {
		const promises: Promise<boolean>[] = [];

		for (const t of targets) {
			promises.push(this._findOrStartBuild(t));
		}

		const results = await Promise.all(promises);
		return results.every((b) => b);
	}

	private async _findOrStartBuild(target: TargetInfo): Promise<boolean> {
		this._logger.trace(`_findOrStartBuild('${target.path}')`);

		// TODO - is this necessary? Seems like recipe is the expensive thing
		const built = this._builtTargets.get(target.path);
		if (built) {
			this._logger.trace(
				`_findOrStartBuild: '${target.path}' is already updated. Skipping.`,
			);
			return built.result;
		}

		let result = false;

		let targetGroup = [target];

		const { recipeRule } = target;
		if (isRuleId(recipeRule)) {
			const ruleInfo = this._db.selectRule(recipeRule);
			targetGroup = ruleInfo.targets.map((t) => this._db.selectTargetById(t));
		}

		result = await this._startBuild(targetGroup, recipeRule, target);
		for (const t of targetGroup) {
			this._builtTargets.set(t.path, { result });
		}

		return result;
	}

	private endTarget(result: boolean): boolean {
		return result;
	}

	private async _startBuild(
		targetGroup: TargetInfo[],
		recipeRule: RuleId | null,
		requestedTarget: TargetInfo,
	): Promise<boolean> {
		const prereqsToUpdate: TargetInfo[] = [];
		const allPrereqs: string[] = [];
		const allPostreq: string[] = [];

		for (const target of targetGroup) {
			const { rules, postreqs } = target;

			for (const ruleId of rules) {
				const ruleInfo = this._db.selectRule(ruleId);

				// update prereqs
				for (const src of ruleInfo.prereqs) {
					allPrereqs.push(src);

					const srcTarget = this._db.selectTarget(src);
					if (srcTarget) {
						prereqsToUpdate.push(srcTarget);
					}
				}
			}

			if (postreqs) allPostreq.push(...postreqs);
		}

		if (!(await this.updateAll(prereqsToUpdate))) {
			return this.endTarget(false);
		}

		const targetStatus = this._needsBuild(targetGroup, allPrereqs, allPostreq);

		if (targetStatus === NeedsBuildValue.missingSrc) {
			return this.endTarget(false);
		}

		if (targetStatus === NeedsBuildValue.upToDate) {
			this._logger.debug({
				eventName: EVENT_TARGET_UP_TO_DATE,
				body: `Target '${tPath(requestedTarget)}' is up to date`,
			});
			return this.endTarget(true);
		}

		if (!isRuleId(recipeRule)) {
			if (targetStatus === NeedsBuildValue.stale) {
				const rels = targetGroup.join(', ');
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

		const recipeInfo = this._db.selectRule(recipeRule);
		for (const t of targetGroup) {
			await mkdir(
				nodePath.resolve(this._db.rootDir, nodePath.dirname(t.path)),
				{
					recursive: true,
				},
			);
		}

		let result = false;
		let exception: Error | undefined;

		try {
			this._logger.debug({
				eventName: EVENT_RECIPE_BEGIN,
				body: `Updating target '${tPath(requestedTarget)}'`,
			});
			const args = new RecipeArgs(this._db.rootDir, new Set<string>());
			result = await recipeInfo.recipe(args);
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
			this._logger.error(`Failed to update target '${tPath(requestedTarget)}'`);
		}

		resolve(completeInfo);
		this._info.set(recipeRule, completeInfo);
		return this.endTarget(result);
	}

	private _needsBuild(
		targetGroup: TargetInfo[],
		prereqs: string[],
		postreqs: string[],
	): NeedsBuildValue {
		let newestDepMtimeMs = -Infinity;

		for (const prereq of prereqs) {
			const abs = nodePath.resolve(this._db.rootDir, prereq);
			const preStat = statSync(abs, { throwIfNoEntry: false });
			if (preStat) {
				newestDepMtimeMs = Math.max(preStat.mtimeMs, newestDepMtimeMs);
			} else if (this._db.selectTarget(prereq)) {
				newestDepMtimeMs = Infinity;
			} else {
				this._logger.error(`Missing prereq file '${abs}'.`);
				return NeedsBuildValue.missingSrc;
			}
		}

		let oldestTargetMtimeMs = Infinity;
		for (const t of targetGroup) {
			const abs = nodePath.resolve(this._db.rootDir, t.path);
			const stat = statSync(abs, { throwIfNoEntry: false });
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

function tPath(t: TargetInfo): string {
	return t.path.path;
}
