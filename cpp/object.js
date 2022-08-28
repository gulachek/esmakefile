const { StaticPath } = require('../lib/pathTargets');
const { CppDepfile } = require('./depfile');

class CppObject extends StaticPath {
	#src;
	#includes;
	#depfile;
	#cpp;
	#defs;

	constructor(cpp, args) {
		const sys = cpp.sys();
		const src = sys.src(args.src);

		const params = { defs: [] };
		for (const kvp of args.defs) {
			params.defs.push(kvp);
		}
		params.includes = args.includes.map(i => i.abs());
		
		super(sys, sys.cache(src.path(), {
			namespace: 'com.gulachek.cpp',
			ext: cpp.toolchain().objectExt,
			params
		}));

		this.#src = src;
		this.#includes = args.includes;
		this.#cpp = cpp;
		this.#defs = args.defs;

		this.#depfile = new CppDepfile(cpp, {
			path: sys.cache(src.path(), {
				namespace: 'com.gulachek.cpp',
				ext: 'd',
				params
			}),
		});
	}

	deps() {
		return [this.#src, ...this.#includes, this.#depfile];
	}

	build(cb) {
		console.log(`compiling ${this.path()}`);
		const toolchain = this.#cpp.toolchain();

		const args = {
			gulpCallback: cb,
			cppVersion: this.#cpp.cppVersion(),
			depfilePath: this.#depfile.abs(),
			outputPath: this.abs(),
			srcPath: this.#src.abs(),
			isDebug: this.sys().isDebugBuild(),
			includes: this.#includes.map(i => i.abs()),
			definitions: this.#defs
		};

		return toolchain.compile(args);
	}
}

module.exports = { CppObject };
