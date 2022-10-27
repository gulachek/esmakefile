import { Target, ErrorFirstCallback } from './target';

import * as fs from 'fs';

// Pretend this is out of date if its previous hash value isn't the same
export class ParamsFile extends Target
{
	#hash: Buffer;

	constructor(t: Target, hash: Buffer)
	{
		super(t.sys, t.path.gen({
			ext: '_params.hash_'
		}));

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
