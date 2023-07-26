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

function mkBook(testCase: string): Cookbook {
	const srcRoot = path.resolve(__dirname, '..', '..', 'test-cases', testCase);

	return new Cookbook({ srcRoot });
}

describe('Cookbook', () => {
	describe('write-hello', () => {
		const book = mkBook('write-hello');
		const helloTxt = 'Hello world!';
		const helloPath = BuildPath.from('hello.txt');
		const cpPath = BuildPath.from('copy/hello.txt');

		beforeAll(async () => {
			book.add(new WriteFileRecipe(helloPath, helloTxt));
			book.add(new CopyFileRecipe(helloPath, cpPath));

			await rm(book.buildRoot, { recursive: true } as any);
			await book.build('copy/hello.txt');
		});

		it('lists targets by path relative to build dir', () => {
			const targets = new Set(book.targets());
			expect(targets.size).toEqual(2);
			expect(targets.has('hello.txt')).toBeTrue();
			expect(targets.has('copy/hello.txt')).toBeTrue();
		});

		it('generates hello.txt', async () => {
			const hello = await readFile(book.abs(helloPath), 'utf8');
			expect(hello).toEqual(helloTxt);
		});

		it('makes the copy/ dir without the recipe needing to', async () => {
			const cpDir = book.abs(cpPath.dir);
			const dirStat = await stat(cpDir);
			expect(dirStat.isDirectory()).toBeTrue();
		});

		it('generates copy/hello.txt', async () => {
			const hello = await readFile(book.abs(cpPath), 'utf8');
			expect(hello).toEqual(helloTxt);
		});
	});
});

class WriteFileRecipe implements IRecipe<WriteFileRecipe> {
	readonly path: BuildPath;
	private _txt: string;

	constructor(path: BuildPathLike, txt: string) {
		this.path = BuildPath.from(path);
		this._txt = txt;
	}

	sources(): null {
		return null;
	}
	targets(): BuildPath {
		return this.path;
	}
	async buildAsync(args: IRecipeBuildArgs<WriteFileRecipe>): Promise<boolean> {
		await writeFile(args.targets, this._txt, 'utf8');
		return true;
	}
}

class CopyFileRecipe implements IRecipe<CopyFileRecipe> {
	readonly src: Path;
	readonly dest: BuildPath;

	constructor(src: PathLike, genOpts?: BuildPathGenOpts) {
		this.src = Path.src(src);
		this.dest = BuildPath.gen(this.src, genOpts);
	}

	sources(): Path {
		return this.src;
	}
	targets(): BuildPath {
		return this.dest;
	}

	async buildAsync(args: IRecipeBuildArgs<CopyFileRecipe>): Promise<boolean> {
		await copyFile(args.sources, args.targets);
		return true;
	}
}
