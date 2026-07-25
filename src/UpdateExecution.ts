import {
	MakeDatabase,
	PathInfo,
	RuleId,
	TargetInfo,
	isRuleId,
} from './MakeDatabase.js';
import { RecipeArgs } from './Rule.js';

import { mkdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import * as nodePath from 'node:path';
import { CycleDetector } from './CycleDetector.js';
import { Logger, getLogger } from './logs.js';
import {
	EVENT_RECIPE_BEGIN,
	EVENT_RECIPE_EXCEPTION,
	EVENT_TARGET_STALE_NO_RECIPE,
	EVENT_TARGET_UP_TO_DATE,
} from './names.js';

type TargetCompleteInfo = {
	result: boolean;
};

export class UpdateExecution {
	private _db: MakeDatabase;

	private _builtTargets = new Map<TargetInfo, TargetCompleteInfo>();

	private _recipeResults = new Map<RuleId, Promise<boolean>>();
	private _logger: Logger;

	constructor(db: MakeDatabase) {
		this._db = db;
		this._logger = getLogger({ name: 'esmakefile.UpdateExecution' });
	}

	private _reportCycle(): boolean {
		const cd = new CycleDetector();

		for (const targetInfo of this._db.selectTargets()) {
			for (const rule of targetInfo.rules) {
				const { prereqs } = this._db.selectRule(rule);
				for (const p of prereqs) {
					if (this._db.selectTargetByPath(p)) {
						cd.addEdge(targetInfo.pathInfo.path, p.path);
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
		const esmakefileDir = '__esmakefile__';

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

		const result = await this.updateAll([goal]);
		return result;
	}

	private async updateAll(targets: Iterable<TargetInfo>): Promise<boolean> {
		const promises: Promise<boolean>[] = [];

		for (const t of targets) {
			promises.push(this._findOrStartUpdate(t));
		}

		const results = await Promise.all(promises);
		return results.every((b) => b);
	}

	private async _findOrStartUpdate(target: TargetInfo): Promise<boolean> {
		this._logger.trace(`_findOrStartUpdate('${target.pathInfo.path}')`);

		// TODO - is this necessary? Seems like recipe is the expensive thing
		const built = this._builtTargets.get(target);
		if (built) {
			this._logger.trace(
				`_findOrStartUpdate: '${target.pathInfo.path}' is already updated. Skipping.`,
			);
			return built.result;
		}

		let result = false;

		let targetGroup = [target];

		const { recipeRule } = target;
		if (isRuleId(recipeRule)) {
			const ruleInfo = this._db.selectRule(recipeRule);
			targetGroup = ruleInfo.targets;
		}

		result = await this._startUpdate(targetGroup, recipeRule, target);
		for (const t of targetGroup) {
			this._builtTargets.set(t, { result });
		}

		return result;
	}

	private endTarget(result: boolean): boolean {
		return result;
	}

	private async _startUpdate(
		targetGroup: TargetInfo[],
		recipeRule: RuleId | null,
		requestedTarget: TargetInfo,
	): Promise<boolean> {
		const prereqsToUpdate: TargetInfo[] = [];
		const allPrereqs: PathInfo[] = [];

		for (const target of targetGroup) {
			const { rules } = target;

			for (const ruleId of rules) {
				const ruleInfo = this._db.selectRule(ruleId);

				// update prereqs
				for (const src of ruleInfo.prereqs) {
					allPrereqs.push(src);

					const srcTarget = this._db.selectTargetByPath(src);
					if (srcTarget) {
						prereqsToUpdate.push(srcTarget);
					}
				}
			}
		}

		if (!(await this.updateAll(prereqsToUpdate))) {
			return this.endTarget(false);
		}

		const targetStatus = this._needsUpdate(targetGroup, allPrereqs);

		if (targetStatus === NeedsUpdateValue.missingSrc) {
			return this.endTarget(false);
		}

		if (targetStatus === NeedsUpdateValue.upToDate) {
			this._logger.debug({
				eventName: EVENT_TARGET_UP_TO_DATE,
				body: `Target '${tPath(requestedTarget)}' is up to date`,
			});
			return this.endTarget(true);
		}

		if (!isRuleId(recipeRule)) {
			if (targetStatus === NeedsUpdateValue.stale) {
				const rels = targetGroup.map((t) => t.pathInfo.path).join(', ');
				this._logger.warn({
					eventName: EVENT_TARGET_STALE_NO_RECIPE,
					body: `Target '${rels}' is out of date, but it has no recipe to update. Assuming it is up to date. Consider giving it a recipe, removing unnecessary prereqs, or entirely removing the target.`,
				});
			}

			return this.endTarget(true);
		}

		const prevAttempt = this._recipeResults.get(recipeRule);
		if (prevAttempt) return prevAttempt;

		const { promise, resolve } = makePromise<boolean>();

		this._recipeResults.set(recipeRule, promise);

		const recipeInfo = this._db.selectRule(recipeRule);
		for (const t of targetGroup) {
			await mkdir(nodePath.dirname(t.pathInfo.path), {
				recursive: true,
			});
		}

		let result = false;

		try {
			this._logger.debug({
				eventName: EVENT_RECIPE_BEGIN,
				body: `Updating target '${tPath(requestedTarget)}'`,
			});
			const args = new RecipeArgs();
			result = await recipeInfo.recipe(args);
		} catch (err) {
			result = false;
			this._logger.error({
				eventName: EVENT_RECIPE_EXCEPTION,
				body: 'Recipe threw an exception',
				exception: err,
			});
		}

		if (!result) {
			this._logger.error(`Failed to update target '${tPath(requestedTarget)}'`);
		}

		resolve(result);
		return this.endTarget(result);
	}

	private _needsUpdate(
		targetGroup: TargetInfo[],
		prereqs: PathInfo[],
	): NeedsUpdateValue {
		let newestDepMtimeMs = -Infinity;

		for (const prereq of prereqs) {
			const abs = this._db.resolvePath(prereq);
			const preStat = statSync(abs, { throwIfNoEntry: false });
			if (preStat) {
				newestDepMtimeMs = Math.max(preStat.mtimeMs, newestDepMtimeMs);
			} else if (this._db.selectTargetByPath(prereq)) {
				newestDepMtimeMs = Infinity;
			} else {
				this._logger.error(`Missing prereq file '${abs}'.`);
				return NeedsUpdateValue.missingSrc;
			}
		}

		let oldestTargetMtimeMs = Infinity;
		for (const t of targetGroup) {
			const abs = this._db.resolvePath(t.pathInfo);
			const stat = statSync(abs, { throwIfNoEntry: false });
			if (stat) {
				oldestTargetMtimeMs = Math.min(stat.mtimeMs, oldestTargetMtimeMs);
			} else {
				return NeedsUpdateValue.missing;
			}
		}

		if (newestDepMtimeMs > oldestTargetMtimeMs) return NeedsUpdateValue.stale;

		return NeedsUpdateValue.upToDate;
	}
}

enum NeedsUpdateValue {
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
	return t.pathInfo.path;
}
