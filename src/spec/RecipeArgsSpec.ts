import { RecipeArgs } from '../index.js';
import { InMemoryLoggerProvider } from '../InMemoryLoggerProvider.js';
import { LogLevel, setLoggerProvider } from '../logs.js';
import { getArtifactStore, setArtifactStoreImpl } from '../artifacts.js';
import { InMemoryArtifactStore } from '../InMemoryArtifactStore.js';

import { expect } from 'chai';
import {
	ATTR_ARTIFACT_ID,
	EVENT_RECIPE_CHILD_PROCESS_OUTPUT,
	EVENT_RECIPE_CHILD_PROCESS_OUTPUT_UPLOAD_EXCEPTION,
	MIME_TYPE_ANSI_STREAM,
} from '../names.js';
import { MakeDatabase } from '../MakeDatabase.js';

const nodeExe = process.execPath;

function mkArgs(): RecipeArgs {
	const db = new MakeDatabase();
	const rule = db.insertRule({
		targets: ['target'],
		prereqs: ['prereq'],
		recipe: null,
	});
	return new RecipeArgs(db, rule);
}

describe('RecipeArgs', () => {
	let logs: InMemoryLoggerProvider;
	let storeImpl: InMemoryArtifactStore;

	beforeEach(() => {
		logs = new InMemoryLoggerProvider();
		setLoggerProvider(logs);

		storeImpl = new InMemoryArtifactStore();
		setArtifactStoreImpl(storeImpl);
	});

	describe('spawn', () => {
		it('logs an event with uploaded output when the process writes to stdout', async () => {
			const args = mkArgs();
			const result = await args.spawn(nodeExe, ['-e', 'console.log("Hello")']);
			expect(result).to.equal(true);

			const evts = logs.findEvents(EVENT_RECIPE_CHILD_PROCESS_OUTPUT);
			expect(evts.length).to.equal(1);
			const e = evts[0];
			expect(e.level).to.equal(LogLevel.info);

			// make sure it output the content
			const artifactId = e.attributes[ATTR_ARTIFACT_ID] as string;
			expect(typeof artifactId).to.equal('string');

			const artifactStore = getArtifactStore();
			const artifact = await artifactStore.get(artifactId);
			expect(artifact).not.to.equal(null);
			const { content, contentType } = artifact!;
			expect(contentType).to.equal(MIME_TYPE_ANSI_STREAM);
			const contentStr = new TextDecoder('ascii').decode(content);
			expect(contentStr).to.equal('Hello\n');
		});

		it('logs an error event when command output fails to upload', async () => {
			storeImpl.setEnabled(false);

			const args = mkArgs();
			const result = await args.spawn(nodeExe, ['-e', 'console.log("Hello")']);
			expect(result).to.equal(true); // program still exits successfully

			const evts = logs.findEvents(
				EVENT_RECIPE_CHILD_PROCESS_OUTPUT_UPLOAD_EXCEPTION,
			);
			expect(evts.length).to.equal(1);
			const e = evts[0];
			expect(e.level).to.equal(LogLevel.error);
		});

		it('logs an error event with uploaded output when the process write to stdout and exits with non-zero code', async () => {
			const args = mkArgs();
			const result = await args.spawn(nodeExe, [
				'-e',
				'console.log("Hello"); process.exit(1);',
			]);
			expect(result).to.be.false;

			const evts = logs.findEvents(EVENT_RECIPE_CHILD_PROCESS_OUTPUT);
			expect(evts.length).to.equal(1);
			const e = evts[0];
			expect(e.level).to.equal(LogLevel.error);

			// make sure it output the content
			const artifactId = e.attributes[ATTR_ARTIFACT_ID] as string;
			expect(typeof artifactId).to.equal('string');

			const artifactStore = getArtifactStore();
			const artifact = await artifactStore.get(artifactId);
			expect(artifact).not.to.equal(null);
			const { content, contentType } = artifact!;
			expect(contentType).to.equal(MIME_TYPE_ANSI_STREAM);
			const contentStr = new TextDecoder('ascii').decode(content);
			expect(contentStr).to.equal('Hello\n');
		});
	});
});
