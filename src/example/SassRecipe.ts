import {
	Path,
	IBuildPath,
	IRecipe,
	BuildPathGenOpts,
	PathLike,
	RecipeBuildArgs,
	Cookbook,
} from '../index.js';

import { isBuildPathLike } from '../Path.js';

import sass from 'sass';
import { writeFile } from 'node:fs/promises';

class ScssRecipe implements IRecipe {
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

	sources() {
		return this._srcPath;
	}

	targets() {
		return this._destPath;
	}

	async buildAsync(args: RecipeBuildArgs) {
		const { sources, targets } = args.paths<ScssRecipe>();
		console.log(`sass ${this._srcPath}`);
		const result = sass.compile(sources);

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
