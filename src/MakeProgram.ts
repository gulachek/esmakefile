import { MakeDatabase } from './MakeDatabase.js';
import { Makefile, MakefileFn } from './Makefile.js';
import { Mutex } from './Mutex.js';
import { BuildPathLike, Path, IBuildPath } from './Path.js';
import { UpdateExecution } from './UpdateExecution.js';
import { getLogger } from './logs.js';
import { EVENT_MAKEFILE_EXCEPTION } from './names.js';

export interface IMakeProgramParseOpts {
	srcRoot?: string;
	buildRoot?: string;
}

export class MakeProgram {
	private db: MakeDatabase;
	private mtx: Mutex;

	private constructor(db: MakeDatabase) {
		this.db = db;
		this.mtx = new Mutex();
	}

	static async parse(
		makeFn: MakefileFn,
		opts?: IMakeProgramParseOpts,
	): Promise<MakeProgram | null> {
		const logger = getLogger({ name: 'esmakefile.MakeProgram.parse' });
		logger.trace('Makefile.parse');

		opts = opts || {};
		const db = new MakeDatabase({
			buildRoot: opts.buildRoot,
			srcRoot: opts.srcRoot,
		});
		const make = new MakeProgram(db);

		const mainMk = Path.build('Makefile');
		db.insertMakefile(mainMk, makeFn);

		let mkInfo = db.selectMakefileFirstUnparsed();
		while (mkInfo) {
			const { path, fn } = mkInfo;
			const mkOpts = {
				...opts,
				db,
				path,
			};

			const rel = path.rel();

			if (make.hasTarget(path)) {
				const updateResult = await make.update(path);
				if (!updateResult) {
					// Already logged failure in UpdateExecution
					return null;
				}
			}

			logger.debug(`Parsing Makefile '${rel}'`);
			const mk = new Makefile(mkOpts);
			try {
				await fn(mk);
			} catch (exception) {
				logger.error({
					eventName: EVENT_MAKEFILE_EXCEPTION,
					exception,
					body: `Makefile '${rel}' threw exception`,
				});
				return null;
			}

			db.updateMakefile({ path, isParsed: true });

			mkInfo = db.selectMakefileFirstUnparsed();
		}

		return make;
	}

	async update(goal?: BuildPathLike): Promise<boolean> {
		await using _ = await this.mtx.lockAsync();
		const goalPath = (goal && Path.build(goal)) || defaultGoal(this.db);
		const build = new UpdateExecution(this.db);
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
		const out: string[] = [];
		for (const t of this.db.selectTargets()) {
			out.push(t.path.rel());
		}
		return out;
	}

	hasTarget(t: BuildPathLike): boolean {
		return !!this.db.selectTarget(Path.build(t));
	}
}

function defaultGoal(db: MakeDatabase): IBuildPath {
	for (const rule of db.selectRules()) {
		for (const t of rule.targets) return t;
	}

	throw new Error('No targets exist to select a default goal');
}
