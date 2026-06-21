import { MakeDatabase } from './MakeDatabase.js';
import { Makefile, MakefileFn } from './Makefile.js';
import { Mutex } from './Mutex.js';
import { BuildPathLike, Path, IBuildPath } from './Path.js';
import { UpdateExecution } from './UpdateExecution.js';

export interface IMakeProgramParseOpts {
	srcRoot?: string;
	buildRoot?: string;
}

export class MakeProgram {
	private mk: Makefile;
	private db: MakeDatabase;
	private mtx: Mutex;

	private constructor(mk: Makefile, db: MakeDatabase) {
		this.mk = mk;
		this.db = db;
		this.mtx = new Mutex();
	}

	static async parse(
		makeFn: MakefileFn,
		opts?: IMakeProgramParseOpts,
	): Promise<MakeProgram> {
		opts = opts || {};
		const db = new MakeDatabase({
			buildRoot: opts.buildRoot,
			srcRoot: opts.srcRoot,
		});
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

		return new MakeProgram(mk, db);
	}

	async update(goal?: BuildPathLike): Promise<boolean> {
		await using _ = await this.mtx.lockAsync();
		const goalPath = (goal && Path.build(goal)) || defaultGoal(this.db);
		const build = new UpdateExecution(this.mk, this.db);
		// important to not simply return build.run() promise as it would unlock mtx too early
		const result = await build.run(goalPath);
		return result;
	}

	get srcRoot(): string {
		return this.db.srcRoot;
	}

	get buildRoot(): string {
		return this.db.buildRoot;
	}

	targets(): string[] {
		return this.mk.targets();
	}

	hasTarget(t: BuildPathLike): boolean {
		return this.mk.hasTarget(t);
	}
}

function defaultGoal(db: MakeDatabase): IBuildPath {
	for (const rule of db.selectRules()) {
		for (const t of rule.targets) return t;
	}

	throw new Error('No targets exist to select a default goal');
}
