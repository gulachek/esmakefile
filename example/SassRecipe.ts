import { IRule, RecipeArgs, Makefile, getLogger } from '../index.js';

import * as sass from 'sass';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

class ScssRecipe implements IRule {
	_srcPath: string;
	_destPath: string;

	constructor(src: string, destPath: string) {
		this._srcPath = src;
		this._destPath = destPath;
	}

	prereqs() {
		return this._srcPath;
	}

	targets() {
		return this._destPath;
	}

	async recipe(args: RecipeArgs) {
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

export function addSass(mk: Makefile, src: string, dest: string) {
	mk.rule(new ScssRecipe(src, dest));
}
