import { MakeDatabase, TargetInfo } from './MakeDatabase.js';
import { Makefile, MakefileFn } from './Makefile.js';
import { Mutex } from './Mutex.js';
import { UpdateExecution } from './UpdateExecution.js';
import { getLogger, Logger } from './logs.js';
import { EVENT_MAKEFILE_EXCEPTION } from './names.js';

export interface IMakeProgramParseOpts {
	rootDir?: string;
}

export class MakeProgram {
	private db: MakeDatabase;
	private mtx: Mutex;
	private logger: Logger;

	private constructor(db: MakeDatabase) {
		this.db = db;
		this.mtx = new Mutex();
		this.logger = getLogger({ name: 'esmakefile.MakeProgram' });
	}

	static async parse(
		makeFn: MakefileFn,
		opts?: IMakeProgramParseOpts,
	): Promise<MakeProgram | null> {
		const logger = getLogger({ name: 'esmakefile.MakeProgram.parse' });
		logger.trace('Makefile.parse');

		opts = opts || {};
		const db = new MakeDatabase();
		const make = new MakeProgram(db);

		db.insertMakefile('Makefile', makeFn);

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
				...opts,
				db,
				path: pathInfo,
			};

			logger.debug(`Parsing Makefile '${path}'`);
			const mk = new Makefile(mkOpts);
			try {
				const result = await fn(mk);
				if (result === false) {
					logger.error(
						`Function '${fn.name}' for Makefile '${path}' returned false`,
					);
					return null;
				}
			} catch (exception) {
				logger.error({
					eventName: EVENT_MAKEFILE_EXCEPTION,
					exception,
					body: `Function '${fn.name}' for Makefile '${path}' threw exception`,
				});
				return null;
			}

			db.updateMakefile({ path: pathInfo, isParsed: true });

			mkInfo = db.selectMakefileFirstUnparsed();
		}

		return make;
	}

	async update(goal?: string): Promise<boolean> {
		await using _ = await this.mtx.lockAsync();
		let goalInfo: TargetInfo;
		if (goal) {
			const givenInfo = this.db.selectTargetByRawPath(goal);
			if (!givenInfo) {
				this.logger.error(`Makefile has no target defined for goal '${goal}'.`);
				return false;
			}
			goalInfo = givenInfo;
		} else {
			const defaultInfo = defaultGoal(this.db);
			if (!defaultInfo) {
				this.logger.error('No targets were found. Nothing to update.');
				return false;
			}
			goalInfo = defaultInfo;
		}

		const build = new UpdateExecution(this.db);
		// important to not simply return build.run() promise as it would unlock mtx too early
		const result = await build.run(goalInfo);
		return result;
	}

	targets(): string[] {
		const out: string[] = [];
		for (const t of this.db.selectTargets()) {
			const pathInfo = t.path;
			out.push(pathInfo.path);
		}
		return out;
	}

	hasTarget(t: string): boolean {
		return !!this.db.selectTargetByRawPath(t);
	}
}

function defaultGoal(db: MakeDatabase): TargetInfo | null {
	for (const rule of db.selectRules()) {
		for (const t of rule.targets) return t;
	}

	return null;
}
