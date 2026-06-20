import { resolve } from 'node:path';
import { IBuildPath } from './Path.js';

export interface IMakeDatabaseOpts {
	srcRoot?: string;
	buildRoot?: string;
}

export type MakefileInfo = {
	path: IBuildPath;
	isParsed: boolean;
};

export type RowID = number;

export class MakeDatabase {
	readonly srcRoot: string;
	readonly buildRoot: string;

	private _makefiles = new Map<string, MakefileInfo>();

	constructor(opts: IMakeDatabaseOpts) {
		this.srcRoot = resolve(opts.srcRoot || '.');
		this.buildRoot = resolve(opts.buildRoot || 'build');
	}

	insertMakefile(path: IBuildPath): MakefileInfo {
		const rel = path.rel();
		if (this._makefiles.has(rel)) {
			throw new Error(`Makefile '${rel}' is already registered`);
		}

		const info: MakefileInfo = {
			path,
			isParsed: false,
		};

		this._makefiles.set(rel, info);
		return info;
	}

	selectMakefile(path: IBuildPath): MakefileInfo | null {
		const info = this._makefiles.get(path.rel());
		if (info) return { ...info };
		return null;
	}

	updateMakefile(info: MakefileInfo): void {
		const rel = info.path.rel();
		const stored = this._makefiles.get(rel);
		if (!stored) {
			throw new Error(`Makefile '${rel}' not found`);
		}

		Object.assign(stored, info);
	}
}
