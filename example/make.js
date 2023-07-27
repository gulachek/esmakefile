const { Path, BuildPath, cli } = require('gulpachek');
const sass = require('sass');
const fs = require('node:fs');

// WriteFile.js
class WriteFileRecipe {
	_destPath;
	_bytes;

	constructor(dst, bytes) {
		this._destPath = BuildPath.from(dst);
		this._bytes = bytes;
	}

	targets() {
		return this._destPath;
	}

	buildAsync(args) {
		console.log(`Generating ${this._destPath}`);
		fs.writeFileSync(args.targets, this._bytes, 'utf8');
		return Promise.resolve(true);
	}
}

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
	const scssFile = BuildPath.from('style.scss');
	const writeFile = new WriteFileRecipe(
		scssFile,
		`
		.foo {
			.bar {
				background-color: red;
			}
		}`,
	);
	book.add(writeFile);

	addSass(book, scssFile);
});
