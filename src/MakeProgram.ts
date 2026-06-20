import { Makefile, MakefileFn, IMakefileOpts } from './Makefile.js';
import { BuildPathLike } from './Path.js';
import { Mutex } from './Mutex.js';
import { UpdateExecution } from './UpdateExecution.js';

export class MakeProgram {
	private mk: Makefile;
	private mtx: Mutex;

	private constructor(mk: Makefile) {
		this.mk = mk;
		this.mtx = new Mutex();
	}

	static async parse(
		makeFn: MakefileFn,
		opts?: IMakefileOpts,
	): Promise<MakeProgram> {
		const mk = new Makefile(opts || {});
		await makeFn(mk);
		return new MakeProgram(mk);
	}

	async update(goal?: BuildPathLike): Promise<boolean> {
		await using _ = await this.mtx.lockAsync();
		const build = new UpdateExecution(this.mk, goal);
		// important to not simply return build.run() promise as it would unlock mtx too early
		const result = await build.run();
		return result;
	}

	get srcRoot(): string {
		return this.mk.srcRoot;
	}

	get buildRoot(): string {
		return this.mk.buildRoot;
	}

	targets(): string[] {
		return this.mk.targets();
	}

	hasTarget(t: BuildPathLike): boolean {
		return this.mk.hasTarget(t);
	}
}
