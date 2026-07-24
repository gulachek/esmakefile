import { Makefile, MakeProgram, IRule, RecipeArgs } from '../index.js';
import {
	writeFile,
	copyFile,
	readFile,
	rm,
	mkdir,
	stat,
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

	override async onBuild() {
		await writeFile(this.path, this.txt, 'utf8');
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

	override async onBuild(): Promise<boolean> {
		try {
			await copyFile(this.src, this.dest);
			return true;
		} catch {
			return false;
		}
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

	describe('parse', () => {
		it('returns true when fn returns void', async () => {
			const make = new MakeProgram(() => {});
			const result = await make.parse();
			expect(result).to.be.true;
		});

		it('returns true when fn returns void Promise', async () => {
			const make = new MakeProgram(async () => {
				await waitMs(0);
			});
			const result = await make.parse();
			expect(result).to.be.true;
		});

		it('returns true when fn returns true', async () => {
			const make = new MakeProgram(() => {
				return true;
			});
			const result = await make.parse();
			expect(result).to.be.true;
		});

		it('returns true when fn returns true Promise', async () => {
			const make = new MakeProgram(() => {
				return Promise.resolve(true);
			});
			const result = await make.parse();
			expect(result).to.be.true;
		});

		it('returns false when fn throws', async () => {
			const make = new MakeProgram(() => {
				throw new Error('blah');
			});
			const result = await make.parse();
			expect(result).to.be.false;
		});

		it('returns false when fn returns false', async () => {
			const make = new MakeProgram(() => {
				return false;
			});
			const result = await make.parse();
			expect(result).to.be.false;
			expect(logs.find(LogLevel.error, /Makefile .* returned false/)).not.to.be
				.empty;
		});

		it('returns false when fn returns false Promise', async () => {
			const make = new MakeProgram(() => {
				return Promise.resolve(false);
			});
			const result = await make.parse();
			expect(result).to.be.false;
			expect(logs.find(LogLevel.error, /Makefile .* returned false/)).not.to.be
				.empty;
		});
	});

	describe('targets', () => {
		it('lists targets', async () => {
			const make = new MakeProgram((mk) => {
				mk.rule(new WriteFileRule('write.txt', 'hello'));
				mk.rule(new CopyFileRule('src.txt', 'sub/dest.txt'));
			});

			const targets = new Set(await make.targets());

			expect(targets.size).to.equal(2);
			expect(targets.has('write.txt')).to.be.true;
			expect(targets.has('sub/dest.txt')).to.be.true;
		});
	});

	describe('rule', () => {
		it('cannot add rule to Makefile after parsing is complete', async () => {
			let outerMk: Makefile;
			new MakeProgram((mk) => {
				outerMk = mk;
				mk.rule(new WriteFileRule('write.txt', 'hello'));
			});

			expect(() =>
				outerMk.rule(new CopyFileRule('src.txt', '/sub/dest.txt')),
			).to.throw();
		});

		it('throws if two recipes are given for a target', async () => {
			let expectationsRan = false;
			const make = new MakeProgram((mk) => {
				const path = 'conflict.txt';
				const write = new WriteFileRule(path, 'hello');
				const copy = new CopyFileRule('something.txt', path);

				mk.rule(write);
				expect(() => mk.rule(copy)).to.throw();
				expectationsRan = true;
			});
			await make.parse();

			expect(expectationsRan).to.be.true;
		});

		it('can add multiple rules for the same target', async () => {
			let expectationsRan = false;
			const make = new MakeProgram((mk) => {
				const target = 'target.txt';
				const anotherDep = 'dep.txt';
				const write = new WriteFileRule(target, 'hello');
				mk.rule(write);
				expect(() => mk.rule(target, anotherDep)).not.to.throw();
				expectationsRan = true;
			});
			await make.parse();

			expect(expectationsRan).to.be.true;
		});
	});

	describe('hasTarget', () => {
		it('returns true if target is added to a rule', async () => {
			const make = new MakeProgram((mk) => {
				mk.rule('foo', () => {});
			});

			expect(await make.hasTarget('foo')).to.be.true;
		});

		it('returns false if target is not added to a rule', async () => {
			const make = new MakeProgram((mk) => {
				mk.rule('foo', () => {});
			});

			expect(await make.hasTarget('bar')).to.be.false;
		});
	});

	describe('recipe', () => {
		const rootDir = '.';
		let cwd: string;

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

		beforeEach(async () => {
			const testSrc = resolve('test-src');
			const stats = statSync(testSrc, { throwIfNoEntry: false });
			if (stats) {
				await chmod(testSrc, 0o777);
				await rm(testSrc, { recursive: true });
				expect(existsSync(testSrc)).to.be.false;
			}

			await mkdir(testSrc, { recursive: true });

			cwd = process.cwd();
			process.chdir(testSrc);
		});

		afterEach(() => {
			process.chdir(cwd);
		});

		it('updates a target', async () => {
			const path = 'output.txt';

			const make = new MakeProgram((mk) => {
				const write = new WriteFileRule(path, 'hello');
				mk.rule(write);
			});

			const result = await make.update(path);
			const contents = await readPath(path);
			expect(contents).to.equal('hello');
			expect(result).to.be.true;
		});

		it('debug logs when a recipe begins', async () => {
			const make = new MakeProgram((mk) => {
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

			const make = new MakeProgram((mk) => {
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

			const make = new MakeProgram((mk) => {
				mk.rule('all', () => {
					++count;
				});
			});

			await make.update();
			await make.update();
			expect(count).to.equal(2);
		});

		it('fails if recipe returns false', async () => {
			const make = new MakeProgram((mk) => {
				mk.rule('all', () => false);
			});

			const result = await make.update();
			expect(result).to.be.false;
		});

		it('succeeds if recipe is void', async () => {
			const make = new MakeProgram((mk) => {
				mk.rule('all', () => {});
			});
			const result = await make.update();
			expect(result).to.be.true;
		});

		it('succeeds if recipe is true', async () => {
			const make = new MakeProgram((mk) => {
				mk.rule('all', () => true);
			});
			const result = await make.update();
			expect(result).to.be.true;
		});

		it('fails if recipe returns Promise<false>', async () => {
			const make = new MakeProgram((mk) => {
				mk.rule('all', () => Promise.resolve(false));
			});
			const result = await make.update();
			expect(result).to.be.false;
		});

		it('succeeds if recipe is Promise<void>', async () => {
			const make = new MakeProgram((mk) => {
				mk.rule('all', () => Promise.resolve());
			});
			const result = await make.update();
			expect(result).to.be.true;
		});

		it('succeeds if recipe is Promise<true>', async () => {
			const make = new MakeProgram((mk) => {
				mk.rule('all', () => Promise.resolve(true));
			});
			const result = await make.update();
			expect(result).to.be.true;
		});

		it('fails if recipe throws', async () => {
			const path = 'test.txt';
			const write = new WriteFileRule(path, 'test');

			const make = new MakeProgram((mk) => {
				write.throwOnBuild(new Error('test'));
				mk.rule(write);
			});

			const result = await make.update(path);
			expect(result).to.be.false;
		});

		it('logs an exception event when recipe throws', async () => {
			const thrownMsg = 'thrown message';

			const make = new MakeProgram((mk) => {
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

			const make = new MakeProgram((mk) => {
				mk.rule(writeOne);
				mk.rule(writeTwo);
			});

			const result = await make.update();
			expect(result).to.be.true;
			expect(writeOne.buildCount).to.equal(1);
			expect(writeTwo.buildCount).to.equal(0);
		});

		it('fails when no targets exist for a default goal', async () => {
			const make = new MakeProgram(() => {});
			const result = await make.update();
			expect(result).to.be.false;
			expect(logs.find(LogLevel.error, /No target/i)).not.to.be.null;
		});

		it('does not update first target when another is specified', async () => {
			const pOne = 'one.txt';
			const pTwo = 'two.txt';
			const writeOne = new WriteFileRule(pOne, 'one');
			const writeTwo = new WriteFileRule(pTwo, 'two');

			const make = new MakeProgram((mk) => {
				mk.rule(writeOne);
				mk.rule(writeTwo);
			});

			const result = await make.update(pTwo);
			expect(result).to.be.true;
			expect(writeOne.buildCount).to.equal(0);
			expect(writeTwo.buildCount).to.equal(1);
		});

		it('fails when explicit goal does not exist as a target', async () => {
			const make = new MakeProgram((mk) => {
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

			const make = new MakeProgram((mk) => {
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

			const make = new MakeProgram((mk) => {
				mk.rule('all', prereq, async () => {
					contents = await readPath(prereq);
				});
			});

			await make.update();
			expect(contents).to.equal('prereq');
		});

		it('updates a phony target without a recipe', async () => {
			const make = new MakeProgram((mk) => {
				mk.rule('all');
			});

			const result = await make.update();
			expect(result).to.be.true;
		});

		it('updates a phony target without a recipe with prereqs', async () => {
			const make = new MakeProgram((mk) => {
				const srcPath = 'src.txt';

				mk.rule('all', srcPath);

				const write = new WriteFileRule(srcPath, 'hello');
				mk.rule(write);
			});

			const result = await make.update();
			expect(result).to.be.true;
		});

		it("fails if a src prereq doesn't exist", async () => {
			const make = new MakeProgram((mk) => {
				mk.rule('all', 'prereq');
			});
			const result = await make.update();
			expect(result).to.be.false;
		});

		it("fails if a build prereq doesn't have a recipe", async () => {
			const make = new MakeProgram((mk) => {
				mk.rule('all', 'prereq');
			});
			const result = await make.update();
			expect(result).to.be.false;
		});

		it('succeeds if a build prereq does have a recipe that succeeds', async () => {
			const make = new MakeProgram((mk) => {
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

			const make = new MakeProgram((mk) => {
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

			const make = new MakeProgram((mk) => {
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

			const make = new MakeProgram((mk) => {
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
			const make = new MakeProgram((mk) => {
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

			const make = new MakeProgram((mk) => {
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

			const make = new MakeProgram((mk) => {
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

			const make = new MakeProgram((mk) => {
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

			const make = new MakeProgram((mk) => {
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

			const make = new MakeProgram((mk) => {
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

			const make = new MakeProgram((mk) => {
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

			const make = new MakeProgram((mk) => {
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

			const make = new MakeProgram((mk) => {
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
			const make = new MakeProgram((mk) => {
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
			const make = new MakeProgram((mk) => {
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

				const make = new MakeProgram((mk) => {
					mk.include('nested.mk', (mk) => {
						mk.rule(nested, () => {});
					});
				});

				expect(
					await make.hasTarget(nested),
					'expected program to contain nested target',
				).to.be.true;
			});

			it('throws when Makefile target already has recipe', async () => {
				let expectationsRan = false;
				const make = new MakeProgram((mk) => {
					const p = 'include.mk';
					mk.rule(p, () => {}); // add recipe
					expect(() => {
						mk.include(p, () => {});
					}).to.throw(/has a recipe/);
					expectationsRan = true;
				});
				await make.parse();

				expect(expectationsRan, 'Did not evaluate expectation').to.be.true;
			});

			it('throws when recipe is added to a Makefile target', async () => {
				let expectationsRan = false;
				const make = new MakeProgram((mk) => {
					const p = 'include.mk';
					mk.include(p, () => {});
					expect(() => {
						mk.rule(p, () => {}); // add recipe
					}).to.throw(/[Cc]annot add a recipe to/);
					expectationsRan = true;
				});
				await make.parse();

				expect(expectationsRan, 'Did not evaluate expectation').to.be.true;
			});

			it('updates prereqs prior to executing included mk function', async () => {
				const nested = 'nested-target';

				const make = new MakeProgram((mk) => {
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
					await make.hasTarget(nested),
					'expected program to contain nested target',
				).to.be.true;
			});

			it('fails to parse when a nested Makefile cannot be updated', async () => {
				const nested = 'nested-target';

				const make = new MakeProgram((mk) => {
					const nestedMk = 'nested.mk';
					const prereq = 'prereq';

					mk.include(nestedMk, (mk) => {
						mk.rule(nested, () => {});
					});

					mk.rule(nestedMk, [prereq]);
					mk.rule(prereq, () => false);
				});

				const result = await make.parse();
				expect(result).to.be.false;
				expect(logs.find(LogLevel.error, /nested\.mk/)).not.to.be.null;
			});

			it('fails to parse when nested MakefileFn throws', async () => {
				const make = new MakeProgram((mk) => {
					const nestedMk = 'nested.mk';

					mk.include(nestedMk, () => {
						throw new Error('hehe');
					});
				});

				const result = await make.parse();
				expect(result).to.be.false;
				expect(logs.findEvents(EVENT_MAKEFILE_EXCEPTION)).not.to.be.empty;
			});

			it('fails to parse when nested MakefileFn returns false', async () => {
				const make = new MakeProgram((mk) => {
					const nestedMk = 'nested.mk';

					mk.include(nestedMk, () => {
						return false;
					});
				});

				const result = await make.parse();
				expect(result).to.be.false;
				expect(logs.find(LogLevel.error, /Makefile .* returned false/)).not.to
					.be.empty;
			});
		});

		it('warns if a target is stale and has no recipe to update', async () => {
			const stale = 'stale';
			const src = 'src';

			await writePath(stale, 'stale');
			await waitMs(1);
			await writePath(src, 'src');

			const make = new MakeProgram((mk) => {
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

			const make = new MakeProgram((mk) => {
				mk.rule('phony', src);
			});

			const result = await make.update('phony');
			expect(result).to.be.true;

			const evts = logs.findEvents(EVENT_TARGET_STALE_NO_RECIPE);
			expect(evts).to.be.empty;
		});

		it('is an error when the __esmakefile__ dir is not created', async () => {
			const make = new MakeProgram((mk) => {
				mk.rule('simple', () => {});
			});

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
			const make = new MakeProgram((mk) => {
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
