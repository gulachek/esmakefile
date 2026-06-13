# esmakefile OpenTelemetry Conventions

This document details semantic conventions specific to
esmakefile. This follows the pattern of [OpenTelemetry Semantic
Conventions](https://opentelemetry.io/docs/concepts/semantic-conventions/).

## Child Process Output

When a child process is run during execution of an esmakefile
process, the output (stdout/stderr) should be captured and
stored in an artifact. Currently, the only supported content
type for the output is `application/x-ansi-terminal-stream`.

Then, an `EVENT_RECIPE_CHILD_PROCESS_OUTPUT` event should be
emitted with an appropriate `LogLevel` representing whether the
process succeeded or failed (usually based on exit code). This
event needs to have an `ATTR_ARTIFACT_ID` attribute set to the
uploade process output artifact ID.

On artifact upload failure, the
`EVENT_RECIPE_CHILD_PROCESS_OUTPUT_UPLOAD_EXCEPTION` should be
emitted with `LogLevel.error` and annotated with the exception
thrown by `ArtifactStore.put`.

See the following example for more detail (or refer to the
implementation of esmakefile's `spawn`).

```js
import { spawn } from 'node:child_process';
import {
	getLogger,
	getArtifactStore,
	LogLevel,
	ATTR_ARTIFACT_ID,
	EVENT_RECIPE_CHILD_PROCESS_OUTPUT,
	EVENT_RECIPE_CHILD_PROCESS_OUTPUT_UPLOAD_EXCEPTION,
	MIME_TYPE_ANSI_STREAM,
	Vt100Stream,
} from 'esmakefile';

// Recipe function
async function useSpawn(args) {
	// spawn implements the semantic convention for you
	return args.spawn('echo', ['hello', 'world']);
}

async function doItMyself() {
	// only do this if esmakefile's spawn doesn't work for your need
	const logger = getLogger({ name: 'my.logger' });
	const proc = spawn('echo', ['hello', 'world'], { stdio: 'pipe' });

	// Capture the process output
	const stream = new Vt100Stream();
	proc.stdout.pipe(stream, { end: false });
	proc.stderr.pipe(stream, { end: false });

	return new Promise((res) => {
		proc.on('close', async (code) => {
			stream.end();
			const content = stream.contents();
			if (content.length > 0) {
				const store = getArtifactStore();

				try {
					// Store output as an artifact with expected content type
					const artifactId = await store.put({
						content,
						contentType: MIME_TYPE_ANSI_STREAM,
					});

					// Emit an event annotated with artifact ID
					logger.emit({
						eventName: EVENT_RECIPE_CHILD_PROCESS_OUTPUT,
						level: code === 0 ? LogLevel.info : LogLevel.error,
						// Give a display message
						body: 'Running echo',
						attributes: { [ATTR_ARTIFACT_ID]: artifactId },
					});
				} catch (e) {
					// Emit an upload exception event on failure
					logger.error({
						eventName: EVENT_RECIPE_CHILD_PROCESS_OUTPUT_UPLOAD_EXCEPTION,
						body: `Output from 'echo' failed to upload`,
						exception: e,
					});
				}
			}
			res(code === 0);
		});
	});
}
```
