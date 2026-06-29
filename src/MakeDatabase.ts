import { resolve } from 'node:path';
import { RecipeArgs } from './Rule.js';
import type { MakefileFn } from './Makefile.js';

export interface IMakeDatabaseOpts {
	rootDir?: string;
}

export type MakefileInfo = {
	path: string;
	fn: MakefileFn;
	isParsed: boolean;
};

export type RowID = number;

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
	prereqs: string[];
	targets: TargetId[];
};

const TargetIdKey = '__targetId';
export type TargetId = StrictId<typeof TargetIdKey>;

export type TargetInfo = {
	id: TargetId;
	path: string;
	rules: Set<RuleId>;
	recipeRule: RuleId | null;
	postreqs?: string[];
};

export class MakeDatabase {
	readonly rootDir: string;

	private _makefiles = new Map<string, MakefileInfo>();
	private _makefilesIndexUnparsed = new Set<string>();
	private _rules: RuleInfo[] = [];

	private _targets: TargetInfo[] = [];
	private _targetsIndexPath = new Map<string, TargetInfo>();

	constructor(opts: IMakeDatabaseOpts) {
		this.rootDir = resolve(opts.rootDir || '.');
	}

	insertMakefile(path: string, fn: MakefileFn): MakefileInfo {
		if (this._makefiles.has(path)) {
			throw new Error(`Makefile '${path}' is already registered`);
		}

		const targetInfo = this.selectTarget(path);
		if (isId(RuleIdKey, targetInfo?.recipeRule)) {
			throw new Error(
				`Cannot add Makefile '${path}' which also has a recipe defined`,
			);
		}

		const info: MakefileInfo = {
			path,
			fn,
			isParsed: false,
		};

		this._makefiles.set(path, info);
		this._makefilesIndexUnparsed.add(path);

		return info;
	}

	selectMakefile(path: string): MakefileInfo | null {
		const info = this._makefiles.get(path);
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
		const rel = info.path;
		const stored = this._makefiles.get(rel);
		if (!stored) {
			throw new Error(`Makefile '${rel}' not found`);
		}

		Object.assign(stored, info);
		if (stored.isParsed) {
			this._makefilesIndexUnparsed.delete(rel);
		}
	}

	insertRule(rule: {
		targets: string[];
		prereqs: string[];
		recipe: RuleInfo['recipe'];
	}): RuleInfo {
		const targetPaths = rule.targets;
		const prereqs = rule.prereqs;
		const recipe = rule.recipe;

		const targets: TargetId[] = [];
		for (const t of targetPaths) {
			const targetInfo = this.selectTarget(t);
			if (targetInfo) targets.push(targetInfo.id);
			else targets.push(this.insertTarget(t).id);
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

	selectTarget(path: string): TargetInfo | null {
		return this._targetsIndexPath.get(path) || null;
	}

	selectTargetById(id: TargetId): TargetInfo | null {
		const v = idVal(TargetIdKey, id);
		if (v < 0 || v >= this._targets.length) return null;

		return this._targets[v];
	}

	private insertTarget(path: string): TargetInfo {
		const id = this._targets.length;
		const info: TargetInfo = {
			id: mkId(TargetIdKey, id),
			path,
			rules: new Set<RuleId>(),
			recipeRule: null,
		};

		this._targets.push(info);
		this._targetsIndexPath.set(path, info);
		return info;
	}

	private updateTargetWithRule(id: TargetId, rule: RuleInfo): void {
		const targetInfo = this.selectTargetById(id);
		const path = targetInfo.path;

		if (rule.recipe) {
			if (isId(RuleIdKey, targetInfo.recipeRule))
				throw new Error(
					`Target '${path}' already has a recipe specified. Cannot add another one.`,
				);

			if (this._makefiles.has(path)) {
				throw new Error(`Cannot add a recipe to Makefile target '${path}'`);
			}

			targetInfo.recipeRule = rule.id;
		}

		targetInfo.rules.add(rule.id);
	}
}
