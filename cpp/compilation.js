const { CppObject } = require('./object');
const { Target } = require('../lib/target');
const { Library, DepTree } = require('./library');
const { InstallLibroot } = require('./libroot');
const { StaticPath } = require('../lib/pathTargets');
const { mergeDefs } = require('./mergeDefs');

function normalizeDefines(defs) {
	const apiDefs = new Map();
	const implementation = new Map();

	for (const key in defs) {
		const val = defs[key];
		if (['string', 'boolean', 'number'].indexOf(typeof val) !== -1) {
			const strVal = val.toString();
			apiDefs.set(key, strVal);
			implementation.set(key, strVal);
		} else if (typeof val === 'object') {
			if (val.implementation) {
				implementation.set(key, val.implementation.toString());
			}
			if (val.interface) {
				apiDefs.set(key, val.interface.toString());
			}
		}
	}

	return { apiDefs, implementation };
}

class Compilation extends Library {
	#name;
	#version;

	#objects;
	#includes;
	#interfaceDefs;
	#implDefs;
	#libs;
	#cpp;

	constructor(cpp, args) {
		super();
		this.#name = args.name;
		this.#version = args.version;

		this.#cpp = cpp;
		this.#objects = [];
		this.#includes = [];
		this.#libs = [];
		this.#interfaceDefs = new Map();
		this.#implDefs = new Map();

		const srcs = args.src || [];
		for (const src of srcs) {
			this.add_src(src);
		}
	}

	define(defs) {
		const { apiDefs, implementation } = normalizeDefines(defs);
		mergeDefs(this.#interfaceDefs, apiDefs);
		mergeDefs(this.#implDefs, implementation);

		for (const o of this.#objects) {
			o.define(this.#implDefs);
		}
	}

	link(lib) {
		for (const o of this.#objects) {
			o.link(lib);
		}

		this.#libs.push(lib);
	}

	add_src(src) {
		const o = new CppObject(this.#cpp, {
			src: src
		});

		for (const i of this.#includes) {
			o.include(i);
		}

		for (const lib of this.#libs) {
			o.link(lib);
		}

		o.define(this.#implDefs);
		this.#objects.push(o);
	}

	include(dir) {
		const dirpath = this.#cpp.sys().src(dir);

		for (const o of this.#objects) {
			o.include(dirpath);
		}

		this.#includes.push(dirpath);
	}

	libroot() {
		return new InstallLibroot(this.#cpp, {
			name: this.#name,
			version: this.#version,
			includes: this.#includes,
			binaries: this.isHeaderOnly() ? [] : [this.archive()],
			deps: this.#libs,
			defs: this.#interfaceDefs
		});
	}

	// =============================
	// Library Implementation
	// =============================
	name() {
		return this.#name;
	}

	version() {
		return this.#version;
	}

	cppVersion() {
		return this.#cpp.cppVersion();
	}

	includes() {
		return this.#includes;
	}

	definitions() {
		return this.#interfaceDefs;
	}

	isHeaderOnly() {
		return this.#objects.length < 1;
	}

	deps() {
		return this.#libs;
	}

	archive() {
		if (this.isHeaderOnly()) {
			return null;
		}

		const that = this;

		class ArchiveImpl extends StaticPath {
			constructor() {
				const sys = that.#cpp.sys();
				const nameUnder = that.name().replaceAll('.', '_');
				const version = that.version();
				const versionPiece = version ? `${version}.` : '';
				const ext = that.#cpp.toolchain().archiveExt;
				const fname = `lib${nameUnder}.${versionPiece}${ext}`;
				super(sys, sys.dest(fname));
			}

			deps() {
				return that.#objects;
			}

			build(cb) {
				console.log(`archiving ${this.path()}`);

				const args = {
					gulpCallback: cb,
					outputPath: this.abs(),
					objects: []
				};

				for (const obj of that.#objects) {
					args.objects.push(obj.abs());
				}

				return that.#cpp.toolchain().archive(args);
			}
		}

		return new ArchiveImpl();
	}
	// =============================
	// (END) Library Implementation
	// =============================

	executable() {
		const name = this.name();
		const ext = this.#cpp.toolchain().executableExt;
		const out = ext ? `${name}.${ext}` : name;
		return this.#image('executable', out);
	}

	#image(imageType, output) {
		if (this.isHeaderOnly()) {
			throw new Error('Cannot make image with no sources');
		}

		const that = this;

		class ImageImpl extends StaticPath {
			#archives;

			get archives() {
				if (this.#archives) { return this.#archives; }

				const tree = new DepTree(that);
				this.#archives = [];
				for (const lib of tree.backwards()) {
					if (lib === that) { continue; }
					const ar = lib.archive();
					if (ar) {
						this.#archives.push(ar);
					}
				}

				return this.#archives;
			}

			constructor() {
				const cpp = that.#cpp;
				const sys = cpp.sys();
				super(sys, sys.dest(output));
			}

			deps() {
				return [...that.#objects, ...this.archives];
			}

			build(cb) {
				console.log(`linking ${this.path()}`);

				const args = {
					gulpCallback: cb,
					outputPath: this.abs(),
					isDebug: this.sys().isDebugBuild(),
					objects: [...that.#objects.map(o => o.abs())],
					libraries: [],
					type: imageType
				};

				for (const ar of this.archives) {
					args.libraries.push({ path: ar.abs(), type: 'static' });
				}

				return that.#cpp.toolchain().link(args);
			}
		}

		return new ImageImpl();
	}
}

module.exports = { Compilation };
