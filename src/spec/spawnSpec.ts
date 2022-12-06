require('jasmine-core');

import { BuildSystem, Path, spawnTarget } from '../index';

import { readFileSync, unlinkSync } from 'node:fs';
import { Readable } from 'node:stream';
import { ChildProcess } from 'node:child_process';

function streamToString (stream: Readable): Promise<string> {
	const chunks: Buffer[] = [];
	return new Promise((res, rej) => {
		stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
		stream.on('error', (err) => rej(err));
		stream.on('end', () => res(Buffer.concat(chunks).toString('utf8')));
	})
}

describe('spawn', () => {
	const sys = new BuildSystem();
	const f = Path.dest('file.txt');

	it('echoes hello world', async () => {
		const t = spawnTarget(
			sys,
			process.execPath,
			['-e', 'console.log("hello world");'],
			{ stdio: 'pipe' }
		);

		let content: Promise<string> = Promise.resolve('');
		t.on('spawn', (proc: ChildProcess) => {
			content = streamToString(proc.stdout);
		});

		await sys.build(t);
		expect(await content).toEqual("hello world\n");
	});
});
