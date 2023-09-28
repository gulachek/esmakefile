import {
	Path,
	IBuildPath,
	IRule,
	BuildPathGenOpts,
	PathLike,
	RecipeArgs,
	Cookbook,
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
		const { targets } = args.paths<ScssRecipe>();
		const src = args.abs(this._srcPath);

		args.logStream.write(`sass ${this._srcPath}`, 'utf8');
		const result = sass.compile(src);

		// update dependencies
		for (const url of result.loadedUrls) {
			args.addSrc(url.pathname);
		}

		await writeFile(targets, result.css, 'utf8');
		return true;
	}
}

export function addSass(
	book: Cookbook,
	src: PathLike,
	genOpts: BuildPathGenOpts,
) {
	book.add(new ScssRecipe(src, genOpts));
}
