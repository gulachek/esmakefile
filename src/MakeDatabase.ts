import { relative, resolve } from 'node:path';
import { RecipeArgs } from './Rule.js';
import type { MakefileFn } from './Makefile.js';

export type MakefileInfo = {
	path: PathInfo;
	fn: MakefileFn;
	isParsed: boolean;
};

const UseObjIds = true;

type StrictIdObj<K extends string> = {
	[P in K]: number;
};

export type StrictId<K extends string> = typeof UseObjIds extends true
	? StrictIdObj<K>
	: number;

function idVal<K extends string>(key: K, id: StrictIdObj<K> | number): number {
	if (typeof id === 'number') return id;
	else return id[key];
}

function mkId<K extends string>(key: K, val: number): StrictId<K> {
	if (UseObjIds) {
		return { [key]: val } as unknown as StrictId<K>;
	} else {
		return val as unknown as StrictId<K>;
	}
}

function isId<K extends string>(key: K, id: unknown): id is StrictId<K> {
	if (UseObjIds) {
		return (
			id &&
			typeof id === 'object' &&
			key in id &&
			typeof (id as Record<string, unknown>)[key] === 'number'
		);
	} else {
		return typeof id === 'number';
	}
}

const RuleIdKey = '__ruleId';
export type RuleId = StrictId<typeof RuleIdKey>;
export function isRuleId(id: unknown): id is RuleId {
	return isId(RuleIdKey, id);
}

export type RuleInfo = {
	id: RuleId;
	recipe: (args: RecipeArgs) => Promise<boolean> | null;
	prereqs: PathInfo[];
	targets: TargetInfo[];
};

const TargetIdKey = '__targetId';
export type TargetId = StrictId<typeof TargetIdKey>;

export type TargetInfo = {
	id: TargetId;
	path: PathInfo;
	rules: Set<RuleId>;
	recipeRule: RuleId | null;
	postreqs?: string[];
};

const PathIdKey = '__pathId';
export type PathId = StrictId<typeof PathIdKey>;

export type PathInfo = {
	id: PathId;
	path: string;
};

export class MakeDatabase {
	private _makefiles = new Map<PathId, MakefileInfo>();
	private _makefilesIndexUnparsed = new Set<PathId>();
	private _rules: RuleInfo[] = [];

	private _targets: TargetInfo[] = [];
	private _targetsIndexPath = new Map<PathId, TargetInfo>();

	private _paths: PathInfo[] = [];
	private _pathsIndexNormalized = new Map<string, PathInfo>();

	insertMakefile(path: string, fn: MakefileFn): MakefileInfo {
		const pInfo = this.selectOrInsertPath(path);

		if (this._makefiles.has(pInfo.id)) {
			throw new Error(`Makefile '${path}' is already registered`);
		}

		const targetInfo = this.selectTargetByPath(pInfo);
		if (isId(RuleIdKey, targetInfo?.recipeRule)) {
			throw new Error(
				`Cannot add Makefile '${path}' which also has a recipe defined`,
			);
		}

		const info: MakefileInfo = {
			path: pInfo,
			fn,
			isParsed: false,
		};

		this._makefiles.set(pInfo.id, info);
		this._makefilesIndexUnparsed.add(pInfo.id);

		return info;
	}

	selectMakefile(path: PathInfo): MakefileInfo | null {
		const info = this._makefiles.get(path.id);
		if (info) return { ...info };
		return null;
	}

	selectMakefileFirstUnparsed(): MakefileInfo | null {
		for (const rel of this._makefilesIndexUnparsed.keys()) {
			const info = this._makefiles.get(rel);
			if (!info)
				throw new Error(
					`Unparsed Makefile index is corrupt: Makefile '${rel}' exists in index but not in data`,
				);

			if (info.isParsed)
				throw new Error(
					`Unparsed Makefile index is corrupt: Makefile '${rel}' exists in index but is flagged as parsed`,
				);

			return { ...info };
		}

		return null;
	}

	updateMakefile(
		info: Pick<MakefileInfo, 'path'> & Partial<MakefileInfo>,
	): void {
		const { path } = info;
		const stored = this._makefiles.get(path.id);
		if (!stored) {
			throw new Error(`Makefile '${path.path}' not found`);
		}

		Object.assign(stored, info);
		if (stored.isParsed) {
			this._makefilesIndexUnparsed.delete(path.id);
		}
	}

	insertRule(rule: {
		targets: string[];
		prereqs: string[];
		recipe: RuleInfo['recipe'];
	}): RuleInfo {
		const targetPaths = this.selectOrInsertPaths(rule.targets);
		const prereqs = this.selectOrInsertPaths(rule.prereqs);
		const recipe = rule.recipe;

		const targets: TargetInfo[] = [];
		for (const t of targetPaths) {
			const targetInfo = this.selectTargetByPath(t);
			if (targetInfo) targets.push(targetInfo);
			else targets.push(this.insertTarget(t));
		}

		const id = this._rules.length;
		const info: RuleInfo = {
			id: mkId(RuleIdKey, id),
			targets,
			prereqs,
			recipe,
		};
		this._rules.push(info);

		for (const t of targets) {
			this.updateTargetWithRule(t, info);
		}

		return info;
	}

	selectRule(id: RuleId): RuleInfo | null {
		const v = idVal(RuleIdKey, id);
		if (v < 0 || v >= this._rules.length) return null;

		return this._rules[v];
	}

	selectRules(): RuleInfo[] {
		return Array.from(this._rules);
	}

	selectTargets(): TargetInfo[] {
		return Array.from(this._targets);
	}

	selectTargetByPath(path: PathInfo): TargetInfo | null {
		return this._targetsIndexPath.get(path.id) || null;
	}

	selectTargetByRawPath(rawPath: string): TargetInfo | null {
		const path = this.selectPathByRawPath(rawPath);
		if (!path) return null;
		return this._targetsIndexPath.get(path.id) || null;
	}

	selectTargetById(id: TargetId): TargetInfo | null {
		const v = idVal(TargetIdKey, id);
		if (v < 0 || v >= this._targets.length) return null;

		return this._targets[v];
	}

	private insertTarget(path: PathInfo): TargetInfo {
		const id = this._targets.length;
		const info: TargetInfo = {
			id: mkId(TargetIdKey, id),
			path,
			rules: new Set<RuleId>(),
			recipeRule: null,
		};

		this._targets.push(info);
		this._targetsIndexPath.set(path.id, info);
		return info;
	}

	private updateTargetWithRule(target: TargetInfo, rule: RuleInfo): void {
		const { path } = target.path;

		if (rule.recipe) {
			if (isId(RuleIdKey, target.recipeRule))
				throw new Error(
					`Target '${path}' already has a recipe specified. Cannot add another one.`,
				);

			if (this._makefiles.has(target.path.id)) {
				throw new Error(`Cannot add a recipe to Makefile target '${path}'`);
			}

			target.recipeRule = rule.id;
		}

		target.rules.add(rule.id);
	}

	resolvePath(pathInfo: PathInfo): string {
		return resolve(pathInfo.path);
	}

	selectPathByRawPath(rawPath: string): PathInfo | null {
		const norm = this.normalizePath(rawPath);
		return this.selectNormalizedPath(norm);
	}

	private selectOrInsertPaths(rawPaths: string[]): PathInfo[] {
		const out: PathInfo[] = [];
		for (const raw of rawPaths) {
			out.push(this.selectOrInsertPath(raw));
		}
		return out;
	}

	private selectOrInsertPath(rawPath: string): PathInfo {
		const norm = this.normalizePath(rawPath);
		const info = this.selectNormalizedPath(norm);
		if (info) return info;
		return this.insertNormalizedPath(norm);
	}

	private insertNormalizedPath(normPath: string): PathInfo {
		const id = this._paths.length;
		const info: PathInfo = {
			id: mkId(PathIdKey, id),
			path: normPath,
		};
		this._paths.push(info);
		this._pathsIndexNormalized.set(normPath, info);
		return info;
	}

	private selectNormalizedPath(normPath: string): PathInfo | null {
		return this._pathsIndexNormalized.get(normPath) || null;
	}

	private normalizePath(path: string): string {
		return relative('.', path);
	}
}
