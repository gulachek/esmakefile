require('jasmine-core');

import { BuildSystem, Path, writeFile } from '../index';

import { readFileSync, unlinkSync } from 'fs';

describe('writeFile', () => {
	const sys = new BuildSystem();
	const f = Path.dest('file.txt');

	afterEach(() => {
		unlinkSync(sys.abs(f));
	});

	it('writes hello world', async () => {
		const w = writeFile(sys, f, 'hello world');
		await sys.build(w);
		const contents = readFileSync(w.abs, 'utf8');
		expect(contents).toEqual('hello world');
	});
});
