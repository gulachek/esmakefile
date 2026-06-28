import {
	Makefile,
	MakeProgram,
	IRule,
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
import { existsSync, statSync } from 'node:fs';
import { InMemoryLoggerProvider } from '../InMemoryLoggerProvider.js';
import { LogLevel, setLoggerProvider } from '../logs.js';
import { ATTR_EXCEPTION_MESSAGE } from '@opentelemetry/semantic-conventions';
import {
	EVENT_MAKEFILE_EXCEPTION,
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
	readonly path: string;
	public txt: string;

	constructor(path: string, txt: string) {
		super();
		this.path = path;
		this.txt = txt;
	}

	targets() {
		return this.path;
	}

	override async onBuild(args: RecipeArgs) {
		const path = resolve(args.rootDir, this.path);
		await writeFile(path, this.txt, 'utf8');
		return true;
	}
}

class CopyFileRule extends TestRule implements IRule {
	readonly src: string;
	readonly dest: string;

	constructor(src: string, dest: string) {
		super();
		this.src = src;
		this.dest = dest;
	}

	prereqs() {
		return this.src;
	}

	targets() {
		return this.dest;
	}

	override async onBuild(args: RecipeArgs): Promise<boolean> {
		const dest = resolve(args.rootDir, this.dest);
		const src = resolve(args.rootDir, this.src);

		try {
			await copyFile(src, dest);
			return true;
		} catch {
			return false;
		}
	}
}

class CatFilesRecipe implements IRule {
	readonly src: string;
	readonly dest: string;
	buildCount: number = 0;

	constructor(src: string, dest: string) {
		this.src = src;
		this.dest = dest;
	}

	targets() {
		return this.dest;
	}
	prereqs() {
		return this.src;
	}

	async recipe(args: RecipeArgs): Promise<boolean> {
		const dest = resolve(args.rootDir, this.dest);
		const src = resolve(args.rootDir, this.src);

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
		it('lists targets by path relative to root dir', async () => {
			const make = await MakeProgram.parse((mk) => {
				mk.rule(new WriteFileRule('write.txt', 'hello'));
				mk.rule(new CopyFileRule('src.txt', 'sub/dest.txt'));
			});

			const targets = new Set(make.targets());

			expect(targets.size).to.equal(2);
			expect(targets.has('write.txt')).to.be.true;
			expect(targets.has('sub/dest.txt')).to.be.true;
		});
	});

	describe('rule', () => {
		it('cannot add rule to Makefile after parsing is complete', async () => {
			let outerMk: Makefile;
			await MakeProgram.parse((mk) => {
				outerMk = mk;
				mk.rule(new WriteFileRule('write.txt', 'hello'));
			});

			expect(() =>
				outerMk.rule(new CopyFileRule('src.txt', '/sub/dest.txt')),
			).to.throw();
		});

		it('throws if two recipes are given for a target', async () => {
			let expectationsRan = false;
			await MakeProgram.parse((mk) => {
				const path = 'conflict.txt';
				const write = new WriteFileRule(path, 'hello');
				const copy = new CopyFileRule('something.txt', path);

				mk.rule(write);
				expect(() => mk.rule(copy)).to.throw();
				expectationsRan = true;
			});

			expect(expectationsRan).to.be.true;
		});

		it('can add multiple rules for the same target', async () => {
			let expectationsRan = false;
			await MakeProgram.parse((mk) => {
				const target = 'target.txt';
				const anotherDep = 'dep.txt';
				const write = new WriteFileRule(target, 'hello');
				mk.rule(write);
				expect(() => mk.rule(target, anotherDep)).not.to.throw();
				expectationsRan = true;
			});
			expect(expectationsRan).to.be.true;
		});
	});

	describe('hasTarget', () => {
		it('returns true if target is added to a rule', async () => {
			const make = await MakeProgram.parse((mk) => {
				mk.rule('foo', () => {});
			});

			expect(make.hasTarget('foo')).to.be.true;
		});

		it('returns false if target is not added to a rule', async () => {
			const make = await MakeProgram.parse((mk) => {
				mk.rule('foo', () => {});
			});

			expect(make.hasTarget('bar')).to.be.false;
		});
	});

	describe('recipe', () => {
		const rootDir = resolve('test-src');

		function rel(...parts: string[]): string {
			return join(rootDir, ...parts);
		}

		function writePath(path: string, contents: string): Promise<void> {
			return writeFile(resolve(rootDir, path), contents, 'utf8');
		}

		function readPath(path: string): Promise<string> {
			return readFile(resolve(rootDir, path), 'utf8');
		}

		function rmPath(path: string): Promise<void> {
			return rm(resolve(rootDir, path));
		}

		async function parse(makeFn: MakefileFn): Promise<MakeProgram | null> {
			return MakeProgram.parse(makeFn, { rootDir });
		}

		beforeEach(async () => {
			const stats = statSync(rootDir, { throwIfNoEntry: false });
			if (stats) {
				await chmod(rootDir, 0o777);
				await rm(rootDir, { recursive: true });
				expect(existsSync(rootDir)).to.be.false;
			}

			await mkdir(rootDir, { recursive: true });
		});

		it('updates a target', async () => {
			const path = 'output.txt';

			const make = await parse((mk) => {
				const write = new WriteFileRule(path, 'hello');
				mk.rule(write);
			});

			const result = await make.update(path);
			const contents = await readPath(path);
			expect(contents).to.equal('hello');
			expect(result).to.be.true;
		});

		it('debug logs when a recipe begins', async () => {
			const make = await parse((mk) => {
				mk.rule('all', () => {});
			});

			await make.update();

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

			const make = await parse((mk) => {
				mk.rule('all', () => {
					++count;
				});
			});

			const result = await make.update();
			expect(result).to.be.true;
			expect(count).to.equal(1);
		});

		it('remakes a phony target', async () => {
			let count = 0;

			const make = await parse((mk) => {
				mk.rule('all', () => {
					++count;
				});
			});

			await make.update();
			await make.update();
			expect(count).to.equal(2);
		});

		it('fails if recipe returns false', async () => {
			const make = await parse((mk) => {
				mk.rule('all', () => false);
			});

			const result = await make.update();
			expect(result).to.be.false;
		});

		it('succeeds if recipe is void', async () => {
			const make = await parse((mk) => {
				mk.rule('all', () => {});
			});
			const result = await make.update();
			expect(result).to.be.true;
		});

		it('succeeds if recipe is true', async () => {
			const make = await parse((mk) => {
				mk.rule('all', () => true);
			});
			const result = await make.update();
			expect(result).to.be.true;
		});

		it('fails if recipe returns Promise<false>', async () => {
			const make = await parse((mk) => {
				mk.rule('all', () => Promise.resolve(false));
			});
			const result = await make.update();
			expect(result).to.be.false;
		});

		it('succeeds if recipe is Promise<void>', async () => {
			const make = await parse((mk) => {
				mk.rule('all', () => Promise.resolve());
			});
			const result = await make.update();
			expect(result).to.be.true;
		});

		it('succeeds if recipe is Promise<true>', async () => {
			const make = await parse((mk) => {
				mk.rule('all', () => Promise.resolve(true));
			});
			const result = await make.update();
			expect(result).to.be.true;
		});

		it('fails if recipe throws', async () => {
			const path = 'test.txt';
			const write = new WriteFileRule(path, 'test');

			const make = await parse((mk) => {
				write.throwOnBuild(new Error('test'));
				mk.rule(write);
			});

			const result = await make.update(path);
			expect(result).to.be.false;
		});

		it('logs an exception event when recipe throws', async () => {
			const thrownMsg = 'thrown message';

			const make = await parse((mk) => {
				mk.rule('throw', () => {
					throw new Error(thrownMsg);
				});
			});

			await make.update();

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
			const pOne = 'one.txt';
			const pTwo = 'two.txt';
			const writeOne = new WriteFileRule(pOne, 'one');
			const writeTwo = new WriteFileRule(pTwo, 'two');

			const make = await parse((mk) => {
				mk.rule(writeOne);
				mk.rule(writeTwo);
			});

			const result = await make.update();
			expect(result).to.be.true;
			expect(writeOne.buildCount).to.equal(1);
			expect(writeTwo.buildCount).to.equal(0);
		});

		it('fails when no targets exist for a default goal', async () => {
			const make = await parse(() => {});
			const result = await make.update();
			expect(result).to.be.false;
			expect(logs.find(LogLevel.error, /No target/i)).not.to.be.null;
		});

		it('does not update first target when another is specified', async () => {
			const pOne = 'one.txt';
			const pTwo = 'two.txt';
			const writeOne = new WriteFileRule(pOne, 'one');
			const writeTwo = new WriteFileRule(pTwo, 'two');

			const make = await parse((mk) => {
				mk.rule(writeOne);
				mk.rule(writeTwo);
			});

			const result = await make.update(pTwo);
			expect(result).to.be.true;
			expect(writeOne.buildCount).to.equal(0);
			expect(writeTwo.buildCount).to.equal(1);
		});

		it('fails when explicit goal does not exist as a target', async () => {
			const make = await parse((mk) => {
				mk.rule('foo', () => {});
			});

			const result = await make.update('does-not-exist');
			expect(result).to.be.false;
			expect(logs.find(LogLevel.error, /no target .*does-not-exist/i)).not.to.be
				.empty;
		});

		it("updates a target's prereq", async () => {
			const target = 'target';
			const prereq = 'prereq';
			let prereqUpdated = false;

			const make = await parse((mk) => {
				mk.rule(target, [prereq]);
				mk.rule(prereq, () => {
					prereqUpdated = true;
				});
			});

			const result = await make.update(target);

			expect(result, 'expected update success').to.be.true;
			expect(prereqUpdated, 'expected prereq to be updated').to.be.true;
		});

		it('defaults a string type prereq to src path', async () => {
			const prereq = 'prereq';
			await writePath(prereq, 'prereq');

			let contents: string = '';

			const make = await parse((mk) => {
				mk.rule('all', 'prereq', async () => {
					contents = await readPath(prereq);
				});
			});

			await make.update();
			expect(contents).to.equal('prereq');
		});

		it('updates a phony target without a recipe', async () => {
			const make = await parse((mk) => {
				mk.rule('all');
			});

			const result = await make.update();
			expect(result).to.be.true;
		});

		it('updates a phony target without a recipe with prereqs', async () => {
			const make = await parse((mk) => {
				const srcPath = 'src.txt';

				mk.rule('all', srcPath);

				const write = new WriteFileRule(srcPath, 'hello');
				mk.rule(write);
			});

			const result = await make.update();
			expect(result).to.be.true;
		});

		it("fails if a src prereq doesn't exist", async () => {
			const make = await parse((mk) => {
				mk.rule('all', 'prereq');
			});
			const result = await make.update();
			expect(result).to.be.false;
		});

		it("fails if a build prereq doesn't have a recipe", async () => {
			const make = await parse((mk) => {
				mk.rule('all', 'prereq');
			});
			const result = await make.update();
			expect(result).to.be.false;
		});

		it('succeeds if a build prereq does have a recipe that succeeds', async () => {
			const make = await parse((mk) => {
				const prereq = 'prereq';
				mk.rule('all', prereq);
				mk.rule(prereq, () => {});
			});

			const result = await make.update();
			expect(result).to.be.true;
		});

		it('remakes if depending on a phony target', async () => {
			const a = 'a';
			const phony = 'phony';
			const src = 'src';

			await writePath(src, 'src');

			let count = 0;

			const make = await parse((mk) => {
				mk.rule(a, [phony, src], async () => {
					count += 1;
					await writePath(a, 'a');
				});

				mk.rule(phony, () => {});
			});

			await make.update(a);
			expect(count).to.equal(1);

			await make.update(a);
			expect(count).to.equal(2);
		});

		it('ensures a target directory exists before updating', async () => {
			const srcPath = 'src.txt';
			const write = new WriteFileRule(srcPath, 'hello');

			const cpPath = join('sub', 'cp.txt');
			const cp = new CopyFileRule(srcPath, cpPath);

			const make = await parse((mk) => {
				mk.rule(write);
				mk.rule(cp);
			});

			await make.update(cpPath);

			const dirStat = await stat(dirname(rel(cpPath)));
			expect(dirStat.isDirectory()).to.be.true;
		});

		it('skips updating target if newer than prereqs', async () => {
			const srcPath = 'src.txt';
			const write = new WriteFileRule(srcPath, 'hello');

			const cpPath = 'cp.txt';
			const cp = new CopyFileRule(srcPath, cpPath);

			const make = await parse((mk) => {
				mk.rule(write);
				mk.rule(cp);
			});

			await make.update(cpPath);
			await make.update(cpPath);

			expect(cp.buildCount).to.equal(1);
		});

		it('remakes target if older than prereqs', async () => {
			const srcPath = 'src.txt';
			await writePath(srcPath, 'hello');

			const cpPath = 'cp.txt';
			const cp = new CopyFileRule(srcPath, cpPath);
			const make = await parse((mk) => {
				mk.rule(cp);
			});

			await make.update(cpPath);
			await waitMs(1);
			await writePath(srcPath, 'update');

			await make.update(cpPath);

			expect(cp.buildCount).to.equal(2);
			const contents = await readPath(cpPath);
			expect(contents).to.equal('update');
		});

		it('remakes target if older than prereqs in non-recipe rules', async () => {
			const srcPath = 'src.txt';
			const otherPath = 'other.txt';
			await writePath(srcPath, 'hello');
			await writePath(otherPath, 'other');

			const cpPath = 'cp.txt';
			const cp = new CopyFileRule(srcPath, cpPath);

			const make = await parse((mk) => {
				mk.rule(cp);
				mk.rule(cpPath, otherPath);
			});

			await make.update(cpPath);
			await waitMs(1);
			await writePath(otherPath, 'update');

			await make.update(cpPath);

			expect(cp.buildCount).to.equal(2);
			const contents = await readPath(cpPath);
			expect(contents).to.equal('hello');
		});

		it('calling update() while an update is in progress does not immediately start a new update', async () => {
			const srcPath = 'src.txt';
			const write = new WriteFileRule(srcPath, 'hello');

			const cpPath = 'cp.txt';
			const cp = new CopyFileRule(srcPath, cpPath);

			const make = await parse((mk) => {
				mk.rule(write);
				mk.rule(cp);
			});

			const first = make.update(cpPath);
			const second = make.update(cpPath);
			await Promise.all([first, second]);

			expect(write.buildCount).to.equal(1);
			expect(cp.buildCount).to.equal(1);
		});

		it('updating two targets from same target group runs recipe once', async () => {
			let count = 0;
			const first = 'first';
			const second = 'second';

			const make = await parse((mk) => {
				mk.rule('all', [first, second]);
				mk.rule([first, second], () => {
					count += 1;
				});
			});

			await make.update();

			expect(count).to.equal(1);
		});

		it('updates prereqs of all targets in target group', async () => {
			const a = 'a';
			const b = 'b';
			const c = 'c';
			const d = 'd';

			let cCount = 0;
			let dCount = 0;

			const make = await parse((mk) => {
				mk.rule([a, b], () => {});
				mk.rule(a, c);
				mk.rule(b, d);
				mk.rule(c, () => {
					cCount += 1;
				});
				mk.rule(d, () => {
					dCount += 1;
				});
			});

			await make.update(a);

			expect(cCount).to.equal(1, "goal's prereq is not updated");
			expect(dCount).to.equal(1, "non-goal's prereq is not updated");
		});

		it('updates target group if any target is older than any prereq', async () => {
			const a = 'a';
			const b = 'b';
			const c = 'c';
			const d = 'd';

			let bCount = 0;

			const make = await parse((mk) => {
				mk.rule([a, b], async () => {
					bCount += 1;
					await writePath(a, 'a');
					await writePath(b, 'b');
				});

				mk.rule(a, c);
				mk.rule(b, d);
				mk.rule(c, async () => {
					await writePath(c, 'c');
				});
				mk.rule(d, async () => {
					await writePath(d, 'd');
				});
			});

			await make.update(a);
			expect(bCount).to.equal(1);

			await waitMs(1);
			await writePath(c, 'update c');
			await waitMs(1);
			await writePath(a, 'update a');

			// Above sets up where b is older than c, even though
			// b does not have any rule that says it depends on c
			await make.update(a);

			expect(bCount).to.equal(2);
		});

		it('updates target group if any target in group is missing', async () => {
			const a = 'a';
			const b = 'b';
			const c = 'c';

			await writePath(c, 'c');
			let count = 0;

			const make = await parse((mk) => {
				mk.rule([a, b], c, async () => {
					await writePath(a, 'a');
					await writePath(b, 'b');
					count += 1;
				});
			});

			await make.update(a);
			expect(count).to.equal(1);

			await rmPath(b);

			await make.update(a);
			expect(count).to.equal(2);
		});

		it('treats non-recipe target group as independent targets', async () => {
			const a = 'a';
			const b = 'b';
			const c = 'c';

			let aCount = 0;
			let bCount = 0;

			await writePath(c, 'c');

			const make = await parse((mk) => {
				mk.rule([a, b], c);
				mk.rule(a, async () => {
					aCount += 1;
					await writePath(a, 'a');
				});

				mk.rule(b, async () => {
					bCount += 1;
					await writePath(b, 'b');
				});
			});

			await make.update(a);
			expect(aCount).to.equal(1);
			expect(bCount).to.equal(0);
		});

		it('does not update a target if a prereq fails to update', async () => {
			const srcPath = 'src.txt';
			const write = new WriteFileRule(srcPath, 'hello');
			write.returnFalseOnBuild();

			const cpPath = 'cp.txt';
			const cp = new CopyFileRule(srcPath, cpPath);

			const make = await parse((mk) => {
				mk.rule(write);
				mk.rule(cp);
			});

			const result = await make.update(cpPath);

			expect(cp.buildCount).to.equal(0);
			expect(result).to.be.false;
		});

		it('does not update a target if a prereq was deleted', async () => {
			const srcPath = 'src.txt';
			const outPath = 'out.txt';

			await writePath(srcPath, 'contents');

			const copy = new CopyFileRule(srcPath, outPath);
			const make = await parse((mk) => {
				mk.rule(copy);
			});

			let result = await make.update(outPath);
			expect(result).to.be.true;
			expect(copy.buildCount).to.equal(1);

			// now delete (hits case where target path does exist prior)
			await rmPath(srcPath);

			result = await make.update(outPath);
			expect(result).to.be.false;
			expect(copy.buildCount).to.equal(1);
		});

		it('logs a debug event when a target is already up to date', async () => {
			const srcPath = 'src.txt';
			const outPath = 'out.txt';

			await writePath(srcPath, 'contents');

			const copy = new CopyFileRule(srcPath, outPath);
			const make = await parse((mk) => {
				mk.rule(copy);
			});

			await make.update(outPath);
			await waitMs(1);
			logs.clear();
			await make.update(outPath);

			const evts = logs.findEvents(EVENT_TARGET_UP_TO_DATE);
			expect(evts).not.to.be.empty;
			const e = evts[0];
			expect(e.level).to.equal(LogLevel.debug);
		});

		describe('include', () => {
			it('parses nested target', async () => {
				const nested = 'nested-target';

				const make = await parse((mk) => {
					mk.include('nested.mk', (mk) => {
						mk.rule(nested, () => {});
					});
				});

				expect(
					make.hasTarget(nested),
					'expected program to contain nested target',
				).to.be.true;
			});

			it('throws when Makefile target already has recipe', async () => {
				let expectationsRan = false;
				await parse((mk) => {
					const p = 'include.mk';
					mk.rule(p, () => {}); // add recipe
					expect(() => {
						mk.include(p, () => {});
					}).to.throw(/has a recipe/);
					expectationsRan = true;
				});

				expect(expectationsRan, 'Did not evaluate expectation').to.be.true;
			});

			it('throws when recipe is added to a Makefile target', async () => {
				let expectationsRan = false;
				await parse((mk) => {
					const p = 'include.mk';
					mk.include(p, () => {});
					expect(() => {
						mk.rule(p, () => {}); // add recipe
					}).to.throw(/[Cc]annot add a recipe to/);
					expectationsRan = true;
				});

				expect(expectationsRan, 'Did not evaluate expectation').to.be.true;
			});

			it('updates prereqs prior to executing included mk function', async () => {
				const nested = 'nested-target';

				const make = await parse((mk) => {
					const nestedMk = 'nested.mk';
					const prereq = 'prereq';
					let prereqUpdated = false;

					mk.include(nestedMk, (mk) => {
						expect(prereqUpdated, 'expected prereq to be updated').to.be.true;
						mk.rule(nested, () => {});
					});

					mk.rule(nestedMk, [prereq]);

					mk.rule(prereq, () => {
						prereqUpdated = true;
					});
				});

				expect(
					make.hasTarget(nested),
					'expected program to contain nested target',
				).to.be.true;
			});

			it('returns null while parsing when a nested Makefile cannot be updated', async () => {
				const nested = 'nested-target';

				const make = await parse((mk) => {
					const nestedMk = 'nested.mk';
					const prereq = 'prereq';

					mk.include(nestedMk, (mk) => {
						mk.rule(nested, () => {});
					});

					mk.rule(nestedMk, [prereq]);
					mk.rule(prereq, () => false);
				});

				expect(make).to.be.null;
				expect(logs.find(LogLevel.error, /nested\.mk/)).not.to.be.null;
			});

			it('returns null when nested MakefileFn throws', async () => {
				const make = await parse((mk) => {
					const nestedMk = 'nested.mk';

					mk.include(nestedMk, () => {
						throw new Error('hehe');
					});
				});

				expect(make).to.be.null;
				expect(logs.findEvents(EVENT_MAKEFILE_EXCEPTION)).not.to.be.empty;
			});
		});

		xdescribe('with postreqs', () => {
			const aPath = 'a.txt';
			const bPath = 'b.txt';
			const indexPath = 'index.txt';
			const catPath = 'cat.txt';
			let cat: CatFilesRecipe;

			function parse(fn?: MakefileFn): Promise<MakeProgram> {
				return MakeProgram.parse(
					(mk) => {
						mk.rule(cat);
						fn && fn(mk);
					},
					{ rootDir },
				);
			}

			beforeEach(async () => {
				await writePath(aPath, 'A\n');
				await writePath(bPath, 'B\n');
				await writePath(indexPath, 'a.txt\nb.txt\n');

				cat = new CatFilesRecipe(indexPath, catPath);
			});

			it('remakes when postreq changes', async () => {
				const make = await parse();
				let result = await make.update(catPath); // build once
				expect(result).to.be.true;
				expect(cat.buildCount).to.equal(1);
				expect(await readPath(catPath)).to.equal('A\nB\n');

				await waitMs(2);
				await writePath(aPath, 'A change\n');
				result = await make.update(catPath);

				expect(result).to.be.true;
				expect(cat.buildCount).to.equal(2);
				expect(await readPath(catPath)).to.equal('A change\nB\n');
			});

			it('does not remake if postreq does not change', async () => {
				const make = await parse();
				let result = await make.update(catPath);
				expect(result).to.be.true;
				expect(cat.buildCount).to.equal(1);
				expect(await readPath(catPath)).to.equal('A\nB\n');

				result = await make.update(catPath);
				expect(result).to.be.true;
				expect(cat.buildCount).to.equal(1);
			});

			it('tracks postreq across runs', async () => {
				const make = await parse();
				let result = await make.update(catPath);
				expect(result).to.be.true;
				expect(cat.buildCount).to.equal(1);
				expect(await readPath(catPath)).to.equal('A\nB\n');

				// make a new instance to avoid any state in object
				const newPrg = await MakeProgram.parse(
					(mk) => {
						mk.rule(cat);
					},
					{ rootDir },
				);

				await waitMs(1);
				await writePath(aPath, 'A changed\n');
				result = await newPrg.update(catPath);
				expect(result).to.be.true;
				expect(cat.buildCount).to.equal(2);
				expect(await readPath(catPath)).to.equal('A changed\nB\n');
			});

			it('attempts to update target if static postreq does not exist', async () => {
				const make = await parse();
				let result = await make.update(catPath);
				expect(result).to.be.true;
				expect(cat.buildCount).to.equal(1);
				expect(await readPath(catPath)).to.equal('A\nB\n');

				await rmPath(aPath);
				result = await make.update(catPath);
				expect(result).to.be.false;
				expect(cat.buildCount).to.equal(2);
			});
		});

		xit('remembers postreqs for targets that are not always updated', async () => {
			const foo = 'foo';
			const req = 'req';
			const phony = 'phony';

			await writePath(req, 'init');

			const counts = { foo: 0, phony: 0 };

			const make = await parse((mk) => {
				mk.rule('all', [foo, phony]);

				mk.rule(foo, async (args) => {
					counts.foo += 1;
					args.addPostreq(resolve(args.rootDir, req));
					await writePath(foo, counts.foo.toString());
					return true;
				});

				mk.rule(phony, () => {
					counts.phony += 1;
					return true;
				});
			});

			await make.update();
			expect(counts.foo).to.equal(1, 'foo');
			expect(counts.phony).to.equal(1, 'phony');

			await waitMs(1);
			await make.update();
			expect(counts.foo).to.equal(1, 'foo');
			expect(counts.phony).to.equal(2, 'phony');

			await waitMs(1);
			await writePath(req, 'update');

			await make.update();
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
		xit('does not update postreqs that are build paths', async () => {
			const srcPath = 'src.txt';
			const cpPath = 'copy.txt';
			const outPath = 'out.txt';

			await writePath(srcPath, 'src');
			const copy = new CopyFileRule(srcPath, cpPath);
			let buildCount = 0;
			const make = await parse((mk) => {
				mk.rule(copy);

				// no a priori depencency on cpPath
				const adHocRecipe: IRule = {
					targets() {
						return outPath;
					},
					recipe: async (args: RecipeArgs) => {
						++buildCount;
						await writePath(outPath, 'test');
						// only after build
						args.addPostreq(resolve(args.rootDir, cpPath));
						return true;
					},
				};

				mk.rule(adHocRecipe);
			});

			expect(await make.update(cpPath)).to.be.true;

			let result = await make.update(outPath);
			expect(result).to.be.true;
			expect(buildCount).to.equal(1);
			expect(copy.buildCount).to.equal(1);

			// now presumably knows postreqs

			await writePath(srcPath, 'update');
			result = await make.update(outPath);
			expect(buildCount).to.equal(1);
			expect(copy.buildCount).to.equal(1);
		});

		xit('checks postreqs for all targets in target group', async () => {
			const a = 'a';
			const b = 'b';
			const c = 'c';

			await writePath(c, 'c');

			const make = await parse((mk) => {
				mk.rule(a, async () => {
					writePath(a, 'a');
				});

				mk.rule(b, async (args) => {
					args.addPostreq(resolve(args.rootDir, c));
					await writePath(b, 'b');
				});
			});

			await make.update(a);
			await make.update(b);

			// now both exist and b has postreq on c
			let count = 0;
			const prg2 = await parse((mk) => {
				mk.rule([a, b], () => {
					count += 1;
				});
			});

			await waitMs(1);
			await writePath(c, 'update c');

			await prg2.update(a);
			expect(count).to.equal(1);
		});

		it('warns if a target is stale and has no recipe to update', async () => {
			const stale = 'stale';
			const src = 'src';

			await writePath(stale, 'stale');
			await waitMs(1);
			await writePath(src, 'src');

			const make = await parse((mk) => {
				mk.rule(stale, src);
			});

			const result = await make.update(stale);
			expect(result).to.be.true;

			const evts = logs.findEvents(EVENT_TARGET_STALE_NO_RECIPE);
			expect(evts).not.to.be.empty;
			const e = evts[0];
			expect(e.level).to.equal(LogLevel.warn);
		});

		it('does not warn if a phony target without a recipe is stale', async () => {
			const src = 'src';

			await writePath(src, 'src');

			const make = await parse((mk) => {
				mk.rule('phony', src);
			});

			const result = await make.update('phony');
			expect(result).to.be.true;

			const evts = logs.findEvents(EVENT_TARGET_STALE_NO_RECIPE);
			expect(evts).to.be.empty;
		});

		it('is an error when the rootDir is not a directory', async () => {
			const make = await parse((mk) => {
				mk.rule('simple', () => {});
			});

			await rm(rootDir, { recursive: true });

			const result = await make.update();
			expect(result, 'should fail').to.be.false;
			expect(
				logs.find(LogLevel.error, rootDir),
				'build did not indicate rootDir is unreadable',
			).not.to.be.null;
		});

		it('is an error when the __esmakefile__ dir is not created', async () => {
			const make = await MakeProgram.parse(
				(mk) => {
					mk.rule('simple', () => {});
				},
				{ rootDir },
			);

			await makeReadOnlyDir(rootDir);
			const result = await make.update();
			await restoreDirWriting(rootDir);

			expect(result, 'should fail').to.be.false;
			expect(
				logs.find(LogLevel.error, rootDir),
				'build failed to indicate that directory is not writable',
			).not.to.be.null;
		});

		it('is an error when a cycle exists', async () => {
			const make = await parse((mk) => {
				mk.rule('a', 'b');
				mk.rule('b', 'a');
			});

			const result = await make.update();
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
