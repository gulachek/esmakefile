const { Path, cli } = require('gulpachek');
const sass = require('sass');
const fs = require('node:fs');

// ScssTarget.js

/**
 * @implements require('gulpachek').IRecipe<ScssRecipe>
 */
class ScssRecipe {
	_srcPath;
	_destPath;

	constructor(src) {
		this._srcPath = Path.from(src);
		this._destPath = this._srcPath.gen({ ext: 'css' });
	}

	sources() {
		return this._srcPath;
	}

	targets() {
		return this._destPath;
	}

	buildAsync(args) {
		console.log('sass', args.sources);
		const result = sass.compile(args.sources);
		fs.writeFileSync(args.targets, result.css);
		return Promise.resolve(true);
	}
}

// make.js

cli((book) => {
	book.add(new ScssRecipe('src/style.scss'));
});
