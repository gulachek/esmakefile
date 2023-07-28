require('jasmine');

import {
	Cookbook,
	IRecipe,
	BuildPathLike,
	BuildPath,
	BuildPathGenOpts,
	Path,
	PathLike,
	IRecipeBuildArgs,
} from '..';
import { writeFile, copyFile, readFile, rm, stat } from 'node:fs/promises';

import path from 'node:path';

class WriteFileRecipe implements IRecipe<WriteFileRecipe> {
	readonly path: BuildPath;
	private _buildCount: number = 0;
	private _txt: string;

	constructor(path: BuildPathLike, txt: string) {
		this.path = BuildPath.from(path);
		this._txt = txt;
	}

	get buildCount() {
		return this._buildCount;
	}

	targets() {
		return this.path;
	}

	async buildAsync(args: IRecipeBuildArgs<WriteFileRecipe>) {
		++this._buildCount;
		await writeFile(args.targets, this._txt, 'utf8');
		return true;
	}
}

class CopyFileRecipe implements IRecipe<CopyFileRecipe> {
	readonly src: Path;
	readonly dest: BuildPath;
	private _buildCount: number = 0;

	constructor(src: PathLike, genOpts?: BuildPathGenOpts) {
		this.src = Path.src(src);
		this.dest = BuildPath.gen(this.src, genOpts);
	}

	get buildCount() {
		return this._buildCount;
	}

	sources() {
		return this.src;
	}

	targets() {
		return this.dest;
	}

	async buildAsync(args: IRecipeBuildArgs<CopyFileRecipe>): Promise<boolean> {
		++this._buildCount;
		await copyFile(args.sources, args.targets);
		return true;
	}
}

function mkBook(testCase: string): Cookbook {
	const srcRoot = path.resolve(__dirname, '..', '..', 'test-cases', testCase);

	return new Cookbook({ srcRoot });
}

function waitMs(ms: number): Promise<void> {
	return new Promise((res) => setTimeout(res, ms));
}

describe('Cookbook', () => {
	describe('targets', () => {
		it('lists targets by path relative to build dir', () => {
			const book = new Cookbook();
			book.add(new WriteFileRecipe('write.txt', 'hello'));
			book.add(new CopyFileRecipe('src.txt', '/sub/dest.txt'));

			const targets = new Set(book.targets());

			expect(targets.size).toEqual(2);
			expect(targets.has('write.txt')).toBeTrue();
			expect(targets.has('sub/dest.txt')).toBeTrue();
		});
	});

	describe('write-hello', () => {
		const book = mkBook('write-hello');
		const helloTxt = 'Hello world!';
		const helloPath = BuildPath.from('hello.txt');
		const cpPath = BuildPath.from('copy/hello.txt');
		const write = new WriteFileRecipe(helloPath, helloTxt);
		const copy = new CopyFileRecipe(helloPath, cpPath);

		beforeEach(async () => {
			book.add(write);
			book.add(copy);

			await rm(book.buildRoot, { recursive: true } as any);
			await book.build(cpPath);
		});

		it("builds the target's dependency", async () => {
			const hello = await readFile(book.abs(helloPath), 'utf8');
			expect(hello).toEqual(helloTxt);
		});

		it('ensures a target directory exists before building', async () => {
			const cpDir = book.abs(cpPath.dir);
			const dirStat = await stat(cpDir);
			expect(dirStat.isDirectory()).toBeTrue();
		});

		it("builds a target after it's dependency", async () => {
			const hello = await readFile(book.abs(cpPath), 'utf8');
			expect(hello).toEqual(helloTxt);
		});

		it('skips building target if newer than sources', async () => {
			// already built with buildAll, so rebuild and check
			const preBuildCount = copy.buildCount;
			await book.build(cpPath);
			expect(copy.buildCount).toEqual(preBuildCount);
		});

		it('rebuilds target if older than sources', async () => {
			// already built with buildAll, so rebuild and check
			const preBuildCount = copy.buildCount;
			await waitMs(2); // paranoid about stuff happening sub ms
			await writeFile(book.abs(helloPath), 'Different text');
			await book.build(cpPath);
			expect(copy.buildCount).toEqual(preBuildCount + 1);
		});
	});
});
