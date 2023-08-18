import { IBuildPath, Path } from './Path';

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

export type RecipeID = number;

export function isRecipeID(id: any): id is RecipeID {
	return typeof id === 'number';
}

export type RecipeInfo = {
	buildAsync(): Promise<boolean>;
	sources: Path[];
	targets: IBuildPath[];
};

interface IBuildJson {
	targets: [string, RecipeID][];
	sources: [RecipeID, string[]][];
	runtimeSrc: [RecipeID, string[]][];
}

interface IBuildOpts {
	recipes: RecipeInfo[];
}

export class Build {
	private _runtimeSrcMap = new Map<RecipeID, Set<string>>();
	private _sources = new Map<RecipeID, Set<string>>();
	private _targets = new Map<string, RecipeID>();

	constructor(opts?: IBuildOpts) {
		if (opts) {
			const { recipes } = opts;
			for (let id = 0; id < recipes.length; ++id) {
				const { targets, sources } = recipes[id];
				this.register(id, targets, sources);
			}
		}
	}

	static async readFile(abs: string): Promise<Build | null> {
		try {
			const contents = await readFile(abs, 'utf8');
			const json = JSON.parse(contents) as IBuildJson;
			const results = new Build();

			for (const [rel, id] of json.targets) {
				results._targets.set(rel, id);
			}

			for (const [recipe, src] of json.runtimeSrc) {
				results._runtimeSrcMap.set(recipe, new Set<string>(src));
			}

			for (const [recipe, src] of json.sources) {
				results._sources.set(recipe, new Set<string>(src));
			}

			return results;
		} catch {
			return null;
		}
	}

	async writeFile(abs: string): Promise<void> {
		const json: IBuildJson = {
			runtimeSrc: [],
			targets: [],
			sources: [],
		};

		for (const [recipe, src] of this._runtimeSrcMap) {
			json.runtimeSrc.push([recipe, [...src]]);
		}

		for (const [recipe, src] of this._sources) {
			json.sources.push([recipe, [...src]]);
		}

		for (const [target, recipe] of this._targets) {
			json.targets.push([target, recipe]);
		}

		await mkdir(dirname(abs), { recursive: true });
		await writeFile(abs, JSON.stringify(json), 'utf8');
	}

	addRuntimeSrc(recipe: RecipeID, srcAbs: Set<string>): void {
		this._runtimeSrcMap.set(recipe, srcAbs);
	}

	private register(
		recipe: RecipeID,
		targets: IBuildPath[],
		sources: Path[],
	): void {
		for (const t of targets) {
			this._targets.set(t.rel(), recipe);
		}

		this._sources.set(recipe, new Set(sources.map((p) => p.rel())));
	}

	runtimeSrc(target: IBuildPath): Set<string> {
		const recipe = this._targets.get(target.rel());
		const src = isRecipeID(recipe) && this._runtimeSrcMap.get(recipe);
		if (src) return src;
		return new Set<string>();
	}
}
