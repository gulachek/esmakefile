import {
	Cookbook,
	IRule,
	BuildPathLike,
	IBuildPath,
	BuildPathGenOpts,
	Path,
	PathLike,
	RecipeArgs,
	IBuild,
	RuleID,
} from '../index.js';
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

import { dirname, resolve } from 'node:path';
import { existsSync, Stats } from 'node:fs';

abstract class TestRule {
	public buildCount: number = 0;
	private _returnFalseOnBuild: boolean = false;
	public _throwOnBuild: Error | null = null;

	async recipe(args: RecipeArgs): Promise<boolean> {
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

	protected abstract onBuild(args: RecipeArgs): Promise<boolean>;
}

class WriteFileRule extends TestRule implements IRule {
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

	override async onBuild(args: RecipeArgs) {
		args.logStream.write(`Writing ${this.path}`, 'utf8');

		const path = args.abs(this.path);
		await writeFile(path, this.txt, 'utf8');
		return true;
	}
}

class CopyFileRule extends TestRule implements IRule {
	readonly src: Path;
	readonly dest: IBuildPath;

	constructor(src: PathLike, genOpts?: BuildPathGenOpts) {
		super();
		this.src = Path.src(src);
		this.dest = Path.gen(this.src, genOpts);
	}

	prereqs() {
		return this.src;
	}

	targets() {
		return this.dest;
	}

	override async onBuild(args: RecipeArgs): Promise<boolean> {
		const [src, dest] = args.absAll(this.src, this.dest);

		try {
			await copyFile(src, dest);
			return true;
		} catch {
			return false;
		}
	}
}

class CatFilesRecipe implements IRule {
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
	prereqs() {
		return this.src;
	}

	async recipe(args: RecipeArgs): Promise<boolean> {
		const [src, dest] = args.absAll(this.src, this.dest);

		const srcDir = dirname(src);
		++this.buildCount;
		let catSrc: string;
		try {
			catSrc = await readFile(src, 'utf8');
		} catch {
			return false;
		}

		const lines = catSrc.split('\n');

		let handle: FileHandle;
		try {
			handle = await open(dest, 'w');
		} catch {
			return false;
		}

		for (const line of lines) {
			if (!line) continue;
			const path = resolve(srcDir, line);
			args.addPostreq(path);
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

function waitMs(ms: number): Promise<void> {
	return new Promise((res) => setTimeout(res, ms));
}

describe('Cookbook', () => {
	describe('targets', () => {
		it('lists targets by path relative to build dir', () => {
			const book = new Cookbook();
			book.add(new WriteFileRule('write.txt', 'hello'));
			book.add(new CopyFileRule('src.txt', '/sub/dest.txt'));

			const targets = new Set(book.targets());

			expect(targets.size).to.equal(2);
			expect(targets.has('write.txt')).to.be.true;
			expect(targets.has('sub/dest.txt')).to.be.true;
		});
	});

	describe('add', () => {
		it('cannot add while build is in progress', async () => {
			const book = new Cookbook();
			book.add(new WriteFileRule('write.txt', 'hello'));
			const prom = book.build();
			expect(() =>
				book.add(new CopyFileRule('src.txt', '/sub/dest.txt')),
			).to.throw();
			await prom;
		});

		it('throws if two recipes are given for a target', async () => {
			const book = new Cookbook();
			const path = Path.build('conflict.txt');
			const write = new WriteFileRule(path, 'hello');
			const copy = new CopyFileRule('something.txt', path);

			book.add(write);
			expect(() => book.add(copy)).to.throw();
		});

		it('can add multiple rules for the same target', async () => {
			const book = new Cookbook();
			const target = Path.build('target.txt');
			const anotherDep = Path.src('dep.txt');
			const write = new WriteFileRule(target, 'hello');
			book.add(write);
			expect(() => book.add(target, anotherDep)).not.to.throw();
		});
	});

	describe('recipe', () => {
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
				await rm(srcRoot, { recursive: true });
				expect(existsSync(srcRoot)).to.be.false;
			} catch {
				// eslint:ignore no-empty
			}

			await mkdir(srcRoot, { recursive: true });

			book = new Cookbook({ srcRoot, buildRoot });
		});

		it('builds a target', async () => {
			const path = Path.build('output.txt');
			const write = new WriteFileRule(path, 'hello');
			book.add(write);

			const result = await book.build(path);
			const contents = await readPath(path);
			expect(contents).to.equal('hello');
			expect(result).to.be.true;
		});

		it('builds a phony target', async () => {
			let count = 0;
			book.add('all', () => {
				++count;
			});

			const result = await book.build();
			expect(result).to.be.true;
			expect(count).to.equal(1);
		});

		it('rebuilds a phony target', async () => {
			let count = 0;
			book.add('all', () => {
				++count;
			});

			await book.build();
			await book.build();
			expect(count).to.equal(2);
		});

		it('fails if recipe returns false', async () => {
			book.add('all', () => false);
			const result = await book.build();
			expect(result).to.be.false;
		});

		it('succeeds if recipe is void', async () => {
			book.add('all', () => {});
			const result = await book.build();
			expect(result).to.be.true;
		});

		it('succeeds if recipe is true', async () => {
			book.add('all', () => true);
			const result = await book.build();
			expect(result).to.be.true;
		});

		it('fails if recipe returns Promise<false>', async () => {
			book.add('all', () => Promise.resolve(false));
			const result = await book.build();
			expect(result).to.be.false;
		});

		it('succeeds if recipe is Promise<void>', async () => {
			book.add('all', () => Promise.resolve());
			const result = await book.build();
			expect(result).to.be.true;
		});

		it('succeeds if recipe is Promise<true>', async () => {
			book.add('all', () => Promise.resolve(true));
			const result = await book.build();
			expect(result).to.be.true;
		});

		it('fails if recipe throws', async () => {
			const path = Path.build('test.txt');
			const write = new WriteFileRule(path, 'test');
			write.throwOnBuild(new Error('test'));
			book.add(write);

			const result = await book.build(path);
			expect(result).to.be.false;
		});

		it('builds first target by default', async () => {
			const pOne = Path.build('one.txt');
			const pTwo = Path.build('two.txt');
			const writeOne = new WriteFileRule(pOne, 'one');
			const writeTwo = new WriteFileRule(pTwo, 'two');
			book.add(writeOne);
			book.add(writeTwo);

			const result = await book.build();
			expect(result).to.be.true;
			expect(writeOne.buildCount).to.equal(1);
			expect(writeTwo.buildCount).to.equal(0);
		});

		it('does not build first target when another is specified', async () => {
			const pOne = Path.build('one.txt');
			const pTwo = Path.build('two.txt');
			const writeOne = new WriteFileRule(pOne, 'one');
			const writeTwo = new WriteFileRule(pTwo, 'two');
			book.add(writeOne);
			book.add(writeTwo);

			const result = await book.build(pTwo);
			expect(result).to.be.true;
			expect(writeOne.buildCount).to.equal(0);
			expect(writeTwo.buildCount).to.equal(1);
		});

		it("builds a target's prereq", async () => {
			const srcPath = Path.build('src.txt');
			const write = new WriteFileRule(srcPath, 'hello');
			book.add(write);

			const cpPath = Path.build('cp.txt');
			const cp = new CopyFileRule(srcPath, cpPath);
			book.add(cp);

			await book.build(cpPath);

			const contents = await readPath(cpPath);
			expect(contents).to.equal('hello');
			expect(write.buildCount).to.equal(1);
		});

		it('builds a phony target without a recipe', async () => {
			const srcPath = Path.build('src.txt');

			book.add('all', srcPath);

			const write = new WriteFileRule(srcPath, 'hello');
			book.add(write);

			const result = await book.build();
			expect(result).to.be.true;
		});

		it("fails if a src prereq doesn't exist", async () => {
			book.add('all', 'prereq');
			const result = await book.build();
			expect(result).to.be.false;
		});

		it("fails if a build prereq doesn't exist", async () => {
			book.add('all', Path.build('prereq'));
			const result = await book.build();
			expect(result).to.be.false;
		});

		it('builds if a phony target prereq is in the system', async () => {
			const prereq = Path.build('prereq');
			book.add('all', prereq);
			book.add(prereq, () => {});

			const result = await book.build();
			expect(result).to.be.true;
		});

		it('ensures a target directory exists before building', async () => {
			const srcPath = Path.build('src.txt');
			const write = new WriteFileRule(srcPath, 'hello');
			book.add(write);

			const cpPath = Path.build('sub/cp.txt');
			const cp = new CopyFileRule(srcPath, cpPath);
			book.add(cp);

			await book.build(cpPath);

			const dirStat = await statsPath(cpPath.dir());
			expect(dirStat.isDirectory()).to.be.true;
		});

		it('skips building target if newer than prereqs', async () => {
			const srcPath = Path.build('src.txt');
			const write = new WriteFileRule(srcPath, 'hello');
			book.add(write);

			const cpPath = Path.build('cp.txt');
			const cp = new CopyFileRule(srcPath, cpPath);
			book.add(cp);

			await book.build(cpPath);
			await book.build(cpPath);

			expect(cp.buildCount).to.equal(1);
		});

		it('rebuilds target if older than prereqs', async () => {
			const srcPath = Path.src('src.txt');
			await writePath(srcPath, 'hello');

			const cpPath = Path.build('cp.txt');
			const cp = new CopyFileRule(srcPath, cpPath);
			book.add(cp);

			await book.build(cpPath);

			await writePath(srcPath, 'update');

			await book.build(cpPath);

			expect(cp.buildCount).to.equal(2);
			const contents = await readPath(cpPath);
			expect(contents).to.equal('update');
		});

		it('rebuilds target if older than prereqs in non-recipe rules', async () => {
			const srcPath = Path.src('src.txt');
			const otherPath = Path.src('other.txt');
			await writePath(srcPath, 'hello');
			await writePath(otherPath, 'other');

			const cpPath = Path.build('cp.txt');
			const cp = new CopyFileRule(srcPath, cpPath);
			book.add(cp);
			book.add(cpPath, otherPath);

			await book.build(cpPath);

			await writePath(otherPath, 'update');

			await book.build(cpPath);

			expect(cp.buildCount).to.equal(2);
			const contents = await readPath(cpPath);
			expect(contents).to.equal('hello');
		});

		it('y0b0: you only build once. calling build while building results in one build', async () => {
			const srcPath = Path.build('src.txt');
			const write = new WriteFileRule(srcPath, 'hello');
			book.add(write);

			const cpPath = Path.build('cp.txt');
			const cp = new CopyFileRule(srcPath, cpPath);
			book.add(cp);

			const first = book.build(cpPath);
			const second = book.build(cpPath);
			await Promise.all([first, second]);

			expect(write.buildCount).to.equal(1);
			expect(cp.buildCount).to.equal(1);
		});

		it('does not build a target if a source fails to build', async () => {
			const srcPath = Path.build('src.txt');
			const write = new WriteFileRule(srcPath, 'hello');
			write.returnFalseOnBuild();
			book.add(write);

			const cpPath = Path.build('cp.txt');
			const cp = new CopyFileRule(srcPath, cpPath);
			book.add(cp);

			const result = await book.build(cpPath);

			expect(cp.buildCount).to.equal(0);
			expect(result).to.be.false;
		});

		it('does not build a target if a source was deleted', async () => {
			const srcPath = Path.src('src.txt');
			const outPath = Path.build('out.txt');

			await writePath(srcPath, 'contents');

			const copy = new CopyFileRule(srcPath, outPath);
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

		describe('with postreqs', () => {
			const aPath = Path.src('a.txt');
			const bPath = Path.src('b.txt');
			const indexPath = Path.src('index.txt');
			const catPath = Path.build('cat.txt');
			let cat: CatFilesRecipe;

			beforeEach(async () => {
				await writePath(aPath, 'A\n');
				await writePath(bPath, 'B\n');
				await writePath(indexPath, 'a.txt\nb.txt\n');

				cat = new CatFilesRecipe(indexPath, catPath);
				book.add(cat);
			});

			it('rebuilds when postreq changes', async () => {
				let result = await book.build(catPath); // build once
				expect(result).to.be.true;
				expect(cat.buildCount).to.equal(1);
				expect(await readPath(catPath)).to.equal('A\nB\n');

				await waitMs(2);
				await writePath(aPath, 'A change\n');
				result = await book.build(catPath);

				expect(result).to.be.true;
				expect(cat.buildCount).to.equal(2);
				expect(await readPath(catPath)).to.equal('A change\nB\n');
			});

			it('does not rebuild if postreq does not change', async () => {
				let result = await book.build(catPath);
				expect(result).to.be.true;
				expect(cat.buildCount).to.equal(1);
				expect(await readPath(catPath)).to.equal('A\nB\n');

				result = await book.build(catPath);
				expect(result).to.be.true;
				expect(cat.buildCount).to.equal(1);
			});

			it('tracks postreq across runs', async () => {
				let result = await book.build(catPath);
				expect(result).to.be.true;
				expect(cat.buildCount).to.equal(1);
				expect(await readPath(catPath)).to.equal('A\nB\n');

				// make a new instance to avoid any state in object
				const { srcRoot, buildRoot } = book;
				const newBook = new Cookbook({ srcRoot, buildRoot });
				newBook.add(cat);

				await writePath(aPath, 'A changed\n');
				result = await newBook.build(catPath);
				expect(result).to.be.true;
				expect(cat.buildCount).to.equal(2);
				expect(await readPath(catPath)).to.equal('A changed\nB\n');
			});

			it('attempts to build target if static postreq does not exist', async () => {
				let result = await book.build(catPath);
				expect(result).to.be.true;
				expect(cat.buildCount).to.equal(1);
				expect(await readPath(catPath)).to.equal('A\nB\n');

				await rmPath(aPath);
				result = await book.build(catPath);
				expect(result).to.be.false;
				expect(cat.buildCount).to.equal(2);
			});
		});

		it('remembers postreqs for targets that are not always built', async () => {
			const foo = Path.build('foo');
			const req = Path.src('req');
			const phony = Path.build('phony');

			await writePath(req, 'init');

			const counts = { foo: 0, phony: 0 };

			book.add('all', [foo, phony]);

			book.add(foo, async (args) => {
				counts.foo += 1;
				args.addPostreq(args.abs(req));
				await writePath(foo, counts.foo.toString());
				return true;
			});

			book.add(phony, () => {
				counts.phony += 1;
				return true;
			});

			await book.build();
			expect(counts.foo).to.equal(1, 'foo');
			expect(counts.phony).to.equal(1, 'phony');

			await book.build();
			expect(counts.foo).to.equal(1, 'foo');
			expect(counts.phony).to.equal(2, 'phony');

			await writePath(req, 'update');

			await book.build();
			expect(counts.foo).to.equal(2, 'foo');
			expect(counts.phony).to.equal(3, 'phony');
		});

		/*
		 * This might initially be perceived as a bug. However, it's unclear
		 * how this would be a stable build. Seems circular to need to
		 * build a target to discover a dependency so it should be
		 * built.  To make the first build successful, build script
		 * should be designed to know which prereqs are necessary for
		 * build. Runtime src is only meant for detecting updates.
		 *
		 * Open to a valid use case pointing out how its stable, but
		 * for now, this seems correct.
		 */
		it('does not build postreq that are build paths', async () => {
			const srcPath = Path.src('src.txt');
			const cpPath = Path.build('copy.txt');
			const outPath = Path.build('out.txt');

			await writePath(srcPath, 'src');
			const copy = new CopyFileRule(srcPath, cpPath);
			let buildCount = 0;
			book.add(copy);

			expect(await book.build(cpPath)).to.be.true;

			// no a priori depencency on cpPath
			const adHocRecipe: IRule = {
				targets() {
					return outPath;
				},
				recipe: async (args: RecipeArgs) => {
					++buildCount;
					await writePath(outPath, 'test');
					// only after build
					args.addPostreq(book.abs(cpPath));
					return true;
				},
			};

			book.add(adHocRecipe);

			let result = await book.build(outPath);
			expect(result).to.be.true;
			expect(buildCount).to.equal(1);
			expect(copy.buildCount).to.equal(1);

			// now presumably knows postreqs

			await writePath(srcPath, 'update');
			result = await book.build(outPath);
			expect(buildCount).to.equal(1);
			expect(copy.buildCount).to.equal(1);
		});

		it('notifies caller of start and end time of target', async () => {
			const targ = Path.build('test');
			book.add(targ, () => {});
			let startCalled = false;
			let endCalled = false;

			await book.build(targ, async (build: IBuild) => {
				build.on('start-target', (target: string) => {
					expect(target, 'start target').to.equal('test');
					expect(endCalled, 'end not called b4 start').to.be.false;
					startCalled = true;
				});

				build.on('end-target', (target: string) => {
					expect(target, 'end target').to.equal('test');
					expect(startCalled, 'start called before end').to.be.true;
					endCalled = true;
				});
			});

			expect(endCalled, 'end called').to.be.true;
		});

		it('notifies caller when recipe logs information', async () => {
			const out = Path.build('out.txt');
			const write = new WriteFileRule(out, 'hello');
			const id = book.add(write);
			let logCalled = false;

			await book.build(out, async (build: IBuild) => {
				build.on('recipe-log', (rid: RuleID, data: Buffer) => {
					expect(rid).to.equal(id);
					expect(data.toString('utf8')).to.match(/^Writing/);
					logCalled = true;
				});
			});

			expect(logCalled, 'log called').to.be.true;
		});
	});
});
