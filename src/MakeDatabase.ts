import { resolve } from 'node:path';
import { IBuildPath, Path } from './Path.js';
import { isRuleID, RecipeArgs, RuleID } from './Rule.js';

export interface IMakeDatabaseOpts {
	srcRoot?: string;
	buildRoot?: string;
}

export type MakefileInfo = {
	path: IBuildPath;
	isParsed: boolean;
};

export type RowID = number;

export type RuleInfo = {
	id: RuleID;
	recipe: (args: RecipeArgs) => Promise<boolean> | null;
	prereqs: Path[];
	targets: IBuildPath[];
};

export type TargetInfo = {
	path: IBuildPath;
	rules: Set<RuleID>;
	recipeRule: RuleID | null;
	postreqs?: string[];
};

export class MakeDatabase {
	readonly srcRoot: string;
	readonly buildRoot: string;

	private _makefiles = new Map<string, MakefileInfo>();
	private _rules: RuleInfo[] = [];
	private _targets = new Map<string, TargetInfo>();

	constructor(opts: IMakeDatabaseOpts) {
		this.srcRoot = resolve(opts.srcRoot || '.');
		this.buildRoot = resolve(opts.buildRoot || 'build');
	}

	insertMakefile(path: IBuildPath): MakefileInfo {
		const rel = path.rel();
		if (this._makefiles.has(rel)) {
			throw new Error(`Makefile '${rel}' is already registered`);
		}

		const info: MakefileInfo = {
			path,
			isParsed: false,
		};

		this._makefiles.set(rel, info);
		return info;
	}

	selectMakefile(path: IBuildPath): MakefileInfo | null {
		const info = this._makefiles.get(path.rel());
		if (info) return { ...info };
		return null;
	}

	updateMakefile(info: MakefileInfo): void {
		const rel = info.path.rel();
		const stored = this._makefiles.get(rel);
		if (!stored) {
			throw new Error(`Makefile '${rel}' not found`);
		}

		Object.assign(stored, info);
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

	selectRules(): RuleInfo[] {
		return Array.from(this._rules);
	}

	selectTargets(): TargetInfo[] {
		return Array.from(this._targets.values());
	}

	selectTarget(path: IBuildPath): TargetInfo | null {
		return this._targets.get(path.rel()) || null;
	}

	private upsertTargetRule(path: IBuildPath, rule: RuleInfo): void {
		const rel = path.rel();
		let targetInfo = this._targets.get(rel);
		if (!targetInfo) {
			targetInfo = {
				path,
				rules: new Set(),
				recipeRule: null,
			};
			this._targets.set(rel, targetInfo);
		}

		if (rule.recipe) {
			if (isRuleID(targetInfo.recipeRule))
				throw new Error(
					`Target '${rel}' already has a recipe specified. Cannot add another one.`,
				);

			targetInfo.recipeRule = rule.id;
		}

		targetInfo.rules.add(rule.id);
	}
}
