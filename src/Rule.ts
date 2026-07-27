import { spawn } from 'node-pty';
import './fixNodePty.js'; // address microsoft/node-pty#919
import { getLogger, Logger, LogLevel } from './logs.js';
import {
	ATTR_ARTIFACT_ID,
	EVENT_RECIPE_CHILD_PROCESS_OUTPUT,
	EVENT_RECIPE_CHILD_PROCESS_OUTPUT_UPLOAD_EXCEPTION,
	MIME_TYPE_ANSI_STREAM,
} from './names.js';
import { getArtifactStore } from './artifacts.js';
import { MakeDatabase, RuleInfo } from './MakeDatabase.js';

/**
 * A rule definition
 */
export interface IRule {
	/**
	 * Target files that are outputs of the rule's recipe
	 */
	targets(): string | string[];

	/**
	 * Files that the rule needs to execute the recipe
	 */
	prereqs?(): string | string[];

	/**
	 * Generate targets from prereqs
	 */
	recipe?(args: RecipeArgs): Promise<boolean | void> | boolean | void;
}

export class RecipeArgs {
	private _log: Logger;
	private _db: MakeDatabase;
	private _rule: RuleInfo;
	private _didRestat = false;

	constructor(db: MakeDatabase, rule: RuleInfo) {
		this._log = getLogger({ name: 'esmakefile.RecipeArgs' });
		this._db = db;
		this._rule = rule;
	}

	restat(): void {
		this._log.debug('restat requested');

		if (!this._didRestat) {
			this._db.updateRuleRestat(this._rule, true);
			this._didRestat = true;
		}
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
