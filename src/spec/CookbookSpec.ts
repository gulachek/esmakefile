import {
	Cookbook,
	IRecipe,
	BuildPathLike,
	IBuildPath,
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
	mkdir,
	stat,
	open,
	FileHandle,
} from 'node:fs/promises';

import { expect } from 'chai';

import path, { dirname, resolve } from 'node:path';
import { existsSync, Stats } from 'node:fs';

async function rmDir(dirAbs: string): Promise<void> {
	try {
		await rm(dirAbs, { recursive: true });
	} catch {}
}

class TestRecipe {
	public buildCount: number = 0;
	private _returnFalseOnBuild: boolean = false;
	public _throwOnBuild: Error | null = null;

	async buildAsync(args: RecipeBuildArgs): Promise<boolean> {
		++this.buildCount;
		if (this._throwOnBuild) throw this._throwOnBuild;
		if (this._returnFalseOnBuild) return false;
		return this.onBuild(args);
	}

	public returnFalseOnBuild(): void {
		this._returnFalseOnBuild = true;
	}

	public throwOnBuild(err: Error): void {
		this._throwOnBuild = err;
	}

	protected onBuild(_args: RecipeBuildArgs): Promise<boolean> {
		return Promise.resolve(true);
	}
}

class WriteFileRecipe extends TestRecipe implements IRecipe {
	readonly path: IBuildPath;
	public txt: string;

	constructor(path: BuildPathLike, txt: string) {
		super();
		this.path = Path.build(path);
		this.txt = txt;
	}

	targets() {
		return this.path;
	}

	override async onBuild(args: RecipeBuildArgs) {
		const { targets } = args.paths<WriteFileRecipe>();
		await writeFile(targets, this.txt, 'utf8');
		return true;
	}
}

class CopyFileRecipe extends TestRecipe implements IRecipe {
	readonly src: Path;
	readonly dest: IBuildPath;

	constructor(src: PathLike, genOpts?: BuildPathGenOpts) {
		super();
		this.src = Path.src(src);
		this.dest = Path.gen(this.src, genOpts);
	}

	sources() {
		return this.src;
	}

	targets() {
		return this.dest;
	}

	override async onBuild(args: RecipeBuildArgs): Promise<boolean> {
		const { sources, targets } = args.paths<CopyFileRecipe>();
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
	readonly dest: IBuildPath;
	buildCount: number = 0;

	constructor(src: Path, genOpts?: BuildPathGenOpts) {
		this.src = src;
		this.dest = Path.gen(src, genOpts);
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
		let catSrc: string;
		try {
			catSrc = await readFile(sources, 'utf8');
		} catch {
			return false;
		}

		const lines = catSrc.split('\n');

		let handle: FileHandle;
		try {
			handle = await open(targets, 'w');
		} catch {
			return false;
		}

		for (const line of lines) {
			if (!line) continue;
			const path = resolve(srcDir, line);
			args.addSrc(path);
			try {
				const contents = await readFile(path, 'utf8');
				await handle.appendFile(contents);
			} catch {
				return false;
			}
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

			expect(targets.size).to.equal(2);
			expect(targets.has('write.txt')).to.be.true;
			expect(targets.has('sub/dest.txt')).to.be.true;
		});
	});

	describe('add', () => {
		it('cannot add while build is in progress', async () => {
			const book = new Cookbook();
			book.add(new WriteFileRecipe('write.txt', 'hello'));
			const prom = book.build();
			expect(() =>
				book.add(new CopyFileRecipe('src.txt', '/sub/dest.txt')),
			).to.throw();
			await prom;
		});
	});

	describe('buildAsync', () => {
		let book: Cookbook;

		function writePath(path: Path, contents: string): Promise<void> {
			return writeFile(book.abs(path), contents, 'utf8');
		}

		function readPath(path: Path): Promise<string> {
			return readFile(book.abs(path), 'utf8');
		}

		function statsPath(path: Path): Promise<Stats> {
			return stat(book.abs(path));
		}

		function rmPath(path: Path): Promise<void> {
			return rm(book.abs(path));
		}

		beforeEach(async () => {
			const srcRoot = resolve('test-src');
			const buildRoot = resolve(srcRoot, 'build');

			try {
				console.log('removing ', srcRoot);
				await rm(srcRoot, { recursive: true });
				expect(existsSync(srcRoot)).to.be.false;
			} catch (_) {}

			await mkdir(srcRoot, { recursive: true });

			book = new Cookbook({ srcRoot, buildRoot });
		});

		it('builds a target', async () => {
			const path = Path.build('output.txt');
			const write = new WriteFileRecipe(path, 'hello');
			book.add(write);

			await book.build(path);
			const contents = await readPath(path);
			expect(contents).to.equal('hello');
		});

		it("builds a target's dependency", async () => {
			const srcPath = Path.build('src.txt');
			const write = new WriteFileRecipe(srcPath, 'hello');
			book.add(write);

			const cpPath = Path.build('cp.txt');
			const cp = new CopyFileRecipe(srcPath, cpPath);
			book.add(cp);

			await book.build(cpPath);

			const contents = await readPath(cpPath);
			expect(contents).to.equal('hello');
			expect(write.buildCount).to.equal(1);
		});

		it('ensures a target directory exists before building', async () => {
			const srcPath = Path.build('src.txt');
			const write = new WriteFileRecipe(srcPath, 'hello');
			book.add(write);

			const cpPath = Path.build('sub/cp.txt');
			const cp = new CopyFileRecipe(srcPath, cpPath);
			book.add(cp);

			await book.build(cpPath);

			const dirStat = await statsPath(cpPath.dir());
			expect(dirStat.isDirectory()).to.be.true;
		});

		it('skips building target if newer than sources', async () => {
			const srcPath = Path.build('src.txt');
			const write = new WriteFileRecipe(srcPath, 'hello');
			book.add(write);

			const cpPath = Path.build('cp.txt');
			const cp = new CopyFileRecipe(srcPath, cpPath);
			book.add(cp);

			await book.build(cpPath);
			await book.build(cpPath);

			expect(cp.buildCount).to.equal(1);
		});

		it('rebuilds target if older than sources', async () => {
			const srcPath = Path.src('src.txt');
			await writePath(srcPath, 'hello');

			const cpPath = Path.build('cp.txt');
			const cp = new CopyFileRecipe(srcPath, cpPath);
			book.add(cp);

			await book.build(cpPath);

			await writePath(srcPath, 'update');

			await book.build(cpPath);

			expect(cp.buildCount).to.equal(2);
			const contents = await readPath(cpPath);
			expect(contents).to.equal('update');
		});

		it('y0b0: you only build once. calling build while building results in one build', async () => {
			const srcPath = Path.build('src.txt');
			const write = new WriteFileRecipe(srcPath, 'hello');
			book.add(write);

			const cpPath = Path.build('cp.txt');
			const cp = new CopyFileRecipe(srcPath, cpPath);
			book.add(cp);

			const first = book.build(cpPath);
			const second = book.build(cpPath);
			await Promise.all([first, second]);

			expect(write.buildCount).to.equal(1);
			expect(cp.buildCount).to.equal(1);
		});

		it('does not build a target if a source fails to build', async () => {
			const srcPath = Path.build('src.txt');
			const write = new WriteFileRecipe(srcPath, 'hello');
			write.returnFalseOnBuild();
			book.add(write);

			const cpPath = Path.build('cp.txt');
			const cp = new CopyFileRecipe(srcPath, cpPath);
			book.add(cp);

			const result = await book.build(cpPath);

			expect(cp.buildCount).to.equal(0);
			expect(result).to.be.false;
		});

		it('does not build a target if a source was deleted', async () => {
			const srcPath = Path.src('src.txt');
			const outPath = Path.build('out.txt');

			await writePath(srcPath, 'contents');

			const copy = new CopyFileRecipe(srcPath, outPath);
			book.add(copy);

			let result = await book.build(outPath);
			expect(result).to.be.true;
			expect(copy.buildCount).to.equal(1);

			// now delete (hits case where target path does exist prior)
			await rmPath(srcPath);

			result = await book.build(outPath);
			expect(result).to.be.false;
			expect(copy.buildCount).to.equal(1);
		});
	});

	describe('cat-files', () => {
		const book = mkBook('cat-files');
		const catPath = Path.src('index.txt');
		const aPath = Path.src('a.txt');
		const outPath = Path.build('output.txt');
		const cat: CatFilesRecipe = new CatFilesRecipe(catPath, outPath);

		beforeEach(async () => {
			book.add(cat);
			await rm(book.buildRoot, { recursive: true });
		});

		it('concatenates the files in index.txt', async () => {
			await book.build(outPath);
			const contents = await readFile(book.abs(outPath), 'utf8');
			expect(contents).to.equal('A\nB\nC\n');
		});

		it('rebuilds when runtime dependency changes', async () => {
			await book.build(outPath); // build once
			const preBuildCount = cat.buildCount;
			await waitMs(2);
			const aAbs = book.abs(aPath);
			const aContents = await readFile(aAbs, 'utf8');
			await writeFile(aAbs, aContents, 'utf8'); // just to update mtime
			await book.build(outPath);
			expect(cat.buildCount).to.equal(preBuildCount + 1);
		});

		it('skips unnecessary builds across runs', async () => {
			await book.build(outPath); // build once
			const preBuildCount = cat.buildCount;

			// make a new instance to avoid any state in object
			const newBook = mkBook('cat-files');
			newBook.add(cat);

			await newBook.build(outPath);
			expect(cat.buildCount).to.equal(preBuildCount);
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
			expect(cat.buildCount).to.equal(preBuildCount + 1);
		});

		it('builds all targets by default', async () => {
			const oneOff = new WriteFileRecipe('one-off.txt', 'One off');
			book.add(oneOff);
			const preBuildCount = cat.buildCount;
			await book.build();

			expect(cat.buildCount).to.equal(preBuildCount + 1);
			expect(oneOff.buildCount).to.equal(1);
		});
	});

	describe('cat-files2', async () => {
		let book: Cookbook;
		const aPath = Path.build('a.txt');
		const cpPath = Path.build('copy.txt');
		const catPath = Path.build('index.txt');
		const outPath = Path.build('output.txt');
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

			expect(cat.buildCount).to.equal(preBuildCount + 1);
			const contents = await readFile(book.abs(outPath), 'utf8');
			expect(contents).to.equal('update');
			expect(result).to.be.true;
		});

		it('does not build a target if a runtime source fails to build', async () => {
			await book.build(cpPath);
			await book.build(outPath);
			const preBuildCount = cat.buildCount;

			// make copy fail
			await rm(book.abs(cpPath));
			copyA.returnFalseOnBuild();
			const result = await book.build(outPath);

			expect(cat.buildCount).to.equal(preBuildCount);
			expect(result).to.be.false;
		});

		it('attempts to build target if static runtime source does not exist', async () => {
			await book.build(cpPath);
			await book.build(outPath);

			// TODO - gitignore the test scratch directories
			const badPath = Path.src('bad.txt');
			await writeFile(book.abs(badPath), 'delete this', 'utf8');
			const oldTxt = writeIndex.txt;
			writeIndex.txt = book.abs(badPath);
			await rm(book.abs(catPath));

			const result = await book.build(outPath);
			expect(result).to.be.true;
			const preBuildCount = cat.buildCount;

			await rm(book.abs(badPath));
			writeIndex.txt = oldTxt;
			await rm(book.abs(catPath));
			const rerunResult = await book.build(outPath);
			expect(rerunResult).to.be.true;
			expect(cat.buildCount).to.equal(preBuildCount + 1);
		});

		it('fails if recipe returns false', async () => {
			const path = Path.build('test.txt');
			const write = new WriteFileRecipe(path, 'test');
			write.returnFalseOnBuild();
			book.add(write);

			const result = await book.build(path);
			expect(result).to.be.false;
		});

		it('fails if recipe throws', async () => {
			const path = Path.build('test.txt');
			const write = new WriteFileRecipe(path, 'test');
			write.throwOnBuild(new Error('test'));
			book.add(write);

			const result = await book.build(path);
			expect(result).to.be.false;
		});
	});
});
