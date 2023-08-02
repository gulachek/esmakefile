import {
	Path,
	BuildPath,
	IRecipe,
	BuildPathGenOpts,
	PathLike,
	RecipeBuildArgs,
	Cookbook,
} from '..';
import sass from 'sass';
import { writeFile } from 'node:fs/promises';
import { isBuildPathLike } from '../Path';

class ScssRecipe implements IRecipe {
	_srcPath: Path;
	_destPath: BuildPath;

	constructor(src: PathLike, genOpts: BuildPathGenOpts) {
		this._srcPath = Path.src(src);

		if (isBuildPathLike(genOpts)) {
			this._destPath = BuildPath.from(genOpts);
		} else {
			this._destPath = BuildPath.gen(this._srcPath, {
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
