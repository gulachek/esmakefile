import { IBuildPath, Path } from './Path.js';
import { SimpleShape, MappedShape } from './SimpleShape.js';
import { isAbsolute } from 'node:path';
import { Writable } from 'node:stream';
import { spawn } from 'node:child_process';

/**
 * A rule to build targets from sources
 */
export interface IRule {
	/**
	 * Source files that the rule needs to build
	 */
	sources?(): SourcePaths;

	/**
	 * Target files that are outputs of the rule's build
	 */
	targets(): TargetPaths;

	/**
	 * Generate targets from sources
	 */
	buildAsync(args: RecipeBuildArgs): Promise<boolean>;
}

export type SourcePaths = SimpleShape<Path>;

// doesn't make sense to have a null target - would never be built
export type TargetPaths = SimpleShape<IBuildPath>;

type MappedPathsWithSources<T extends IRule> = {
	sources: MappedShape<ReturnType<T['sources']>, string>;
	targets: MappedShape<ReturnType<T['targets']>, string>;
};

type MappedPathsWithoutSources<T extends IRule> = {
	targets: MappedShape<ReturnType<T['targets']>, string>;
};

export type MappedPaths<T extends IRule> = 'sources' extends keyof T
	? MappedPathsWithSources<T>
	: MappedPathsWithoutSources<T>;

export class RecipeBuildArgs {
	private _mappedPaths: MappedPaths<IRule>;
	private _runtimeSrc: Set<string>;
	readonly logStream: Writable;

	constructor(
		mappedPaths: MappedPaths<IRule>,
		runtimeSrc: Set<string>,
		logStream: Writable,
	) {
		this._mappedPaths = mappedPaths;
		this._runtimeSrc = runtimeSrc;
		this.logStream = logStream;
	}

	paths<T extends IRule>(): MappedPaths<T> {
		return this._mappedPaths as MappedPaths<T>;
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
