import { isAbsolute } from 'node:path';
import { Vt100Stream } from './Vt100Stream.js';
import { spawn } from 'node:child_process';
import { getLogger, Logger, LogLevel } from './logs.js';
import {
	ATTR_ARTIFACT_ID,
	EVENT_RECIPE_CHILD_PROCESS_OUTPUT,
	EVENT_RECIPE_CHILD_PROCESS_OUTPUT_UPLOAD_EXCEPTION,
	MIME_TYPE_ANSI_STREAM,
} from './names.js';
import { getArtifactStore } from './artifacts.js';

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

	constructor() {
		this._log = getLogger({ name: 'esmakefile.RecipeArgs' });
	}

	async spawn(cmd: string, cmdArgs: string[]): Promise<boolean> {
		// TODO - should be tracing child processes
		if (this._log.enabled({ level: LogLevel.debug })) {
			this._log.debug(
				`spawn(${JSON.stringify(cmd)}, ${JSON.stringify(cmdArgs)})`,
			);
		}
		const proc = spawn(cmd, cmdArgs, { stdio: 'pipe' });

		const stream = new Vt100Stream();
		proc.stdout.pipe(stream, { end: false });
		proc.stderr.pipe(stream, { end: false });

		return new Promise<boolean>((res) => {
			proc.on('close', async (code) => {
				stream.end();
				const content = stream.contents();
				if (content.length > 0) {
					const store = getArtifactStore();

					try {
						// TODO expose this for consumers
						const artifactId = await store.put({
							content,
							contentType: MIME_TYPE_ANSI_STREAM,
						});

						this._log.emit({
							eventName: EVENT_RECIPE_CHILD_PROCESS_OUTPUT,
							level: code === 0 ? LogLevel.info : LogLevel.error,
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
				res(code === 0);
			});
		});
	}
}
