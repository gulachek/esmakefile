import { Target, ErrorFirstCallback } from './target';
import { Path } from './path';

import * as fs from 'fs';

// Pretend this is out of date if its previous hash value isn't the same
export class ParamsFile extends Target
{
	#hash: Buffer;

	constructor(t: Target, basename: string, hash: Buffer)
	{
		const path = new Path(['__params__', ...t.path.components, basename], t.path.type);

		super(t.sys, path);

		this.#hash = hash;
	}

	override recipe(cb: ErrorFirstCallback)
	{
		return fs.writeFile(this.abs, this.#hash, cb);
	}

	override mtime()
	{
		const superMtime = super.mtime();

		if (superMtime === null)
			return null;

		const prevHash = fs.readFileSync(this.abs);
		if (this.#hash.equals(prevHash))
			return superMtime;

		return null;
	}
}
