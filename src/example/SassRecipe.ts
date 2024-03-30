import {
	Path,
	IBuildPath,
	IRule,
	BuildPathGenOpts,
	PathLike,
	RecipeArgs,
	Makefile,
} from '../index.js';

import { isBuildPathLike } from '../Path.js';

import * as sass from 'sass';
import { writeFile } from 'node:fs/promises';

class ScssRecipe implements IRule {
	_srcPath: Path;
	_destPath: IBuildPath;

	constructor(src: PathLike, genOpts: BuildPathGenOpts) {
		this._srcPath = Path.src(src);

		if (isBuildPathLike(genOpts)) {
			this._destPath = Path.build(genOpts);
		} else {
			this._destPath = Path.gen(this._srcPath, {
				ext: '.css',
				...genOpts,
			});
		}
	}

	prereqs() {
		return this._srcPath;
	}

	targets() {
		return this._destPath;
	}

	async recipe(args: RecipeArgs) {
		const [src, dest] = args.absAll(this._srcPath, this._destPath);

		args.logStream.write(`sass ${this._srcPath}`, 'utf8');
		const result = sass.compile(src);

		// update dependencies
		for (const url of result.loadedUrls) {
			args.addPostreq(url.pathname);
		}

		await writeFile(dest, result.css, 'utf8');
		return true;
	}
}

export function addSass(
	make: Makefile,
	src: PathLike,
	genOpts: BuildPathGenOpts,
) {
	make.add(new ScssRecipe(src, genOpts));
}
