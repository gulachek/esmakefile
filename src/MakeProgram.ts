import { MakeDatabase, TargetInfo } from './MakeDatabase.js';
import { Makefile, MakefileFn } from './Makefile.js';
import { Mutex } from './Mutex.js';
import { UpdateExecution } from './UpdateExecution.js';
import { getLogger, Logger } from './logs.js';
import { EVENT_MAKEFILE_EXCEPTION } from './names.js';

export interface IMakeProgramOpts {
	path?: string;
}

export class MakeProgram {
	private mtx: Mutex;
	private logger: Logger;
	private fn: MakefileFn;
	private path: string;

	constructor(makeFn: MakefileFn, opts?: IMakeProgramOpts) {
		opts = opts || {};
		this.mtx = new Mutex();
		this.logger = getLogger({ name: 'esmakefile.MakeProgram' });
		this.fn = makeFn;
		this.path = opts.path || 'Makefile';
	}

	private async loadDb(): Promise<MakeDatabase | null> {
		const db = new MakeDatabase();

		db.insertMakefile(this.path, this.fn);

		let mkInfo = db.selectMakefileFirstUnparsed();
		while (mkInfo) {
			const fn = mkInfo.fn;
			const pathInfo = mkInfo.path;
			const { path } = pathInfo;

			const target = db.selectTargetByPath(pathInfo);
			if (target) {
				const u = new UpdateExecution(db);
				const updateResult = await u.run(target);
				if (!updateResult) {
					// Already logged failure in UpdateExecution
					return null;
				}
			}

			const mkOpts = {
				db,
				path: pathInfo,
			};

			this.logger.debug(`Parsing Makefile '${path}'`);
			const mk = new Makefile(mkOpts);
			try {
				const result = await fn(mk);
				if (result === false) {
					this.logger.error(
						`Function '${fn.name}' for Makefile '${path}' returned false`,
					);
					return null;
				}
			} catch (exception) {
				this.logger.error({
					eventName: EVENT_MAKEFILE_EXCEPTION,
					exception,
					body: `Function '${fn.name}' for Makefile '${path}' threw exception`,
				});
				return null;
			}

			db.updateMakefile({ path: pathInfo, isParsed: true });

			mkInfo = db.selectMakefileFirstUnparsed();
		}

		return db;
	}

	static async parse(
		makeFn: MakefileFn,
		opts?: IMakeProgramOpts,
	): Promise<MakeProgram | null> {
		const logger = getLogger({ name: 'esmakefile.MakeProgram.parse' });
		logger.trace('Makefile.parse');

		const make = new MakeProgram(makeFn, opts);
		const result = await make.parse();
		return result ? make : null;
	}

	async parse(): Promise<boolean> {
		const db = await this.loadDb();
		return !!db;
	}

	async update(goal?: string): Promise<boolean> {
		await using _ = await this.mtx.lockAsync();
		const db = await this.loadDb();
		if (!db) return false;
		let goalInfo: TargetInfo;
		if (goal) {
			const givenInfo = db.selectTargetByRawPath(goal);
			if (!givenInfo) {
				this.logger.error(`Makefile has no target defined for goal '${goal}'.`);
				return false;
			}
			goalInfo = givenInfo;
		} else {
			const defaultInfo = defaultGoal(db);
			if (!defaultInfo) {
				this.logger.error('No targets were found. Nothing to update.');
				return false;
			}
			goalInfo = defaultInfo;
		}

		const build = new UpdateExecution(db);
		// important to not simply return build.run() promise as it would unlock mtx too early
		const result = await build.run(goalInfo);
		return result;
	}

	async targets(): Promise<string[]> {
		const db = await this.loadDb();
		if (!db) return [];

		const out: string[] = [];
		for (const t of db.selectTargets()) {
			const pathInfo = t.path;
			out.push(pathInfo.path);
		}
		return out;
	}

	async hasTarget(t: string): Promise<boolean> {
		const db = await this.loadDb();
		if (!db) return false;
		return !!db.selectTargetByRawPath(t);
	}
}

function defaultGoal(db: MakeDatabase): TargetInfo | null {
	for (const rule of db.selectRules()) {
		for (const t of rule.targets) return t;
	}

	return null;
}
