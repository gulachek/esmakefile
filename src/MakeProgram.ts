import { Makefile, MakefileFn, IMakefileOpts } from './Makefile.js';
import { BuildPathLike } from './Path.js';
import { UpdateExecution } from './UpdateExecution.js';

export class MakeProgram {
	private mk: Makefile;

	private constructor(mk: Makefile) {
		this.mk = mk;
	}

	static async parse(
		makeFn: MakefileFn,
		opts?: IMakefileOpts,
	): Promise<MakeProgram> {
		const mk = new Makefile(opts);
		await makeFn(mk);
		return new MakeProgram(mk);
	}

	update(goal?: BuildPathLike): Promise<boolean> {
		const build = new UpdateExecution(this.mk, goal);
		return build.run();
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
}
