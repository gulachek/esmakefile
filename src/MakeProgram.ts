import { MakeDatabase } from './MakeDatabase.js';
import { Makefile, MakefileFn } from './Makefile.js';
import { Mutex } from './Mutex.js';
import { BuildPathLike, Path } from './Path.js';
import { UpdateExecution } from './UpdateExecution.js';

export interface IMakeProgramParseOpts {
	srcRoot?: string;
	buildRoot?: string;
}

export class MakeProgram {
	private mk: Makefile;
	private mtx: Mutex;

	private constructor(mk: Makefile) {
		this.mk = mk;
		this.mtx = new Mutex();
	}

	static async parse(
		makeFn: MakefileFn,
		opts?: IMakeProgramParseOpts,
	): Promise<MakeProgram> {
		const db = new MakeDatabase({});
		const mainMk = Path.build('Makefile');

		// Create and parse root Makefile
		const mkOpts = {
			...opts,
			db,
			path: mainMk,
		};
		const mk = new Makefile(mkOpts);
		await makeFn(mk);
		db.updateMakefile({ path: mainMk, isParsed: true });

		// while (unparsed includes) {
		//   for (const mk of includes) {
		//     update(mk);
		//     parse(mk);
		//   }
		// }

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
