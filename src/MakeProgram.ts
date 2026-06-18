import { Makefile, MakefileFn, IMakefileOpts } from './Makefile.js';
import { BuildPathLike } from './Path.js';
import { Build } from './Build.js';

export class MakeProgram {
	private make: Makefile;

	private constructor(make: Makefile) {
		this.make = make;
	}

	static async parse(
		makeFn: MakefileFn,
		opts?: IMakefileOpts,
	): Promise<MakeProgram> {
		const make = new Makefile(opts);
		await makeFn(make);
		return new MakeProgram(make);
	}

	update(goal?: BuildPathLike): Promise<boolean> {
		const build = new Build(this.make, goal);
		return build.run();
	}

	get srcRoot(): string {
		return this.make.srcRoot;
	}

	get buildRoot(): string {
		return this.make.buildRoot;
	}

	targets(): string[] {
		return this.make.targets();
	}
}
