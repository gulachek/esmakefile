import { IBuildPath, Path } from './Path.js';
import { Vt100Stream } from './Vt100Stream.js';

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { dirname } from 'node:path';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';

/**
 * Public interface of build introspection
 */
export interface IBuild {
	readonly buildRoot: string;
	readonly srcRoot: string;

	elapsedMsOf(target: string, now?: number): number;
	resultOf(target: string): boolean | null;
	contentOfLog(target: string): string | null;
	thrownExceptionOf(target: string): Error;

	on<Event extends BuildEvent>(event: Event, listener: Listener<Event>): void;

	off<Event extends BuildEvent>(event: Event, listener: Listener<Event>): void;
}

export type RuleID = number;

export function isRuleID(id: unknown): id is RuleID {
	return typeof id === 'number';
}

export type RuleInfo = {
	name: string;
	recipe: (build: Build) => Promise<boolean> | null;
	sources: Path[];
	targets: IBuildPath[];
};

export type TargetInfo = {
	rules: Set<RuleID>;
	recipeRule: RuleID | null;
};

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

interface IBuildJson {
	targets: [string, number][];
	prereqs: [number, string[]][];
	postreqs: [number, string[]][];
}

interface IBuildOpts {
	rules: RuleInfo[];
	targets: Map<string, TargetInfo>;
	prevBuild: Build | null;
	buildRoot: string;
	srcRoot: string;
}

export class Build implements IBuild {
	readonly buildRoot: string;
	readonly srcRoot: string;

	private _event = new EventEmitter();
	private _rules: RuleInfo[] = [];
	private _prevBuild: Build | null;

	private _targets = new Map<string, TargetInfo>();
	private _buildInProgress = new Map<string, Promise<boolean>>();
	private _info = new Map<string, RecipeBuildInfo>();
	private _postreqMap = new Map<RuleID, Set<string>>();
	private _logs = new Map<RuleID, Vt100Stream>();

	constructor(opts?: IBuildOpts) {
		if (opts) {
			const { rules, targets } = opts;

			this.buildRoot = opts.buildRoot;
			this.srcRoot = opts.srcRoot;
			this._rules = rules;
			this._prevBuild = opts.prevBuild;
			this._targets = targets;
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

	private _emit<E extends BuildEvent>(e: E, ...data: BuildEventMap[E]): void {
		this._event.emit(e, ...data);
	}

	async runAll(targets: Iterable<IBuildPath>): Promise<boolean> {
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
		if (p.isBuildPath()) {
			return p.abs(this.buildRoot);
		} else {
			return p.abs(this.srcRoot);
		}
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
			const ruleInfo = this._rules[ruleId];

			// build sources
			for (const src of ruleInfo.sources) {
				allSrc.push(src);
				if (src.isBuildPath()) {
					srcToBuild.push(src);
				}
			}
		}

		if (!(await this.runAll(srcToBuild))) {
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

		const recipeInfo = this._rules[recipeRule];
		for (const peer of recipeInfo.targets) {
			await mkdir(peer.dir().abs(this.buildRoot), { recursive: true });
		}

		const buildInfo: RecipeBuildInfo = {
			complete: false,
			startTime: performance.now(),
		};

		this._info.set(rel, buildInfo);

		this._emit('start-target', rel);

		try {
			const result = await recipeInfo.recipe(this);
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

	static async readFile(abs: string): Promise<Build | null> {
		try {
			const contents = await readFile(abs, 'utf8');
			const json = JSON.parse(contents) as IBuildJson;
			const results = new Build();

			for (const [rel, id] of json.targets) {
				results._targets.set(rel, {
					rules: new Set<RuleID>([id]),
					recipeRule: id,
				});
			}

			for (const [id, postreqs] of json.postreqs) {
				results._postreqMap.set(id, new Set<string>(postreqs));
			}

			return results;
		} catch {
			return null;
		}
	}

	async writeFile(abs: string): Promise<void> {
		const json: IBuildJson = {
			targets: [],
			prereqs: [],
			postreqs: [],
		};

		for (const [id, src] of this._postreqMap) {
			json.postreqs.push([id, [...src]]);
		}

		for (let id = 0; id < this._rules.length; ++id) {
			const rel = this._rules[id].sources.map((p) => this.abs(p));
			json.prereqs.push([id, rel]);
		}

		for (const [target, info] of this._targets) {
			if (isRuleID(info.recipeRule)) {
				json.targets.push([target, info.recipeRule]);
			}
		}

		await mkdir(dirname(abs), { recursive: true });
		await writeFile(abs, JSON.stringify(json), 'utf8');
	}

	addPostreq(recipe: RuleID, srcAbs: Set<string>): void {
		this._postreqMap.set(recipe, srcAbs);
	}

	postreqs(target: IBuildPath): Set<string> {
		const info = this._targets.get(target.rel());
		if (!info) return new Set<string>();

		const { recipeRule } = info;
		const src = isRuleID(recipeRule) && this._postreqMap.get(recipeRule);
		if (src) return src;
		return this._prevBuild?.postreqs(target) || new Set<string>();
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

		const postreqs = this._prevBuild?.postreqs(target);

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
