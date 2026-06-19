import {
	Makefile,
	MakeProgram,
	IRule,
	BuildPathLike,
	IBuildPath,
	BuildPathGenOpts,
	Path,
	PathLike,
	RecipeArgs,
	MakefileFn,
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
	chmod,
} from 'node:fs/promises';
import { platform } from 'node:os';
import { execFile } from 'node:child_process';

import { expect } from 'chai';

import { dirname, resolve, join } from 'node:path';
import { existsSync, Stats, statSync } from 'node:fs';
import { InMemoryLoggerProvider } from '../InMemoryLoggerProvider.js';
import { LogLevel, setLoggerProvider } from '../logs.js';
import { ATTR_EXCEPTION_MESSAGE } from '@opentelemetry/semantic-conventions';
import {
	EVENT_RECIPE_BEGIN,
	EVENT_RECIPE_EXCEPTION,
	EVENT_TARGET_STALE_NO_RECIPE,
	EVENT_TARGET_UP_TO_DATE,
} from '../names.js';

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

describe('MakeProgram', () => {
	let logs: InMemoryLoggerProvider;

	beforeEach(() => {
		logs = new InMemoryLoggerProvider();
		setLoggerProvider(logs);
	});

	describe('targets', () => {
		it('lists targets by path relative to build dir', () => {
			const make = new Makefile();
			make.add(new WriteFileRule('write.txt', 'hello'));
			make.add(new CopyFileRule('src.txt', '/sub/dest.txt'));

			const targets = new Set(make.targets());

			expect(targets.size).to.equal(2);
			expect(targets.has('write.txt')).to.be.true;
			expect(targets.has('sub/dest.txt')).to.be.true;
		});
	});

	describe('add', () => {
		it('cannot add while an update is in progress', async () => {
			let outerMk: Makefile;
			const prg = await MakeProgram.parse((make) => {
				outerMk = make;
				make.add(new WriteFileRule('write.txt', 'hello'));
			});

			// TODO shouldn't be allowed after parsing either

			const prom = prg.update();
			expect(() =>
				outerMk.add(new CopyFileRule('src.txt', '/sub/dest.txt')),
			).to.throw();
			await prom;
		});

		it('throws if two recipes are given for a target', async () => {
			const make = new Makefile();
			const path = Path.build('conflict.txt');
			const write = new WriteFileRule(path, 'hello');
			const copy = new CopyFileRule('something.txt', path);

			make.add(write);
			expect(() => make.add(copy)).to.throw();
		});

		it('can add multiple rules for the same target', async () => {
			const make = new Makefile();
			const target = Path.build('target.txt');
			const anotherDep = Path.src('dep.txt');
			const write = new WriteFileRule(target, 'hello');
			make.add(write);
			expect(() => make.add(target, anotherDep)).not.to.throw();
		});
	});

	describe('hasTarget', () => {
		it('returns true if target is added to a rule', () => {
			const make = new Makefile();
			make.add('foo', () => {});

			expect(make.hasTarget('foo')).to.be.true;
			expect(make.hasTarget(Path.build('foo'))).to.be.true;
		});

		it('returns false if target is not added to a rule', () => {
			const make = new Makefile();
			make.add('foo', () => {});

			expect(make.hasTarget('bar')).to.be.false;
		});

		it('throws if src path given as argument', () => {
			const make = new Makefile();
			make.add('foo', () => {});

			expect(() => make.hasTarget(Path.src('foo') as IBuildPath)).to.throw();
		});
	});

	describe('recipe', () => {
		const srcRoot = resolve('test-src');
		const buildRoot = resolve(srcRoot, 'build');

		function abs(path: Path): string {
			return path.abs({ src: srcRoot, build: buildRoot });
		}

		function writePath(path: Path, contents: string): Promise<void> {
			return writeFile(abs(path), contents, 'utf8');
		}

		function readPath(path: Path): Promise<string> {
			return readFile(abs(path), 'utf8');
		}

		function statsPath(path: Path): Promise<Stats> {
			return stat(abs(path));
		}

		function rmPath(path: Path): Promise<void> {
			return rm(abs(path));
		}

		async function parse(makeFn: MakefileFn): Promise<MakeProgram> {
			return MakeProgram.parse(makeFn, { srcRoot, buildRoot });
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
		});

		it('updates a target', async () => {
			const path = Path.build('output.txt');

			const prg = await parse((make) => {
				const write = new WriteFileRule(path, 'hello');
				make.add(write);
			});

			const result = await prg.update(path);
			const contents = await readPath(path);
			expect(contents).to.equal('hello');
			expect(result).to.be.true;
		});

		it('debug logs when a recipe begins', async () => {
			const prg = await parse((make) => {
				make.add('all', () => {});
			});

			await prg.update();

			const evts = logs.findEvents(EVENT_RECIPE_BEGIN);
			expect(evts.length).to.equal(
				1,
				`Expected an event named ${EVENT_RECIPE_BEGIN}`,
			);
			const e = evts[0];
			expect(e.level).to.equal(LogLevel.debug);
		});

		it('updates a phony target', async () => {
			let count = 0;

			const prg = await parse((make) => {
				make.add('all', () => {
					++count;
				});
			});

			const result = await prg.update();
			expect(result).to.be.true;
			expect(count).to.equal(1);
		});

		it('remakes a phony target', async () => {
			let count = 0;

			const prg = await parse((make) => {
				make.add('all', () => {
					++count;
				});
			});

			await prg.update();
			await prg.update();
			expect(count).to.equal(2);
		});

		it('fails if recipe returns false', async () => {
			const prg = await parse((make) => {
				make.add('all', () => false);
			});

			const result = await prg.update();
			expect(result).to.be.false;
		});

		it('succeeds if recipe is void', async () => {
			const prg = await parse((make) => {
				make.add('all', () => {});
			});
			const result = await prg.update();
			expect(result).to.be.true;
		});

		it('succeeds if recipe is true', async () => {
			const prg = await parse((make) => {
				make.add('all', () => true);
			});
			const result = await prg.update();
			expect(result).to.be.true;
		});

		it('fails if recipe returns Promise<false>', async () => {
			const prg = await parse((make) => {
				make.add('all', () => Promise.resolve(false));
			});
			const result = await prg.update();
			expect(result).to.be.false;
		});

		it('succeeds if recipe is Promise<void>', async () => {
			const prg = await parse((make) => {
				make.add('all', () => Promise.resolve());
			});
			const result = await prg.update();
			expect(result).to.be.true;
		});

		it('succeeds if recipe is Promise<true>', async () => {
			const prg = await parse((make) => {
				make.add('all', () => Promise.resolve(true));
			});
			const result = await prg.update();
			expect(result).to.be.true;
		});

		it('fails if recipe throws', async () => {
			const path = Path.build('test.txt');
			const write = new WriteFileRule(path, 'test');

			const prg = await parse((make) => {
				write.throwOnBuild(new Error('test'));
				make.add(write);
			});

			const result = await prg.update(path);
			expect(result).to.be.false;
		});

		it('logs an exception event when recipe throws', async () => {
			const thrownMsg = 'thrown message';

			const prg = await parse((make) => {
				make.add('throw', () => {
					throw new Error(thrownMsg);
				});
			});

			await prg.update();

			const evts = logs.findEvents(EVENT_RECIPE_EXCEPTION);
			expect(evts.length).to.equal(
				1,
				'expected an esmakefile.recipe.exception event',
			);
			const e = evts[0];
			expect(e.level).to.equal(LogLevel.error, 'expected error level');
			expect(e.attributes[ATTR_EXCEPTION_MESSAGE]).to.equal(thrownMsg);
		});

		it('updates first target by default', async () => {
			const pOne = Path.build('one.txt');
			const pTwo = Path.build('two.txt');
			const writeOne = new WriteFileRule(pOne, 'one');
			const writeTwo = new WriteFileRule(pTwo, 'two');

			const prg = await parse((make) => {
				make.add(writeOne);
				make.add(writeTwo);
			});

			const result = await prg.update();
			expect(result).to.be.true;
			expect(writeOne.buildCount).to.equal(1);
			expect(writeTwo.buildCount).to.equal(0);
		});

		it('does not update first target when another is specified', async () => {
			const pOne = Path.build('one.txt');
			const pTwo = Path.build('two.txt');
			const writeOne = new WriteFileRule(pOne, 'one');
			const writeTwo = new WriteFileRule(pTwo, 'two');

			const prg = await parse((make) => {
				make.add(writeOne);
				make.add(writeTwo);
			});

			const result = await prg.update(pTwo);
			expect(result).to.be.true;
			expect(writeOne.buildCount).to.equal(0);
			expect(writeTwo.buildCount).to.equal(1);
		});

		it("updates a target's prereq", async () => {
			const srcPath = Path.build('src.txt');
			const write = new WriteFileRule(srcPath, 'hello');
			const cpPath = Path.build('cp.txt');
			const cp = new CopyFileRule(srcPath, cpPath);

			const prg = await parse((make) => {
				make.add(write);
				make.add(cp);
			});

			await prg.update(cpPath);

			const contents = await readPath(cpPath);
			expect(contents).to.equal('hello');
			expect(write.buildCount).to.equal(1);
		});

		it('defaults a string type prereq to build path if it is a target at time of update', async () => {
			let prereqBuilt = false;

			const prg = await parse((make) => {
				make.add('all', 'prereq');

				make.add('prereq', () => {
					prereqBuilt = true;
				});
			});

			await prg.update();
			expect(prereqBuilt).to.be.true;
		});

		it('defaults a string type prereq to src path if it is not a target at time of update', async () => {
			const prereq = Path.src('prereq');
			await writePath(prereq, 'prereq');

			let contents: string = '';

			const prg = await parse((make) => {
				make.add('all', 'prereq', async () => {
					contents = await readPath(prereq);
				});
			});

			await prg.update();
			expect(contents).to.equal('prereq');
		});

		it('updates a phony target without a recipe', async () => {
			const prg = await parse((make) => {
				const srcPath = Path.build('src.txt');

				make.add('all', srcPath);

				const write = new WriteFileRule(srcPath, 'hello');
				make.add(write);
			});

			const result = await prg.update();
			expect(result).to.be.true;
		});

		it("fails if a src prereq doesn't exist", async () => {
			const prg = await parse((make) => {
				make.add('all', 'prereq');
			});
			const result = await prg.update();
			expect(result).to.be.false;
		});

		it("fails if a build prereq doesn't have a recipe", async () => {
			const prg = await parse((make) => {
				make.add('all', Path.build('prereq'));
			});
			const result = await prg.update();
			expect(result).to.be.false;
		});

		it('succeeds if a build prereq does have a recipe that succeeds', async () => {
			const prg = await parse((make) => {
				const prereq = Path.build('prereq');
				make.add('all', prereq);
				make.add(prereq, () => {});
			});

			const result = await prg.update();
			expect(result).to.be.true;
		});

		it('remakes if depending on a phony target', async () => {
			const a = Path.build('a');
			const phony = Path.build('phony');
			const src = Path.src('src');

			await writePath(src, 'src');

			let count = 0;

			const prg = await parse((make) => {
				make.add(a, [phony, src], async () => {
					count += 1;
					await writePath(a, 'a');
				});

				make.add(phony, () => {});
			});

			await prg.update(a);
			expect(count).to.equal(1);

			await prg.update(a);
			expect(count).to.equal(2);
		});

		it('ensures a target directory exists before updating', async () => {
			const srcPath = Path.build('src.txt');
			const write = new WriteFileRule(srcPath, 'hello');

			const cpPath = Path.build('sub/cp.txt');
			const cp = new CopyFileRule(srcPath, cpPath);

			const prg = await parse((make) => {
				make.add(write);
				make.add(cp);
			});

			await prg.update(cpPath);

			const dirStat = await statsPath(cpPath.dir());
			expect(dirStat.isDirectory()).to.be.true;
		});

		it('skips updating target if newer than prereqs', async () => {
			const srcPath = Path.build('src.txt');
			const write = new WriteFileRule(srcPath, 'hello');

			const cpPath = Path.build('cp.txt');
			const cp = new CopyFileRule(srcPath, cpPath);

			const prg = await parse((make) => {
				make.add(write);
				make.add(cp);
			});

			await prg.update(cpPath);
			await prg.update(cpPath);

			expect(cp.buildCount).to.equal(1);
		});

		it('remakes target if older than prereqs', async () => {
			const srcPath = Path.src('src.txt');
			await writePath(srcPath, 'hello');

			const cpPath = Path.build('cp.txt');
			const cp = new CopyFileRule(srcPath, cpPath);
			const prg = await parse((make) => {
				make.add(cp);
			});

			await prg.update(cpPath);
			await waitMs(1);
			await writePath(srcPath, 'update');

			await prg.update(cpPath);

			expect(cp.buildCount).to.equal(2);
			const contents = await readPath(cpPath);
			expect(contents).to.equal('update');
		});

		it('remakes target if older than prereqs in non-recipe rules', async () => {
			const srcPath = Path.src('src.txt');
			const otherPath = Path.src('other.txt');
			await writePath(srcPath, 'hello');
			await writePath(otherPath, 'other');

			const cpPath = Path.build('cp.txt');
			const cp = new CopyFileRule(srcPath, cpPath);

			const prg = await parse((make) => {
				make.add(cp);
				make.add(cpPath, otherPath);
			});

			await prg.update(cpPath);
			await waitMs(1);
			await writePath(otherPath, 'update');

			await prg.update(cpPath);

			expect(cp.buildCount).to.equal(2);
			const contents = await readPath(cpPath);
			expect(contents).to.equal('hello');
		});

		it('calling update() while an update is in progress does not immediately start a new update', async () => {
			const srcPath = Path.build('src.txt');
			const write = new WriteFileRule(srcPath, 'hello');

			const cpPath = Path.build('cp.txt');
			const cp = new CopyFileRule(srcPath, cpPath);

			const prg = await parse((make) => {
				make.add(write);
				make.add(cp);
			});

			const first = prg.update(cpPath);
			const second = prg.update(cpPath);
			await Promise.all([first, second]);

			expect(write.buildCount).to.equal(1);
			expect(cp.buildCount).to.equal(1);
		});

		it('updating two targets from same target group runs recipe once', async () => {
			let count = 0;
			const first = Path.build('first');
			const second = Path.build('second');

			const prg = await parse((make) => {
				make.add('all', [first, second]);
				make.add([first, second], () => {
					count += 1;
				});
			});

			await prg.update();

			expect(count).to.equal(1);
		});

		it('updates prereqs of all targets in target group', async () => {
			const a = Path.build('a');
			const b = Path.build('b');
			const c = Path.build('c');
			const d = Path.build('d');

			let cCount = 0;
			let dCount = 0;

			const prg = await parse((make) => {
				make.add([a, b], () => {});
				make.add(a, c);
				make.add(b, d);
				make.add(c, () => {
					cCount += 1;
				});
				make.add(d, () => {
					dCount += 1;
				});
			});

			await prg.update(a);

			expect(cCount).to.equal(1, "goal's prereq is not updated");
			expect(dCount).to.equal(1, "non-goal's prereq is not updated");
		});

		it('updates target group if any target is older than any prereq', async () => {
			const a = Path.build('a');
			const b = Path.build('b');
			const c = Path.build('c');
			const d = Path.build('d');

			let bCount = 0;

			const prg = await parse((make) => {
				make.add([a, b], async () => {
					bCount += 1;
					await writePath(a, 'a');
					await writePath(b, 'b');
				});

				make.add(a, c);
				make.add(b, d);
				make.add(c, async () => {
					await writePath(c, 'c');
				});
				make.add(d, async () => {
					await writePath(d, 'd');
				});
			});

			await prg.update(a);
			expect(bCount).to.equal(1);

			await waitMs(1);
			await writePath(c, 'update c');
			await waitMs(1);
			await writePath(a, 'update a');

			// Above sets up where b is older than c, even though
			// b does not have any rule that says it depends on c
			await prg.update(a);

			expect(bCount).to.equal(2);
		});

		it('updates target group if any target in group is missing', async () => {
			const a = Path.build('a');
			const b = Path.build('b');
			const c = Path.src('c');

			await writePath(c, 'c');
			let count = 0;

			const prg = await parse((make) => {
				make.add([a, b], c, async () => {
					await writePath(a, 'a');
					await writePath(b, 'b');
					count += 1;
				});
			});

			await prg.update(a);
			expect(count).to.equal(1);

			await rmPath(b);

			await prg.update(a);
			expect(count).to.equal(2);
		});

		it('treats non-recipe target group as independent targets', async () => {
			const a = Path.build('a');
			const b = Path.build('b');
			const c = Path.src('c');

			let aCount = 0;
			let bCount = 0;

			await writePath(c, 'c');

			const prg = await parse((make) => {
				make.add([a, b], c);
				make.add(a, async () => {
					aCount += 1;
					await writePath(a, 'a');
				});

				make.add(b, async () => {
					bCount += 1;
					await writePath(b, 'b');
				});
			});

			await prg.update(a);
			expect(aCount).to.equal(1);
			expect(bCount).to.equal(0);
		});

		it('does not update a target if a prereq fails to update', async () => {
			const srcPath = Path.build('src.txt');
			const write = new WriteFileRule(srcPath, 'hello');
			write.returnFalseOnBuild();

			const cpPath = Path.build('cp.txt');
			const cp = new CopyFileRule(srcPath, cpPath);

			const prg = await parse((make) => {
				make.add(write);
				make.add(cp);
			});

			const result = await prg.update(cpPath);

			expect(cp.buildCount).to.equal(0);
			expect(result).to.be.false;
		});

		it('does not update a target if a prereq was deleted', async () => {
			const srcPath = Path.src('src.txt');
			const outPath = Path.build('out.txt');

			await writePath(srcPath, 'contents');

			const copy = new CopyFileRule(srcPath, outPath);
			const prg = await parse((make) => {
				make.add(copy);
			});

			let result = await prg.update(outPath);
			expect(result).to.be.true;
			expect(copy.buildCount).to.equal(1);

			// now delete (hits case where target path does exist prior)
			await rmPath(srcPath);

			result = await prg.update(outPath);
			expect(result).to.be.false;
			expect(copy.buildCount).to.equal(1);
		});

		it('logs a debug event when a target is already up to date', async () => {
			const srcPath = Path.src('src.txt');
			const outPath = Path.build('out.txt');

			await writePath(srcPath, 'contents');

			const copy = new CopyFileRule(srcPath, outPath);
			const prg = await parse((make) => {
				make.add(copy);
			});

			await prg.update(outPath);
			await waitMs(1);
			logs.clear();
			await prg.update(outPath);

			const evts = logs.findEvents(EVENT_TARGET_UP_TO_DATE);
			expect(evts).not.to.be.empty;
			const e = evts[0];
			expect(e.level).to.equal(LogLevel.debug);
		});

		describe('with postreqs', () => {
			const aPath = Path.src('a.txt');
			const bPath = Path.src('b.txt');
			const indexPath = Path.src('index.txt');
			const catPath = Path.build('cat.txt');
			let cat: CatFilesRecipe;

			function parse(fn?: MakefileFn): Promise<MakeProgram> {
				return MakeProgram.parse(
					(make) => {
						make.add(cat);
						fn && fn(make);
					},
					{ srcRoot, buildRoot },
				);
			}

			beforeEach(async () => {
				await writePath(aPath, 'A\n');
				await writePath(bPath, 'B\n');
				await writePath(indexPath, 'a.txt\nb.txt\n');

				cat = new CatFilesRecipe(indexPath, catPath);
			});

			it('remakes when postreq changes', async () => {
				const prg = await parse();
				let result = await prg.update(catPath); // build once
				expect(result).to.be.true;
				expect(cat.buildCount).to.equal(1);
				expect(await readPath(catPath)).to.equal('A\nB\n');

				await waitMs(2);
				await writePath(aPath, 'A change\n');
				result = await prg.update(catPath);

				expect(result).to.be.true;
				expect(cat.buildCount).to.equal(2);
				expect(await readPath(catPath)).to.equal('A change\nB\n');
			});

			it('does not remake if postreq does not change', async () => {
				const prg = await parse();
				let result = await prg.update(catPath);
				expect(result).to.be.true;
				expect(cat.buildCount).to.equal(1);
				expect(await readPath(catPath)).to.equal('A\nB\n');

				result = await prg.update(catPath);
				expect(result).to.be.true;
				expect(cat.buildCount).to.equal(1);
			});

			it('tracks postreq across runs', async () => {
				const prg = await parse();
				let result = await prg.update(catPath);
				expect(result).to.be.true;
				expect(cat.buildCount).to.equal(1);
				expect(await readPath(catPath)).to.equal('A\nB\n');

				// make a new instance to avoid any state in object
				const newPrg = await MakeProgram.parse(
					(make) => {
						make.add(cat);
					},
					{ srcRoot, buildRoot },
				);

				await waitMs(1);
				await writePath(aPath, 'A changed\n');
				result = await newPrg.update(catPath);
				expect(result).to.be.true;
				expect(cat.buildCount).to.equal(2);
				expect(await readPath(catPath)).to.equal('A changed\nB\n');
			});

			it('attempts to update target if static postreq does not exist', async () => {
				const prg = await parse();
				let result = await prg.update(catPath);
				expect(result).to.be.true;
				expect(cat.buildCount).to.equal(1);
				expect(await readPath(catPath)).to.equal('A\nB\n');

				await rmPath(aPath);
				result = await prg.update(catPath);
				expect(result).to.be.false;
				expect(cat.buildCount).to.equal(2);
			});
		});

		it('remembers postreqs for targets that are not always updated', async () => {
			const foo = Path.build('foo');
			const req = Path.src('req');
			const phony = Path.build('phony');

			await writePath(req, 'init');

			const counts = { foo: 0, phony: 0 };

			const prg = await parse((make) => {
				make.add('all', [foo, phony]);

				make.add(foo, async (args) => {
					counts.foo += 1;
					args.addPostreq(args.abs(req));
					await writePath(foo, counts.foo.toString());
					return true;
				});

				make.add(phony, () => {
					counts.phony += 1;
					return true;
				});
			});

			await prg.update();
			expect(counts.foo).to.equal(1, 'foo');
			expect(counts.phony).to.equal(1, 'phony');

			await waitMs(1);
			await prg.update();
			expect(counts.foo).to.equal(1, 'foo');
			expect(counts.phony).to.equal(2, 'phony');

			await waitMs(1);
			await writePath(req, 'update');

			await prg.update();
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
		it('does not update postreqs that are build paths', async () => {
			const srcPath = Path.src('src.txt');
			const cpPath = Path.build('copy.txt');
			const outPath = Path.build('out.txt');

			await writePath(srcPath, 'src');
			const copy = new CopyFileRule(srcPath, cpPath);
			let buildCount = 0;
			const prg = await parse((make) => {
				make.add(copy);

				// no a priori depencency on cpPath
				const adHocRecipe: IRule = {
					targets() {
						return outPath;
					},
					recipe: async (args: RecipeArgs) => {
						++buildCount;
						await writePath(outPath, 'test');
						// only after build
						args.addPostreq(abs(cpPath));
						return true;
					},
				};

				make.add(adHocRecipe);
			});

			expect(await prg.update(cpPath)).to.be.true;

			let result = await prg.update(outPath);
			expect(result).to.be.true;
			expect(buildCount).to.equal(1);
			expect(copy.buildCount).to.equal(1);

			// now presumably knows postreqs

			await writePath(srcPath, 'update');
			result = await prg.update(outPath);
			expect(buildCount).to.equal(1);
			expect(copy.buildCount).to.equal(1);
		});

		it('checks postreqs for all targets in target group', async () => {
			const a = Path.build('a');
			const b = Path.build('b');
			const c = Path.src('c');

			await writePath(c, 'c');

			const prg = await parse((make) => {
				make.add(a, async () => {
					writePath(a, 'a');
				});

				make.add(b, async (args) => {
					args.addPostreq(args.abs(c));
					await writePath(b, 'b');
				});
			});

			await prg.update(a);
			await prg.update(b);

			// now both exist and b has postreq on c
			let count = 0;
			const prg2 = await parse((make) => {
				make.add([a, b], () => {
					count += 1;
				});
			});

			await waitMs(1);
			await writePath(c, 'update c');

			await prg2.update(a);
			expect(count).to.equal(1);
		});

		it('warns if a target is stale and has no recipe to update', async () => {
			const stale = Path.build('stale');
			const src = Path.src('src');

			await mkdir(buildRoot, { recursive: true });
			await writePath(stale, 'stale');
			await waitMs(1);
			await writePath(src, 'src');

			const prg = await parse((make) => {
				make.add(stale, src);
			});

			const result = await prg.update(stale);
			expect(result).to.be.true;

			const evts = logs.findEvents(EVENT_TARGET_STALE_NO_RECIPE);
			expect(evts).not.to.be.empty;
			const e = evts[0];
			expect(e.level).to.equal(LogLevel.warn);
		});

		it('does not warn if a phony target without a recipe is stale', async () => {
			const src = Path.src('src');

			await writePath(src, 'src');

			const prg = await parse((make) => {
				make.add('phony', src);
			});

			const result = await prg.update('phony');
			expect(result).to.be.true;

			const evts = logs.findEvents(EVENT_TARGET_STALE_NO_RECIPE);
			expect(evts).to.be.empty;
		});

		it('is an error when the srcRoot is not a directory', async () => {
			const prg = await parse((make) => {
				make.add('simple', () => {});
			});

			await rm(srcRoot, { recursive: true });

			const result = await prg.update();
			expect(result, 'should fail').to.be.false;
			expect(
				logs.find(LogLevel.error, srcRoot),
				'build did not indicate srcRoot is unreadable',
			).not.to.be.null;
		});

		it('is an error when the buildRoot is not created', async () => {
			const nested = join(srcRoot, 'nested');
			const myBuild = join(nested, 'build');
			await mkdir(nested, { recursive: true });

			const prg = await MakeProgram.parse(
				(make) => {
					make.add('simple', () => {});
				},
				{ srcRoot, buildRoot: myBuild },
			);

			await makeReadOnlyDir(nested);
			const result = await prg.update();
			await restoreDirWriting(nested);

			expect(result, 'should fail').to.be.false;
			expect(
				logs.find(LogLevel.error, myBuild),
				'build did not indicate buildRoot is not writable',
			).not.to.be.null;
		});

		it('is an error when a cycle exists', async () => {
			const a = Path.build('a');
			const b = Path.build('b');

			const prg = await parse((make) => {
				make.add(a, b);
				make.add(b, a);
			});

			const result = await prg.update();
			expect(result).to.be.false;
			expect(
				logs.find(LogLevel.error, /[Cc]ircular/),
				'build did not indicate a circular dependency was found',
			).not.to.be.null;
		});
	});
});

function makeReadOnlyDir(path: string): Promise<void> {
	if (platform() === 'win32') {
		return new Promise<void>((res, rej) => {
			execFile(
				'icacls',
				[path, '/deny', 'Everyone:(OI)(CI)W'],
				(err: Error | null) => {
					if (err) {
						rej(err);
						return;
					}
					res();
				},
			);
		});
	} else {
		return chmod(path, 0o555);
	}
}

function restoreDirWriting(path: string): Promise<void> {
	if (platform() === 'win32') {
		return new Promise<void>((res, rej) => {
			execFile('icacls', [path, '/reset', '/T'], (err: Error | null) => {
				if (err) {
					rej(err);
					return;
				}
				res();
			});
		});
	} else {
		return chmod(path, 0o775);
	}
}
