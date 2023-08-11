require('jasmine');

import {
	Cookbook,
	IRecipe,
	BuildPathLike,
	BuildPath,
	BuildPathGenOpts,
	Path,
	PathLike,
	RecipeBuildArgs,
} from '..';
import {
	writeFile,
	copyFile,
	readFile,
	rm,
	stat,
	open,
} from 'node:fs/promises';

import path, { dirname, resolve } from 'node:path';

async function rmDir(dirAbs: string): Promise<void> {
	try {
		await rm(dirAbs, { recursive: true });
	} catch {}
}

class WriteFileRecipe implements IRecipe {
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

	async buildAsync(args: RecipeBuildArgs) {
		const { targets } = args.paths<WriteFileRecipe>();
		++this._buildCount;
		await writeFile(targets, this._txt, 'utf8');
		return true;
	}
}

class CopyFileRecipe implements IRecipe {
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

	async buildAsync(args: RecipeBuildArgs): Promise<boolean> {
		const { sources, targets } = args.paths<CopyFileRecipe>();
		++this._buildCount;
		try {
			await copyFile(sources, targets);
			return true;
		} catch {
			return false;
		}
	}
}

class CatFilesRecipe implements IRecipe {
	readonly src: Path;
	readonly dest: BuildPath;
	buildCount: number = 0;

	constructor(src: Path, genOpts?: BuildPathGenOpts) {
		this.src = src;
		this.dest = BuildPath.gen(src, genOpts);
	}

	targets() {
		return this.dest;
	}
	sources() {
		return this.src;
	}

	async buildAsync(args: RecipeBuildArgs): Promise<boolean> {
		const { sources, targets } = args.paths<CatFilesRecipe>();
		const srcDir = dirname(sources);
		++this.buildCount;
		const catSrc = await readFile(sources, 'utf8');
		const lines = catSrc.split('\n');

		const handle = await open(targets, 'w');
		for (const line of lines) {
			if (!line) continue;
			const path = resolve(srcDir, line);
			args.addSrc(path);
			const contents = await readFile(path, 'utf8');
			await handle.appendFile(contents);
		}

		await handle.close();
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
		let book: Cookbook;
		let write: WriteFileRecipe;
		let copy: CopyFileRecipe;

		const helloTxt = 'Hello world!';
		const helloPath = BuildPath.from('hello.txt');
		const cpPath = BuildPath.from('copy/hello.txt');

		beforeEach(async () => {
			book = mkBook('write-hello');
			write = new WriteFileRecipe(helloPath, helloTxt);
			copy = new CopyFileRecipe(helloPath, cpPath);
			book.add(write);
			book.add(copy);

			await rm(book.buildRoot, { recursive: true });
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

		it('y0b0: you only build once. calling build while building results in one build', async () => {
			const preBuildCount = copy.buildCount;
			await writeFile(book.abs(helloPath), 'Different text');
			const first = book.build(cpPath);
			const second = book.build(cpPath);
			await first;
			await second;
			expect(copy.buildCount).toEqual(preBuildCount + 1);
		});

		it('does not build a target if a source fails to build', async () => {
			const preBuildCount = copy.buildCount;

			// make copy fail
			await rm(book.abs(helloPath));
			spyOn(write, 'buildAsync').and.returnValue(Promise.resolve(false));
			const result = await book.build(cpPath);

			expect(write.buildAsync).toHaveBeenCalled();
			expect(copy.buildCount).toEqual(preBuildCount);
			expect(result).toBeFalse();
		});
	});

	describe('cat-files', () => {
		const book = mkBook('cat-files');
		const catPath = Path.src('index.txt');
		const aPath = Path.src('a.txt');
		const outPath = BuildPath.from('output.txt');
		const cat: CatFilesRecipe = new CatFilesRecipe(catPath, outPath);

		beforeEach(async () => {
			book.add(cat);
			await rm(book.buildRoot, { recursive: true });
		});

		it('concatenates the files in index.txt', async () => {
			await book.build(outPath);
			const contents = await readFile(book.abs(outPath), 'utf8');
			expect(contents).toEqual('A\nB\nC\n');
		});

		it('rebuilds when runtime dependency changes', async () => {
			await book.build(outPath); // build once
			const preBuildCount = cat.buildCount;
			await waitMs(2);
			const aAbs = book.abs(aPath);
			const aContents = await readFile(aAbs, 'utf8');
			await writeFile(aAbs, aContents, 'utf8'); // just to update mtime
			await book.build(outPath);
			expect(cat.buildCount).toEqual(preBuildCount + 1);
		});

		it('skips unnecessary builds across runs', async () => {
			await book.build(outPath); // build once
			const preBuildCount = cat.buildCount;

			// make a new instance to avoid any state in object
			const newBook = mkBook('cat-files');
			newBook.add(cat);

			await newBook.build(outPath);
			expect(cat.buildCount).toEqual(preBuildCount);
		});

		it('detects runtime dependency change across runs', async () => {
			await book.build(outPath); // build once
			const preBuildCount = cat.buildCount;

			await waitMs(2);
			const aAbs = book.abs(aPath);
			const aContents = await readFile(aAbs, 'utf8');
			await writeFile(aAbs, aContents, 'utf8'); // just to update mtime

			// make a new instance to avoid any state in object
			const newBook = mkBook('cat-files');
			newBook.add(cat);

			await newBook.build(outPath);
			expect(cat.buildCount).toEqual(preBuildCount + 1);
		});

		it('builds all targets by default', async () => {
			const oneOff = new WriteFileRecipe('one-off.txt', 'One off');
			book.add(oneOff);
			const preBuildCount = cat.buildCount;
			await book.build();

			expect(cat.buildCount).toEqual(preBuildCount + 1);
			expect(oneOff.buildCount).toEqual(1);
		});
	});

	describe('cat-files2', async () => {
		let book: Cookbook;
		const aPath = BuildPath.from('a.txt');
		const cpPath = BuildPath.from('copy.txt');
		const catPath = BuildPath.from('index.txt');
		const outPath = BuildPath.from('output.txt');
		let writeA: WriteFileRecipe;
		let copyA: CopyFileRecipe;
		let writeIndex: WriteFileRecipe;
		let cat: CatFilesRecipe;

		beforeEach(async () => {
			book = mkBook('cat-files2');
			writeA = new WriteFileRecipe(aPath, 'original');
			copyA = new CopyFileRecipe(aPath, cpPath);
			writeIndex = new WriteFileRecipe(catPath, 'copy.txt');
			cat = new CatFilesRecipe(catPath, outPath);

			book.add(writeA);
			book.add(copyA);
			book.add(writeIndex);
			book.add(cat);
			await rmDir(book.buildRoot);
		});

		it('builds runtime sources that are build paths', async () => {
			await book.build(cpPath);
			await book.build(outPath);
			const preBuildCount = cat.buildCount;

			await writeFile(book.abs(aPath), 'update', 'utf8');
			const result = await book.build(outPath);

			expect(cat.buildCount).toEqual(preBuildCount + 1);
			const contents = await readFile(book.abs(outPath), 'utf8');
			expect(contents).toEqual('update');
			expect(result).toBeTrue();
		});

		it('does not build a target if a runtime source fails to build', async () => {
			await book.build(cpPath);
			await book.build(outPath);
			const preBuildCount = cat.buildCount;

			// make copy fail
			await rm(book.abs(cpPath));
			spyOn(copyA, 'buildAsync').and.returnValue(Promise.resolve(false));
			const result = await book.build(outPath);

			expect(copyA.buildAsync).toHaveBeenCalled();
			expect(cat.buildCount).toEqual(preBuildCount);
			expect(result).toBeFalse();
		});
	});
});
