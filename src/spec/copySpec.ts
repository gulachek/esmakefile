require('jasmine-core');

import { BuildSystem, Target, Path, writeFile, copyFile, copyDir } from '../index';

import { existsSync, rmSync, readFileSync } from 'fs';

describe('copy', () => {
	const sys = new BuildSystem();

	afterEach(() => {
		const abs = sys.abs(Path.dest(''));
		if (existsSync(abs))
			rmSync(abs, { recursive: true });
	});

	describe('copyFile', () => {
		it('copies file to new path', async () => {
			const src = writeFile(sys, 'from/file.txt', 'hello file');
			const dest = copyFile(src, 'to/copy.txt');
			await sys.build(dest);
			const content = readFileSync(dest.abs, 'utf8');
			expect(content).toEqual('hello file');
		});

		it('has copied file"s path', async () => {
			const src = writeFile(sys, 'from/file.txt', 'hello file');
			const dest = copyFile(src, 'to/copy.txt');
			expect(dest.path.components).toEqual(['to', 'copy.txt']);
		});

		it('copies to a directory if basename has no extension', async () => {
			const src = writeFile(sys, 'from/file.txt', 'hello file');
			const dest = copyFile(src, 'to/copy');
			expect(dest.path.components).toEqual(['to', 'copy', 'file.txt']);
		});
	});

	describe('copyDir', () => {
		it('copies all files to directory', async () => {
			const dir = new Target(sys, Path.dest('include'));
			const first = writeFile(sys, dir.path.join('first.txt'), 'first');
			const second = writeFile(sys, dir.path.join('second.txt'), 'second');
			dir.dependsOn(first, second);

			const copy = copyDir(dir, 'pack');

			await sys.build(copy);

			const firstCp = copy.path.join('first.txt');
			const secondCp = copy.path.join('second.txt');
			expect(readFileSync(sys.abs(firstCp), 'utf8')).toEqual('first');
			expect(readFileSync(sys.abs(secondCp), 'utf8')).toEqual('second');
		});
	});
});
