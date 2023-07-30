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
		await copyFile(sources, targets);
		return true;
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
		debugger;
		const { sources, targets } = args.paths<CatFilesRecipe>();
		const srcDir = dirname(sources);
		++this.buildCount;
		const catSrc = await readFile(sources, 'utf8');
		const lines = catSrc.split('\n');

		const handle = await open(targets, 'w');
		for (const line of lines) {
			if (!line) continue;
			args.addSrc(line);
			const contents = await readFile(resolve(srcDir, line), 'utf8');
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
		const book = mkBook('write-hello');
		const helloTxt = 'Hello world!';
		const helloPath = BuildPath.from('hello.txt');
		const cpPath = BuildPath.from('copy/hello.txt');
		const write = new WriteFileRecipe(helloPath, helloTxt);
		const copy = new CopyFileRecipe(helloPath, cpPath);

		beforeEach(async () => {
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
	});
});
