const { Path, BuildPath, cli } = require('gulpachek');
const sass = require('sass');
const fs = require('node:fs');
const path = require('node:path');

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
		console.log(`sass ${this._srcPath}`);
		const result = sass.compile(args.sources);
		fs.writeFileSync(args.targets, result.css);
		return Promise.resolve(true);
	}
}

function addSass(book, src, genOpts) {
	book.add(new ScssRecipe(src, genOpts));
}

// make.js

cli((book) => {
	addSass(book, 'src/style.scss');
});
