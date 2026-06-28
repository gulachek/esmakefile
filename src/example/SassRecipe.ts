import {
	Path,
	IRule,
	PathLike,
	RecipeArgs,
	Makefile,
	getLogger,
} from '../index.js';

import * as sass from 'sass';
import { writeFile } from 'node:fs/promises';

class ScssRecipe implements IRule {
	_srcPath: Path;
	_destPath: Path;

	constructor(src: PathLike, destPath: string) {
		this._srcPath = Path.src(src);
		this._destPath = Path.build(destPath);
	}

	prereqs() {
		return this._srcPath;
	}

	targets() {
		return this._destPath;
	}

	async recipe(args: RecipeArgs) {
		const log = getLogger({ name: 'esmakefile.example.ScssRecipe' });
		const [src, dest] = args.absAll(this._srcPath, this._destPath);

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

export function addSass(mk: Makefile, src: PathLike, dest: string) {
	mk.rule(new ScssRecipe(src, dest));
}
