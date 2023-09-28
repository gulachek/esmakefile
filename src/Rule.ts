import { IBuildPath, Path } from './Path.js';
import { Cookbook } from './Cookbook.js';
import { SimpleShape, MappedShape } from './SimpleShape.js';
import { isAbsolute } from 'node:path';
import { Writable } from 'node:stream';
import { spawn } from 'node:child_process';

type OneOrMany<T> = T | T[];

function normalize<T>(val: OneOrMany<T>): T[] {
	if (Array.isArray(val)) {
		return val;
	}

	return [val];
}

export function rulePrereqs(rule: IRule): Path[] {
	if (typeof rule.prereqs === 'function') {
		return normalize(rule.prereqs());
	}

	return [];
}

/**
 * A rule to build targets from sources
 */
export interface IRule {
	/**
	 * Files that the rule needs to build recipe
	 */
	prereqs?(): Path | Path[];

	/**
	 * Target files that are outputs of the rule's build
	 */
	targets(): TargetPaths;

	/**
	 * Generate targets from sources
	 */
	recipe(args: RecipeArgs): Promise<boolean>;
}

export type SourcePaths = SimpleShape<Path>;

// doesn't make sense to have a null target - would never be built
export type TargetPaths = SimpleShape<IBuildPath>;

export type MappedPaths<T extends IRule> = {
	targets: MappedShape<ReturnType<T['targets']>, string>;
};

export class RecipeArgs {
	private _book: Cookbook;
	private _mappedPaths: MappedPaths<IRule>;
	private _runtimeSrc: Set<string>;
	readonly logStream: Writable;

	constructor(
		book: Cookbook,
		mappedPaths: MappedPaths<IRule>,
		runtimeSrc: Set<string>,
		logStream: Writable,
	) {
		this._book = book;
		this._mappedPaths = mappedPaths;
		this._runtimeSrc = runtimeSrc;
		this.logStream = logStream;
	}

	paths<T extends IRule>(): MappedPaths<T> {
		return this._mappedPaths as MappedPaths<T>;
	}

	abs(path: Path): string;
	abs(...paths: Path[]): string[];
	abs(...paths: Path[]): string | string[] {
		if (paths.length === 1) {
			return this._book.abs(paths[0]);
		}

		return paths.map((p) => this._book.abs(p));
	}

	addSrc(abs: string): void {
		if (!isAbsolute(abs))
			throw new Error(
				`addSrc: argument must be an absolute path. '${abs}' given.`,
			);

		this._runtimeSrc.add(abs);
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
