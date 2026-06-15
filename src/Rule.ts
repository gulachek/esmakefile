import { IBuildPath, IPathRoots, Path } from './Path.js';
import { isAbsolute } from 'node:path';
import { ReadableStream } from 'node:stream/web';
import { spawn } from 'node-pty';
import { getLogger, Logger, LogLevel } from './logs.js';
import {
	ATTR_ARTIFACT_ID,
	EVENT_RECIPE_CHILD_PROCESS_OUTPUT,
	EVENT_RECIPE_CHILD_PROCESS_OUTPUT_UPLOAD_EXCEPTION,
	MIME_TYPE_ANSI_STREAM,
} from './names.js';
import { getArtifactStore } from './artifacts.js';

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
	recipe?(args: RecipeArgs): Promise<boolean | void> | boolean | void;
}

export class RecipeArgs {
	private _roots: IPathRoots;
	private _postreqs: Set<string>;
	private _log: Logger;

	constructor(roots: IPathRoots, postreqs: Set<string>) {
		this._roots = roots;
		this._postreqs = postreqs;
		this._log = getLogger({ name: 'esmakefile.RecipeArgs' });
	}

	abs(path: Path): string {
		return path.abs(this._roots);
	}

	absAll(paths: Iterable<Path>): string[];
	absAll(...paths: Path[]): string[];
	absAll(
		pathOrPaths: Path | Iterable<Path>,
		...rest: Path[]
	): string | string[] {
		const out: string[] = [];
		let iter: Iterable<Path>;

		if (!isIterable(pathOrPaths)) {
			out.push(pathOrPaths.abs(this._roots));
			iter = rest;
		}

		for (const p of iter) out.push(p.abs(this._roots));

		return out;
	}

	addPostreq(abs: string): void {
		if (!isAbsolute(abs))
			throw new Error(
				`addPostreq: argument must be an absolute path. '${abs}' given.`,
			);

		this._postreqs.add(abs);
	}

	async spawn(cmd: string, cmdArgs: string[]): Promise<boolean> {
		// TODO - should be tracing child processes
		if (this._log.enabled({ level: LogLevel.debug })) {
			this._log.debug(
				`spawn(${JSON.stringify(cmd)}, ${JSON.stringify(cmdArgs)})`,
			);
		}
		const proc = spawn(cmd, cmdArgs, {});

		let enqueue: (chunk: Uint8Array) => void;
		let close: () => void;
		const content = new ReadableStream<Uint8Array>({
			start(c) {
				enqueue = c.enqueue.bind(c);
				close = c.close.bind(c);
			},
		});

		let hasOutput = false;
		proc.onData((data) => {
			hasOutput = true;
			enqueue(Buffer.from(data));
		});

		const store = getArtifactStore();
		const putPromise = store.putStream({
			content,
			contentType: MIME_TYPE_ANSI_STREAM,
		});
		// Prevent unhandled rejection warning; errors are caught in onExit
		putPromise.catch(() => {});

		return new Promise<boolean>((res) => {
			proc.onExit(async ({ exitCode }) => {
				close();

				if (hasOutput) {
					try {
						// TODO expose this for consumers
						const artifactId = await putPromise;
						this._log.emit({
							eventName: EVENT_RECIPE_CHILD_PROCESS_OUTPUT,
							level: exitCode === 0 ? LogLevel.info : LogLevel.error,
							body: `Output from '${cmd}'`,
							attributes: { [ATTR_ARTIFACT_ID]: artifactId },
						});
					} catch (e) {
						this._log.error({
							eventName: EVENT_RECIPE_CHILD_PROCESS_OUTPUT_UPLOAD_EXCEPTION,
							body: `Output from '${cmd}' failed to upload`,
							exception: e,
						});
					}
				}

				res(exitCode === 0);
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

export type RecipeFunction = (
	args: RecipeArgs,
) => Promise<boolean | void> | boolean | void;

export function ruleRecipe(
	rule: IRule,
): (args: RecipeArgs) => Promise<boolean> | null {
	if (rule.recipe) {
		return async (args: RecipeArgs) => {
			const result = await rule.recipe(args);
			if (typeof result === 'undefined') return true;
			return result;
		};
	}

	return null;
}

type OneOrMany<T> = T | T[];

function normalize<T>(val: OneOrMany<T>): T[] {
	if (Array.isArray(val)) {
		return val;
	}

	return [val];
}

function isIterable<T>(obj: object): obj is Iterable<T> {
	return (
		obj && Symbol.iterator in obj && typeof obj[Symbol.iterator] === 'function'
	);
}
