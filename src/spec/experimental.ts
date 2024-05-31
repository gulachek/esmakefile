import { Makefile, experimental, Path } from '../index.js';

import { writeFile, readFile, rm, mkdir, chmod } from 'node:fs/promises';

import { expect } from 'chai';

import { resolve } from 'node:path';
import { existsSync, statSync } from 'node:fs';

import exUpdate = experimental.updateTarget;

describe('experimental', () => {
	describe('updateTarget', () => {
		let make: Makefile;

		function writePath(path: Path, contents: string): Promise<void> {
			return writeFile(make.abs(path), contents, 'utf8');
		}

		function readPath(path: Path): Promise<string> {
			return readFile(make.abs(path), 'utf8');
		}

		const srcRoot = resolve('test-src');
		const buildRoot = resolve(srcRoot, 'build');

		function resetMakefile(): void {
			make = new Makefile({ srcRoot, buildRoot });
		}

		beforeEach(async () => {
			if (statSync(buildRoot, { throwIfNoEntry: false })) {
				await chmod(buildRoot, 0o777);
			}

			const stats = statSync(srcRoot, { throwIfNoEntry: false });
			if (stats) {
				await chmod(srcRoot, 0o777);
				await rm(srcRoot, { recursive: true });
				expect(existsSync(srcRoot)).to.be.false;
			}

			await mkdir(srcRoot, { recursive: true });

			resetMakefile();
		});

		it('builds a target', async () => {
			const path = Path.build('output.txt');

			make.add(path, async () => {
				await writePath(path, 'hello');
			});

			const { result } = await exUpdate(make, path);
			const contents = await readPath(path);
			expect(contents).to.equal('hello');
			expect(result).to.be.true;
		});

		it('has the contents of the console log', async () => {
			const id = make.add('target', (args) => {
				args.logStream.write('hello');
			});

			const { recipes } = await exUpdate(make);
			expect(recipes.get(id).consoleOutput).to.equal('hello');
		});

		it('has empty string output when nothing logged', async () => {
			const succeed = make.add('succeeds', () => true);

			const { recipes } = await exUpdate(make, 'succeeds');
			expect(recipes.get(succeed).consoleOutput).to.equal('');
		});

		it('has the results of each recipe', async () => {
			const succeed = make.add('succeeds', () => true);
			const fail = make.add('fails', 'succeeds', () => false);

			const { recipes } = await exUpdate(make, 'fails');
			expect(recipes.get(succeed).result).to.be.true;
			expect(recipes.get(fail).result).to.be.false;
		});

		it('has errors', async () => {
			make.add('cycle', 'cycle');

			const { result, errors } = await exUpdate(make);
			expect(result).to.be.false;
			expect(errors.length).to.be.greaterThan(0);
		});

		it('has warnings', async () => {
			const prereq = Path.src('prereq');
			const stale = Path.build('stale');
			make.add(stale, async () => {
				await writePath(stale, 'stale');
			});

			const { result } = await exUpdate(make);
			expect(result).to.be.true;

			await waitMs(1);
			await writePath(prereq, 'prereq');

			make = new Makefile({ buildRoot, srcRoot });
			make.add(stale, prereq);

			const newRet = await exUpdate(make, stale);

			expect(newRet.result).to.be.true;
			expect(newRet.warnings.length).to.be.greaterThan(0);
		});
	});
});

function waitMs(ms: number): Promise<void> {
	return new Promise<void>((res) => setTimeout(res, ms));
}
