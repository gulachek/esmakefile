import {
	MakeDatabase,
	PathInfo,
	RuleId,
	TargetInfo,
	TargetId,
	isRuleId,
} from './MakeDatabase.js';
import { RecipeArgs } from './Rule.js';

import * as fsPromises from 'node:fs/promises';
import * as nodePath from 'node:path';
import { CycleDetector } from './CycleDetector.js';
import { LogLevel, Logger, getLogger } from './logs.js';
import {
	EVENT_RECIPE_BEGIN,
	EVENT_RECIPE_EXCEPTION,
	EVENT_TARGET_STALE_NO_RECIPE,
	EVENT_TARGET_UP_TO_DATE,
} from './names.js';
import { Stats } from 'node:fs';

export class UpdateExecution {
	private _db: MakeDatabase;

	private _targetResults = new Map<TargetId, Promise<boolean>>();
	private _recipeResults = new Map<RuleId, Promise<boolean>>();
	private _statCache = new Map<string, Promise<Stats>>();

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
			await fsPromises.mkdir(esmakefileDir, { recursive: true });
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
		const prevAttempt = this._targetResults.get(target.id);
		if (prevAttempt) {
			this._logger.trace(
				`_findOrStartUpdate: '${target.pathInfo.path}' was already encountered. Skipping.`,
			);
			return prevAttempt;
		}

		let targetGroup = [target];

		const { recipeRule } = target;
		if (isRuleId(recipeRule)) {
			const ruleInfo = this._db.selectRule(recipeRule);
			targetGroup = ruleInfo.targets;
		}

		const tPromise = this._startUpdate(targetGroup, recipeRule, target);
		for (const t of targetGroup) {
			this._targetResults.set(t.id, tPromise);
		}

		return tPromise;
	}

	private endTarget(result: boolean): boolean {
		return result;
	}

	private async _startUpdate(
		targetGroup: TargetInfo[],
		recipeRule: RuleId | null,
		requestedTarget: TargetInfo,
	): Promise<boolean> {
		const targetPrereqs: TargetInfo[] = [];
		const nonTargetPrereqs: PathInfo[] = [];

		for (const target of targetGroup) {
			const { rules } = target;

			for (const ruleId of rules) {
				const ruleInfo = this._db.selectRule(ruleId);

				// update prereqs
				for (const src of ruleInfo.prereqs) {
					const srcTarget = this._db.selectTargetByPath(src);
					if (srcTarget) {
						targetPrereqs.push(srcTarget);
					} else {
						nonTargetPrereqs.push(src);
					}
				}
			}
		}

		if (!(await this.updateAll(targetPrereqs))) {
			return this.endTarget(false);
		}

		const targetStatus = await this._needsUpdate(
			targetGroup,
			targetPrereqs,
			nonTargetPrereqs,
		);

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
			await fsPromises.mkdir(nodePath.dirname(t.pathInfo.path), {
				recursive: true,
			});
		}

		let result = false;

		try {
			this._logger.debug({
				eventName: EVENT_RECIPE_BEGIN,
				body: `Updating target '${tPath(requestedTarget)}'`,
			});
			const args = new RecipeArgs(this._db, recipeInfo);
			result = await recipeInfo.recipe(args);
		} catch (err) {
			result = false;
			this._logger.error({
				eventName: EVENT_RECIPE_EXCEPTION,
				body: 'Recipe threw an exception',
				exception: err,
			});
		}

		if (recipeInfo.restat) {
			for (const t of targetGroup) {
				const p = t.pathInfo.path;
				if (this._logger.enabled({ level: LogLevel.trace })) {
					this._logger.trace(
						`Clearing stat cache for ${p} because recipe requested restat`,
					);
				}
				this._statCache.delete(p);
			}
		}

		if (!result) {
			this._logger.error(`Failed to update target '${tPath(requestedTarget)}'`);
		}

		resolve(result);
		return this.endTarget(result);
	}

	private async _needsUpdate(
		targetGroup: TargetInfo[],
		targetPrereqs: TargetInfo[],
		nonTargetPrereqs: PathInfo[],
	): Promise<NeedsUpdateValue> {
		let newestDepMtimeMs = -Infinity;

		for (const prereq of targetPrereqs) {
			const recipeRule =
				prereq.recipeRule && this._db.selectRule(prereq.recipeRule);
			const restat = recipeRule ? recipeRule.restat : false;

			if (!restat && this._recipeResults.has(prereq.recipeRule)) {
				// recipe was run. consider stale
				return NeedsUpdateValue.stale;
			}

			const abs = this._db.resolvePath(prereq.pathInfo);
			const preStat = await this._stat(abs);
			if (preStat) {
				newestDepMtimeMs = Math.max(preStat.mtimeMs, newestDepMtimeMs);
			} else {
				return NeedsUpdateValue.stale; // phony target w/o recipe
			}
		}

		for (const prereq of nonTargetPrereqs) {
			const abs = this._db.resolvePath(prereq);
			const preStat = await this._stat(abs);
			if (preStat) {
				newestDepMtimeMs = Math.max(preStat.mtimeMs, newestDepMtimeMs);
			} else {
				this._logger.error(`Missing prereq file '${abs}'.`);
				return NeedsUpdateValue.missingSrc;
			}
		}

		let oldestTargetMtimeMs = Infinity;
		for (const t of targetGroup) {
			const abs = this._db.resolvePath(t.pathInfo);
			const stat = await this._stat(abs);
			if (stat) {
				oldestTargetMtimeMs = Math.min(stat.mtimeMs, oldestTargetMtimeMs);
			} else {
				return NeedsUpdateValue.missing;
			}
		}

		if (newestDepMtimeMs > oldestTargetMtimeMs) return NeedsUpdateValue.stale;

		return NeedsUpdateValue.upToDate;
	}

	private async _stat(path: string): Promise<Stats | null> {
		const prevStat = this._statCache.get(path);
		if (prevStat) return prevStat;
		const { promise, resolve } = makePromise<Stats | null>();

		try {
			const stats = await fsPromises.stat(path);
			resolve(stats);
		} catch (ex) {
			if (this._logger.enabled({ level: LogLevel.trace })) {
				this._logger.trace(ex.message);
			}
			resolve(null);
		}

		return promise;
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
