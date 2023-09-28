import {
	IRule,
	RecipeArgs,
	RecipeFunction,
	rulePrereqs,
	ruleRecipe,
	ruleTargets,
} from './Rule.js';
import { Mutex, UnlockFunction } from './Mutex.js';
import { IBuildPath, BuildPathLike, Path } from './Path.js';
import { Build, RecipeID, RuleInfo, isRecipeID, IBuild } from './Build.js';

import { FSWatcher } from 'node:fs';
import { resolve } from 'node:path';
import { watch } from 'node:fs';
import EventEmitter from 'node:events';

export interface ICookbookOpts {
	buildRoot?: string;
	srcRoot?: string;
}

type Prereqs = Path | Path[];
type Targets = IBuildPath | IBuildPath[];

function isRule(ruleOrTargets: IRule | Targets): ruleOrTargets is IRule {
	return 'targets' in ruleOrTargets;
}

type TargetInfo = {
	rules: Set<RecipeID>;
	recipeRule: RecipeID | null;
};

export class Cookbook {
	readonly buildRoot: string;
	readonly srcRoot: string;

	private _mutex = new Mutex();
	private _buildLock: UnlockFunction | null = null;
	private _rules: RuleInfo[] = []; // index is RecipeID
	private _targets = new Map<string, TargetInfo>();

	private _prevBuild: Build | null = null;

	constructor(opts?: ICookbookOpts) {
		opts = opts || {};
		this.srcRoot = resolve(opts.srcRoot || '.');
		this.buildRoot = resolve(opts.buildRoot || 'build');
	}

	add(rule: IRule): RecipeID;
	add(targets: Targets, recipe: RecipeFunction): RecipeID;
	add(targets: Targets, prereqs: Prereqs, recipe?: RecipeFunction): RecipeID;
	add(
		ruleOrTargets: IRule | Targets,
		prereqsOrRecipe?: Prereqs | RecipeFunction,
		recipeFn?: RecipeFunction,
	): RecipeID {
		let rule: IRule;
		if (recipeFn) {
			// targets, prereqs, recipe
			rule = {
				targets() {
					return ruleOrTargets as Targets;
				},
				prereqs() {
					return prereqsOrRecipe as Prereqs;
				},
				recipe: recipeFn,
			};
		} else if (typeof prereqsOrRecipe === 'function') {
			// targets, recipe
			rule = {
				targets() {
					return ruleOrTargets as Targets;
				},
				recipe: prereqsOrRecipe,
			};
		} else if (prereqsOrRecipe) {
			// targets, prereqs
			rule = {
				targets() {
					return ruleOrTargets as Targets;
				},
				prereqs() {
					return prereqsOrRecipe;
				},
			};
		} else if (isRule(ruleOrTargets)) {
			// rule
			rule = ruleOrTargets;
		} else {
			// targets
			throw new Error(`Added targets without any prereqs or recipe`);
		}

		const unlock = this._mutex.tryLock();
		if (!unlock) {
			throw new Error('Cannot add while build is in progress');
		}

		try {
			const id: RecipeID = this._rules.length;
			const info = this.normalizeRecipe(id, rule);
			const hasRecipe = !!info.recipe;
			this._rules.push(info);

			for (const p of info.targets) {
				const rel = p.rel();
				let targetInfo = this._targets.get(rel);
				if (!targetInfo) {
					targetInfo = {
						rules: new Set(),
						recipeRule: null,
					};
					this._targets.set(rel, targetInfo);
				}

				if (hasRecipe) {
					if (isRecipeID(targetInfo.recipeRule))
						throw new Error(
							`Target '${rel}' already has a recipe specified. Cannot add another one.`,
						);

					targetInfo.recipeRule = id;
				}

				targetInfo.rules.add(id);
			}

			return id;
		} finally {
			unlock();
		}
	}

	targets() {
		return [...this._targets.keys()];
	}

	async watch(): Promise<void> {
		await this.build();

		const watcher = new SourceWatcher(this.srcRoot, { debounceMs: 300 });

		console.log(
			`Watching '${this.srcRoot}'\nClose input stream to stop (usually Ctrl+D)`,
		);

		let foundChange = false;
		watcher.on('change', async () => {
			if (foundChange) return;
			foundChange = true;
			this._buildLock = await this._mutex.lockAsync();
			foundChange = false;

			try {
				await this.build();
			} finally {
				this._buildLock && this._buildLock();
				this._buildLock = null;
			}
		});

		watcher.on('unknown', (type: string) => {
			console.log(`Unhandled event type '${type}'`);
		});

		const closePromise = new Promise<void>((res) => {
			watcher.on('close', () => res());
		});

		process.stdin.on('close', () => {
			watcher.close();
		});

		process.stdin.on('data', () => {
			// drain input
			process.stdin.read();
		});

		return closePromise;
	}

	private _recipe(target: BuildPathLike): RecipeID | null {
		const rel = typeof target === 'string' ? target : target.rel();
		const info = this._targets.get(rel);
		if (!info) return null;

		const { recipeRule } = info;
		if (isRecipeID(recipeRule)) return recipeRule;
		return null;
	}

	/**
	 * Top level build function. Runs exclusively
	 * @param target The target to build
	 * @param cb Callback to be invoked with IBuild observing the current build
	 * @returns A promise that resolves when the build is done
	 */
	async build(
		target?: IBuildPath,
		cb?: (build: IBuild) => Promise<void>,
	): Promise<boolean> {
		let unlock: UnlockFunction | null = null;
		if (!this._buildLock) {
			unlock = await this._mutex.lockAsync();
		}

		let result = true;

		try {
			const prevBuildAbs = this.abs(
				Path.build('__gulpachek__/previous-build.json'),
			);

			const recipe = target && this._recipe(target);

			const recipes = isRecipeID(recipe) ? [recipe] : this.__topLevelRecipes();

			this._prevBuild = this._prevBuild || (await Build.readFile(prevBuildAbs));
			const curBuild = new Build({
				rules: this._rules,
				prevBuild: this._prevBuild,
				buildRoot: this.buildRoot,
				srcRoot: this.srcRoot,
			});

			await cb?.(curBuild);

			result = await curBuild.runAll(recipes);

			await curBuild.writeFile(prevBuildAbs);
			this._prevBuild = curBuild;
		} finally {
			unlock && unlock();
		}

		return result;
	}

	private *__topLevelRecipes(): Generator<RecipeID> {
		// top level recipes are those that nobody depends on
		const srcIds = new Set<RecipeID>();

		for (let id = 0; id < this._rules.length; ++id) {
			const info = this._rules[id];

			const prevBuild = this._prevBuild;
			if (prevBuild) {
				const runtimeSrc = prevBuild.runtimeSrc(info.targets[0]);
				for (const src of runtimeSrc) {
					const srcId = this._recipe(src);
					if (isRecipeID(srcId)) srcIds.add(srcId);
				}
			}

			const { sources } = info;
			for (const s of sources) {
				if (!s.isBuildPath()) continue;
				const srcId = this._recipe(s);
				if (isRecipeID(srcId)) srcIds.add(srcId);
			}
		}

		for (let id = 0; id < this._rules.length; ++id) {
			if (!srcIds.has(id)) {
				yield id;
			}
		}
	}

	abs(path: Path): string {
		return path.abs({
			src: this.srcRoot,
			build: this.buildRoot,
		});
	}

	normalizeRecipe(id: RecipeID, rule: IRule): RuleInfo {
		const prereqs = rulePrereqs(rule);
		const targets = ruleTargets(rule);
		const innerRecipe = ruleRecipe(rule);

		let recipe: (build: Build) => Promise<boolean> | null = null;
		if (innerRecipe) {
			recipe = async (build: Build) => {
				const src = new Set<string>();
				const stream = build.createLogStream(id);
				const recipeArgs = new RecipeArgs(this, src, stream);

				const result = await innerRecipe(recipeArgs);

				build.addRuntimeSrc(id, src);

				return result;
			};
		}

		const name = recipeName(rule, targets);
		return { sources: prereqs, targets, recipe, name };
	}
}

class SourceWatcher extends EventEmitter {
	private _watcher: FSWatcher;
	private _debounceMs: number;
	private _count: number = 0;

	constructor(dir: string, opts: { debounceMs: number }) {
		super();
		this._debounceMs = opts.debounceMs;

		this._watcher = watch(dir, { recursive: true });
		this._watcher.on('change', this._onChange.bind(this));
		this._watcher.on('close', () => this.emit('close'));
	}

	close() {
		this._watcher.close();
	}

	private _onChange(type: string): void {
		if (type === 'rename') {
			this._queueChange();
		} else {
			this.emit('unknown', type);
		}
	}

	private _queueChange() {
		const count = ++this._count;
		setTimeout(() => {
			if (this._count === count) {
				this.emit('change');
			}
		}, this._debounceMs);
	}
}

function recipeName(recipe: IRule, targets: IBuildPath[]): string {
	const ctorName = recipe.constructor.name;
	const targetNames = targets.map((p) => p.rel()).join(', ');
	return `${ctorName}{${targetNames}}`;
}
