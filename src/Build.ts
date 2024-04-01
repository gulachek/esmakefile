import {
	Makefile,
	RecipeResults,
	RuleID,
	TargetInfo,
	isRuleID,
} from './Makefile.js';
import {
	IRule,
	rulePrereqs,
	ruleTargets,
	ruleRecipe,
	RecipeArgs,
} from './Rule.js';
import { BuildPathLike, IBuildPath, IPathRoots, Path } from './Path.js';
import { Vt100Stream } from './Vt100Stream.js';

import { mkdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';

type RecipeInProgressInfo = {
	complete: false;

	/** performance.now() when recipe() was started */
	startTime: number;
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

type RecipeBuildInfo = RecipeInProgressInfo | RecipeCompleteInfo;

export class Build {
	private _roots: IPathRoots;
	private _make: Makefile;
	private _goal: IBuildPath;

	private _event = new EventEmitter();
	private _rules = new Map<RuleID, RuleInfo>();

	private _targets = new Map<string, TargetInfo>();
	private _buildInProgress = new Map<string, Promise<boolean>>();
	private _info = new Map<string, RecipeBuildInfo>();
	private _logs = new Map<RuleID, Vt100Stream>();
	private _recipeResults: RecipeResults[] = [];

	constructor(make: Makefile, goal?: BuildPathLike) {
		this._make = make;
		this._goal = (goal && Path.build(goal)) || make.defaultGoal;
		this._roots = { build: make.buildRoot, src: make.srcRoot };

		for (const { rule, id } of make.rules()) {
			this._rules.set(id, this.normalizeRule(id, rule));
		}
	}

	on<E extends BuildEvent>(e: E, l: Listener<E>): void {
		this._event.on(e, l);
	}

	off<E extends BuildEvent>(e: E, l: Listener<E>): void {
		this._event.off(e, l);
	}

	elapsedMsOf(target: string, now?: number): number {
		const info = this._info.get(target);
		if (!info) throw new Error(`No info for target ${target}`);
		if (info.complete) {
			return info.endTime - info.startTime;
		} else {
			return (now || performance.now()) - info.startTime;
		}
	}

	resultOf(target: string): boolean | null {
		const info = this._info.get(target);
		if (info.complete) {
			return info.result;
		}

		return null;
	}

	contentOfLog(target: string): string | null {
		const info = this._targets.get(target);
		if (!info) return null;

		const { recipeRule } = info;
		const stream = isRuleID(recipeRule) && this._logs.get(recipeRule);
		if (!stream) return null;
		return stream.contents();
	}

	thrownExceptionOf(target: string): Error | null {
		const info = this._info.get(target);
		if (info.complete) {
			return info.exception || null;
		}

		return null;
	}

	private normalizeRule(id: RuleID, rule: IRule): RuleInfo {
		const prereqs = rulePrereqs(rule);
		const targets = ruleTargets(rule);
		const innerRecipe = ruleRecipe(rule);

		let recipe: () => Promise<boolean> | null = null;
		if (innerRecipe) {
			recipe = async () => {
				const src = new Set<string>();
				const stream = this.createLogStream(id);
				const recipeArgs = new RecipeArgs(this._roots, src, stream);

				const result = await innerRecipe(recipeArgs);

				this._recipeResults.push({
					ruleId: id,
					postreqs: [...src],
				});

				return result;
			};
		}

		return { sources: prereqs, targets, recipe };
	}

	private _emit<E extends BuildEvent>(e: E, ...data: BuildEventMap[E]): void {
		this._event.emit(e, ...data);
	}

	/**
	 * Top level build function. Runs exclusively
	 * @returns A promise that resolves when the build is done
	 */
	async run(): Promise<boolean> {
		using _ = await this._make._lockAsync();

		await this._make._load();

		// TODO - only load dependencies of goal
		this._targets = new Map<string, TargetInfo>();
		for (const t of this._make.targets()) {
			this._targets.set(t, this._make.target(t));
		}

		this._recipeResults = [];

		const result = await this.updateAll([this._goal]);

		await this._make._save(this._recipeResults);

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

	createLogStream(id: RuleID): Writable {
		const stream = new Vt100Stream();
		stream.vtOn('data', (buf: Buffer) => {
			this._emit('recipe-log', id, buf);
		});
		this._logs.set(id, stream);
		return stream;
	}

	private async _findOrStartBuild(target: IBuildPath): Promise<boolean> {
		const rel = target.rel();
		const currentBuild = this._buildInProgress.get(rel);
		if (currentBuild) {
			return currentBuild;
		} else {
			const { promise, resolve, reject } = makePromise<boolean>();
			this._buildInProgress.set(rel, promise);

			let result = false;

			try {
				result = await this._startBuild(target);
				resolve(result);
			} catch (err) {
				reject(err);
			} finally {
				this._buildInProgress.delete(rel);
			}

			return result;
		}
	}

	private abs(p: Path) {
		return p.abs(this._roots);
	}

	private async _startBuild(target: IBuildPath): Promise<boolean> {
		const rel = target.rel();
		const info = this._targets.get(rel);

		if (!info) {
			throw new Error(
				`Cannot build '${target}' because it is not registered with the Makefile`,
			);
		}

		const { recipeRule, rules } = info;

		const srcToBuild: IBuildPath[] = [];
		const allSrc: Path[] = [];

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

		if (!(await this.updateAll(srcToBuild))) {
			this._info.set(rel, {
				complete: true,
				result: false,
				startTime: -1,
				endTime: -1,
			});
			this._emit('end-target', rel);
			return false;
		}

		const targetStatus = this._needsBuild(target, allSrc);

		if (targetStatus === NeedsBuildValue.missingSrc) {
			this._info.set(rel, {
				complete: true,
				result: false,
				startTime: -1,
				endTime: -1,
			});
			this._emit('end-target', rel);
			return false;
		}

		if (targetStatus === NeedsBuildValue.upToDate) {
			this._info.set(rel, {
				complete: true,
				result: true,
				startTime: -1,
				endTime: -1,
			});
			this._emit('end-target', rel);
			return true;
		}

		if (!isRuleID(recipeRule)) return true;

		const recipeInfo = this._rules.get(recipeRule);
		for (const t of recipeInfo.targets) {
			await mkdir(t.dir().abs(this._roots.build), { recursive: true });
		}

		const buildInfo: RecipeBuildInfo = {
			complete: false,
			startTime: performance.now(),
		};

		this._info.set(rel, buildInfo);

		this._emit('start-target', rel);

		try {
			const result = await recipeInfo.recipe();
			this._info.set(rel, {
				...buildInfo,
				complete: true,
				endTime: performance.now(),
				result,
			});
			return result;
		} catch (err) {
			this._info.set(rel, {
				...buildInfo,
				complete: true,
				endTime: performance.now(),
				result: false,
				exception: err,
			});
			return false;
		} finally {
			this._emit('end-target', rel);
		}
	}

	private _needsBuild(target: IBuildPath, prereqs: Path[]): NeedsBuildValue {
		let newestDepMtimeMs = -Infinity;

		for (const prereq of prereqs) {
			const preStat = statSync(this.abs(prereq), { throwIfNoEntry: false });
			if (preStat) {
				newestDepMtimeMs = Math.max(preStat.mtimeMs, newestDepMtimeMs);
			} else if (prereq.isBuildPath() && this._targets.has(prereq.rel())) {
				// phony target
				continue;
			} else {
				return NeedsBuildValue.missingSrc;
			}
		}

		const { postreqs } = this._targets.get(target.rel());

		if (postreqs) {
			for (const post of postreqs) {
				const postStat = statSync(post, { throwIfNoEntry: false });
				if (!postStat) return NeedsBuildValue.stale; // need to see if still needed
				newestDepMtimeMs = Math.max(postStat.mtimeMs, newestDepMtimeMs);
			}
		}

		const targetStats = statSync(this.abs(target), { throwIfNoEntry: false });
		if (!targetStats) return NeedsBuildValue.stale;
		if (newestDepMtimeMs > targetStats.mtimeMs) return NeedsBuildValue.stale;

		return NeedsBuildValue.upToDate;
	}
}

enum NeedsBuildValue {
	stale,
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

type BuildEventMap = {
	'start-target': [string];
	'end-target': [string];
	'recipe-log': [RuleID, Buffer];
};

type BuildEvent = keyof BuildEventMap;

type Listener<E extends BuildEvent> = (...data: BuildEventMap[E]) => void;

export type RuleInfo = {
	recipe: () => Promise<boolean> | null;
	sources: Path[];
	targets: IBuildPath[];
};
