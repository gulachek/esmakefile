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
import { resolve } from 'node:path';

type RecipeInProgressInfo = {
	complete: false;

	/** performance.now() when recipe() was started */
	startTime: number;

	completePromise: Promise<RecipeCompleteInfo>;
};

export type RecipeCompleteInfo = {
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

export type BuildError = {
	msg: string;
};

export class Build {
	private _roots: IPathRoots;
	private _make: Makefile;
	public readonly goal: IBuildPath;

	private _event = new EventEmitter();
	private _rules = new Map<RuleID, RuleInfo>();

	private _targets = new Map<string, TargetInfo>();
	private _builtTargets = new Map<string, TargetCompleteInfo>();

	private _info = new Map<RuleID, RecipeBuildInfo>();
	private _logs = new Map<RuleID, Vt100Stream>();
	private _recipeResults: RecipeResults[] = [];

	public readonly errors: BuildError[] = [];

	constructor(make: Makefile, goal?: BuildPathLike) {
		this._make = make;
		this.goal = (goal && Path.build(goal)) || make.defaultGoal;
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

	elapsedMsOf(ruleId: RuleID, now?: number): number {
		const info = this._info.get(ruleId);
		if (!info) return 0;
		if (info.complete) {
			return info.endTime - info.startTime;
		} else {
			return (now || performance.now()) - info.startTime;
		}
	}

	contentOfLog(ruleId: RuleID): string | null {
		const stream = this._logs.get(ruleId);
		if (!stream) return null;
		return stream.contents();
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

		const { src, build } = this._roots;
		const stats = statSync(src, { throwIfNoEntry: false });
		if (!(stats && stats.isDirectory())) {
			this.addError(`Source directory '${src}' is not a readable directory`);
			return false;
		}

		const esmakefileDir = resolve(build, '__esmakefile__');

		try {
			await mkdir(esmakefileDir, { recursive: true });
		} catch (ex) {
			this.addError(`Failed to make build directory ${build}: ${ex.message}`);
			return false;
		}

		await this._make._load();

		this._targets = new Map<string, TargetInfo>();
		for (const t of this._make.targets()) {
			this._targets.set(t, this._make.target(t));
		}

		this._recipeResults = [];

		const result = await this.updateAll([this.goal]);

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

		const built = this._builtTargets.get(rel);
		if (built) {
			return built.result;
		}

		let result = false;

		let targetGroup = [target];
		const info = this._targets.get(rel);
		if (!info) {
			this.addError(`Makefile has no target '${rel}'.`);
			return false;
		}

		const { recipeRule } = info;
		if (isRuleID(recipeRule)) {
			const ruleInfo = this._rules.get(recipeRule);
			targetGroup = ruleInfo.targets;
		}

		result = await this._startBuild(targetGroup, recipeRule);
		for (const t of targetGroup) {
			this._builtTargets.set(t.rel(), { result });
		}

		return result;
	}

	private abs(p: Path) {
		return p.abs(this._roots);
	}

	private endTarget(result: boolean): boolean {
		this._emit('update');
		return result;
	}

	private async _startBuild(
		targetGroup: IBuildPath[],
		recipeRule: RuleID | null,
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
			return this.endTarget(true);
		}

		// TODO - this doesn't emit an event
		if (!isRuleID(recipeRule)) return true;

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

		this._emit('update');

		let result = false;
		let exception: Error | undefined;

		try {
			result = await recipeInfo.recipe();
		} catch (err) {
			exception = err;
			result = false;
		}

		const completeInfo: RecipeCompleteInfo = {
			...buildInfo,
			complete: true,
			endTime: performance.now(),
			result,
			exception,
		};

		resolve(completeInfo);
		this._info.set(recipeRule, completeInfo);
		return this.endTarget(result);
	}

	private addError(msg: string) {
		this._event.emit('update'); // TODO - add targeted event
		this.errors.push({ msg });
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
				this.addError(`Missing prereq file '${abs}'.`);
				return NeedsBuildValue.missingSrc;
			}
		}

		for (const post of postreqs) {
			const postStat = statSync(post, { throwIfNoEntry: false });
			if (!postStat) return NeedsBuildValue.stale; // need to see if still needed
			newestDepMtimeMs = Math.max(postStat.mtimeMs, newestDepMtimeMs);
		}

		let oldestTargetMtimeMs = Infinity;
		for (const t of targetGroup) {
			const stat = statSync(this.abs(t), { throwIfNoEntry: false });
			if (stat) {
				oldestTargetMtimeMs = Math.min(stat.mtimeMs, oldestTargetMtimeMs);
			} else {
				return NeedsBuildValue.stale;
			}
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
	update: [];
	'recipe-log': [RuleID, Buffer];
};

type BuildEvent = keyof BuildEventMap;

type Listener<E extends BuildEvent> = (...data: BuildEventMap[E]) => void;

export type RuleInfo = {
	recipe: () => Promise<boolean> | null;
	sources: Path[];
	targets: IBuildPath[];
};
