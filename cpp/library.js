const { StaticPath } = require('../lib/pathTargets');
const { CppObjectGroup } = require('./objectGroup');
const { InstallLibroot } = require('./libroot');

class CppLibrary extends StaticPath {
	#name;
	#version;
	#objects;
	#includes;
	#libs;
	#toolchain;

	constructor(sys, args) {
		const nameUnder = args.name.replaceAll('.', '_');
		const fname = `lib${nameUnder}.${args.version}.${args.toolchain.archiveExt}`;
		super(sys, sys.dest(fname));
		this.#name = args.name;
		this.#version = args.version;
		this.#toolchain = args.toolchain;
		this.#objects = new CppObjectGroup(sys, {
			toolchain: args.toolchain
        });
		this.#includes = [];
		this.#libs = [];
	}

	name() { return this.#name; }
	version() { return this.#version; }

	#headerOnly() { return this.#objects.length < 1; }

	libroot() {
		return new InstallLibroot(this.sys(), {
			name: this.#name,
			version: this.#version,
			includes: this.#includes,
			binaries: this.#headerOnly() ? [] : [this],
			deps: this.#libs
		});
	}

	add_src(src) {
		this.#objects.add_src(src);
	}

	link(lib) {
		this.#libs.push(lib);
		this.#objects.link(lib);
	}

	include(dir) {
		const dirpath = this.sys().src(dir);

		this.#includes.push(dirpath);
		this.#objects.include(dirpath);
	}

	includes() {
		const incs = [...this.#includes];

		for (const lib of this.#libs) {
			for (const inc of lib.includes()) {
				incs.push(inc);
			}
		}

		return incs;
	}

	binaries() {
		const bins = [];

		if (!this.#headerOnly()) {
			bins.push(this);
		}

		for (const lib of this.#libs) {
			for (const bin of lib.binaries()) {
				bins.push(bin);
			}
		}

		return bins;
	}

	deps() {
		return this.#objects;
	}

	build(cb) {
		if (this.#headerOnly()) {
			return Promise.resolve();
		}

		console.log(`archiving ${this.path()}`);

		const args = {
			gulpCallback: cb,
			outputPath: this.abs(),
			objects: []
		};

		for (const obj of this.#objects) {
			args.objects.push(obj.abs());
		}

		return this.#toolchain.archive(args);
	}
}

module.exports = { CppLibrary };
