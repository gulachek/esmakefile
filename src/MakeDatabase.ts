import { resolve } from 'node:path';
import { isRuleID, RecipeArgs, RuleID } from './Rule.js';
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

export type RuleInfo = {
	id: RuleID;
	recipe: (args: RecipeArgs) => Promise<boolean> | null;
	prereqs: string[];
	targets: string[];
};

export type TargetInfo = {
	path: string;
	rules: Set<RuleID>;
	recipeRule: RuleID | null;
	postreqs?: string[];
};

export class MakeDatabase {
	readonly rootDir: string;

	private _makefiles = new Map<string, MakefileInfo>();
	private _makefilesIndexUnparsed = new Set<string>();
	private _rules: RuleInfo[] = [];
	private _targets = new Map<string, TargetInfo>();

	constructor(opts: IMakeDatabaseOpts) {
		this.rootDir = resolve(opts.rootDir || '.');
	}

	insertMakefile(path: string, fn: MakefileFn): MakefileInfo {
		if (this._makefiles.has(path)) {
			throw new Error(`Makefile '${path}' is already registered`);
		}

		const targetInfo = this._targets.get(path);
		if (isRuleID(targetInfo?.recipeRule)) {
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

	insertRule(rule: Omit<RuleInfo, 'id'>): RuleInfo {
		const id = this._rules.length;
		const info: RuleInfo = { ...rule, id };
		this._rules.push(info);

		for (const t of info.targets) {
			this.upsertTargetRule(t, info);
		}

		return info;
	}

	selectRule(id: RuleID): RuleInfo | null {
		if (id < 0 || id >= this._rules.length) return null;

		return this._rules[id];
	}

	selectRules(): RuleInfo[] {
		return Array.from(this._rules);
	}

	selectTargets(): TargetInfo[] {
		return Array.from(this._targets.values());
	}

	selectTarget(path: string): TargetInfo | null {
		return this._targets.get(path) || null;
	}

	private upsertTargetRule(path: string, rule: RuleInfo): void {
		let targetInfo = this._targets.get(path);
		if (!targetInfo) {
			targetInfo = {
				path,
				rules: new Set(),
				recipeRule: null,
			};
			this._targets.set(path, targetInfo);
		}

		if (rule.recipe) {
			if (isRuleID(targetInfo.recipeRule))
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
