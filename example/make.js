const { Path, BuildPath, cli } = require('gulpachek');
const sass = require('sass');
const fs = require('node:fs');

// ScssTarget.js

/**
 * @implements require('gulpachek').IRecipe<ScssRecipe>
 */
class ScssRecipe {
	_srcPath;
	_destPath;

	constructor(src, genOpts) {
		this._srcPath = Path.src(src);
		this._destPath = BuildPath.gen(this._srcPath, { ext: '.css', ...genOpts });
	}

	sources() {
		return this._srcPath;
	}

	targets() {
		return this._destPath;
	}

	buildAsync(args) {
		const { sources, targets } = args.paths();
		console.log(`sass ${this._srcPath}`);
		const result = sass.compile(sources);

		// update dependencies
		for (const url of result.loadedUrls) {
			args.addSrc(url.pathname);
		}

		fs.writeFileSync(targets, result.css);
		return Promise.resolve(true);
	}
}

function addSass(book, src, genOpts) {
	book.add(new ScssRecipe(src, genOpts));
}

// make.js

cli((book) => {
	const scssFile = Path.src('src/style.scss');
	addSass(book, scssFile);
});
