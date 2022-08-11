const { StaticPath } = require('../lib/pathTargets');
const { CppDepfile } = require('./depfile');
const { mergeDefs } = require('./mergeDefs');

class CppObject extends StaticPath {
	#src;
	#includes;
	#libs;
	#depfile;
	#cpp;
	#defs;

	constructor(cpp, args) {
		const sys = cpp.sys();
		const src = sys.src(args.src);
		super(sys, sys.cache(src.path(), {
			namespace: 'com.gulachek.cpp.obj',
			ext: cpp.toolchain().objectExt
		}));
		this.#src = src;
		this.#includes = [];
		this.#libs = [];
		this.#cpp = cpp;
		this.#defs = {};

		this.#depfile = new CppDepfile(cpp, {
			path: sys.cache(src.path(), {
				namespace: 'com.gulachek.cpp.obj',
				ext: 'd'
			}),
		});
	}

	define(defs) {
		Object.assign(this.#defs, defs);
	}

	include(dir) {
		this.#includes.push(this.sys().src(dir));
	}

	link(lib) {
		const order = [98, 3, 11, 14, 17, 20];
		const libIndex = order.indexOf(lib.cppVersion());

		if (libIndex === -1) {
			throw new Error(`'${lib.name()}' has an invalid c++ version ${lib.cppVersion()}`);
		}

		if (order.indexOf(this.#cpp.cppVersion()) < libIndex) {
			throw new Error(`'${lib.name()}' uses a newer version of c++ than ${this.#src}`);
		}

		this.#libs.push(lib);
	}

	deps() {
		return [this.#src, ...this.#includes, this.#depfile];
	}

	build(cb) {
		console.log(`compiling ${this.path()}`);

		const args = {
			gulpCallback: cb,
			cppVersion: this.#cpp.cppVersion(),
			depfilePath: this.#depfile.abs(),
			outputPath: this.abs(),
			srcPath: this.#src.abs(),
			isDebug: this.sys().isDebugBuild(),
			includes: []
		};

		for (const i of this.#includes) {
			args.includes.push(i.abs());
		}

		const defs = {};
		if (this.sys().isDebugBuild()) {
			defs.DEBUG = 1;
		} else {
			defs.NDEBUG = 1;
		}

		for (const lib of this.#libs) {
			for (const i of lib.includes()) {
				args.includes.push(i.abs());
			}

			mergeDefs(defs, lib.definitions());
		}

		mergeDefs(defs, this.#defs);
		args.definitions = defs;

		return this.#cpp.toolchain().compile(args);
	}
}

module.exports = { CppObject };