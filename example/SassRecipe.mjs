/** @import {IRule, RecipeArgs, Makefile} from 'esmakefile' */
import { getLogger } from 'esmakefile';

import * as sass from 'sass';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** @implements {IRule} */
class ScssRecipe {
	/**
	 * @param {string} src
	 * @param {string} destPath
	 */
	constructor(src, destPath) {
		/** @private @type {string} */
		this._srcPath = src;
		/** @private @type {string} */
		this._destPath = destPath;
	}

	prereqs() {
		return this._srcPath;
	}

	targets() {
		return this._destPath;
	}

	/** @param {RecipeArgs} args */
	async recipe(args) {
		const log = getLogger({ name: 'esmakefile.example.ScssRecipe' });
		const dest = resolve(args.rootDir, this._destPath);
		const src = resolve(args.rootDir, this._srcPath);

		log.info(`sass ${this._srcPath}`);
		const result = sass.compile(src);

		// update dependencies
		for (const url of result.loadedUrls) {
			args.addPostreq(url.pathname);
		}

		await writeFile(dest, result.css, 'utf8');
		return true;
	}
}

/**
 * @param {Makefile} mk
 * @param {string} src
 * @param {string} dest
 * @returns {void}
 */
export function addSass(mk, src, dest) {
	mk.rule(new ScssRecipe(src, dest));
}
