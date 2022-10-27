require('jasmine-core');

import { BuildSystem, Path, writeFile } from '../index';

import { readFileSync, unlinkSync } from 'fs';

describe('writeFile', () => {
	const sys = new BuildSystem();
	const f = Path.dest('file.txt');

	it('writes hello world', async () => {
		const w = writeFile(sys, f, 'hello world');
		await sys.build(w);
		const contents = readFileSync(w.abs, 'utf8');
		expect(contents).toEqual('hello world');
	});

	// this is a duplicate test case because we want to catch
	// that not only do the file times matter but also the
	// programmatic inputs to a target
	it('writes hello world2', async () => {
		const w = writeFile(sys, f, 'hello world2');
		await sys.build(w);
		const contents = readFileSync(w.abs, 'utf8');
		expect(contents).toEqual('hello world2');
	});
});
