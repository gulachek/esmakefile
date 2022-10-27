import { BuildSystem } from './buildSystem';
import { ErrorFirstCallback, Target } from './target';
import { Path, PathLike } from './path';
import { createHash } from 'node:crypto';

import * as fs from 'fs';

class WriteFile extends Target
{
	#data: string | NodeJS.ArrayBufferView;
	#opts: fs.WriteFileOptions | undefined;

	constructor(
		sys: BuildSystem,
		dest: PathLike,
		data: string | NodeJS.ArrayBufferView,
		opts?: fs.WriteFileOptions
	)
	{
		super(sys, Path.dest(dest));
		this.#data = data;
		this.#opts = opts;
	}

	override recipe(cb: ErrorFirstCallback)
	{
		if (this.#opts)
		{
			return fs.writeFile(this.abs, this.#data, this.#opts, cb);
		}
		else
		{
			return fs.writeFile(this.abs, this.#data, cb);
		}
	}

	override params()
	{
		const hash = createHash('md5');
		hash.update(this.#data);
		return hash.digest('hex');
	}
}

export function writeFile(
	sys: BuildSystem,
	dest: PathLike,
	data: string | NodeJS.ArrayBufferView,
	opts?: fs.WriteFileOptions
)
{
	return new WriteFile(sys, dest, data, opts);
}
