import { Target, ErrorFirstCallback } from './buildSystem';
import { Path, PathLike } from './path';

import * as fs from 'fs';
import * as os from 'os';
import { spawn } from 'child_process';

class CopyFile extends Target
{
	#from: Target;

	constructor(from: Target, to: PathLike)
	{
		let dest = Path.dest(to);
		if (!dest.extname)
		{
			dest = dest.join(from.path.basename);
		}

		super(from.sys, dest);
		this.#from = from;
	}

	deps()
	{
		return this.#from;
	}

	build(cb: ErrorFirstCallback)
	{
		return fs.copyFile(this.#from.abs, this.abs, cb);
	}
}

export function copyFile(from: Target, to: PathLike): Target
{
	return new CopyFile(from, to);
}

class CopyDir extends Target
{
	#from: Target;

	constructor(from: Target, to: PathLike)
	{
		super(from.sys, Path.dest(to).join(from.path.basename));
		this.#from = from;
	}

	deps()
	{
		return this.#from;
	}

	build()
	{
		if (os.platform() === 'win32') {
			return spawn('xcopy', ['/EIQHY', this.#from.abs, this.abs]);
		} else {
			const dir = this.sys.abs(this.path.dir);
			return spawn('cp', ['-R', this.#from.abs, dir]);
		}
	}
}

export function copyDir(from: Target, to: PathLike): Target
{
	return new CopyDir(from, to);
}
