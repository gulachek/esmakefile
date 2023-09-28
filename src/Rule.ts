import { IBuildPath, Path } from './Path.js';
import { Cookbook } from './Cookbook.js';
import { isAbsolute } from 'node:path';
import { Writable } from 'node:stream';
import { spawn } from 'node:child_process';

/**
 * A rule to build targets from sources
 */
export interface IRule {
	/**
	 * Target files that are outputs of the rule's build
	 */
	targets(): IBuildPath | IBuildPath[];

	/**
	 * Files that the rule needs to build recipe
	 */
	prereqs?(): Path | Path[];

	/**
	 * Generate targets from sources
	 */
	recipe?(args: RecipeArgs): Promise<boolean>;
}

export class RecipeArgs {
	private _book: Cookbook;
	private _postreqs: Set<string>;
	readonly logStream: Writable;

	constructor(book: Cookbook, postreqs: Set<string>, logStream: Writable) {
		this._book = book;
		this._postreqs = postreqs;
		this.logStream = logStream;
	}

	abs(path: Path): string;
	abs(...paths: Path[]): string[];
	abs(...paths: Path[]): string | string[] {
		if (paths.length === 1) {
			return this._book.abs(paths[0]);
		}

		return paths.map((p) => this._book.abs(p));
	}

	addPostreq(abs: string): void {
		if (!isAbsolute(abs))
			throw new Error(
				`addPostreq: argument must be an absolute path. '${abs}' given.`,
			);

		this._postreqs.add(abs);
	}

	async spawn(cmd: string, cmdArgs: string[]): Promise<boolean> {
		const proc = spawn(cmd, cmdArgs, { stdio: 'pipe' });

		proc.stdout.pipe(this.logStream);
		proc.stderr.pipe(this.logStream);

		return new Promise<boolean>((res) => {
			proc.on('close', (code) => {
				res(code === 0);
			});
		});
	}
}

export function rulePrereqs(rule: IRule): Path[] {
	if (typeof rule.prereqs === 'function') {
		return normalize(rule.prereqs());
	}

	return [];
}

export function ruleTargets(rule: IRule): IBuildPath[] {
	return normalize(rule.targets());
}

export type RecipeFunction = (args: RecipeArgs) => Promise<boolean>;

export function ruleRecipe(rule: IRule): RecipeFunction | null {
	if (rule.recipe) return rule.recipe.bind(rule);
	return null;
}

type OneOrMany<T> = T | T[];

function normalize<T>(val: OneOrMany<T>): T[] {
	if (Array.isArray(val)) {
		return val;
	}

	return [val];
}
