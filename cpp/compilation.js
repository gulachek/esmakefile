const { CppObject } = require('./object');
const { Library, linkedLibrariesOf } = require('./library');
const { InstallLibroot } = require('./libroot');
const { StaticPath } = require('../lib/pathTargets');
const { mergeDefs } = require('./mergeDefs');
const { includesOf } = require('./library');

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

	#srcs;
	#includes;
	#interfaceDefs;
	#implDefs;
	#libs;
	#cpp;
	#linkTypes;
	#apiDef;

	constructor(cpp, args) {
		super();
		this.#name = args.name;
		this.#version = args.version;
		this.#apiDef = args.apiDef;

		this.#cpp = cpp;
		this.#srcs = [];
		this.#includes = [];
		this.#libs = [];
		this.#linkTypes = {};
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
	}

	link(lib, opts) {
		const type = opts.type;

		if (this.#linkTypes[lib.name()]) {
			throw new Error(`Cannot link ${lib} twice`);
		}

		if (type === 'header' && !lib.isHeaderOnly()) {
			throw new Error(`Cannot link non-header-only library ${lib} as header-only`);
		}

		if (type === 'static' && !lib.archive()) {
			throw new Error(`Cannot statically link library ${lib} without archive`);
		}

		if (type === 'dynamic' && !lib.image()) {
			throw new Error(`Cannot dynamically link library ${lib} without image`);
		}

		const order = [98, 3, 11, 14, 17, 20];
		const libIndex = order.indexOf(lib.cppVersion());

		if (libIndex === -1) {
			throw new Error(`'${lib.name()}' has an invalid c++ version ${lib.cppVersion()}`);
		}

		if (order.indexOf(this.#cpp.cppVersion()) < libIndex) {
			throw new Error(`'${lib.name()}' uses a newer version of c++ than ${this.name()}`);
		}

		this.#libs.push(lib);
		this.#linkTypes[lib.name()] = type;
	}

	add_src(src) {
		this.#srcs.push(src);
	}

	include(dir) {
		const dirpath = this.#cpp.sys().src(dir);
		this.#includes.push(dirpath);
	}

	libroot() {
		return new InstallLibroot(this.#cpp, this);
	}

	copyObjects(args) {
		const toolchain = this.#cpp.toolchain();

		const defs = new Map();
		if (this.#cpp.sys().isDebugBuild()) {
			defs.set('DEBUG', 1);
		} else {
			defs.set('NDEBUG', 1);
		}

		defs.set('IMPORT', toolchain.importDef);
		defs.set('EXPORT', toolchain.exportDef);

		const includes = [...this.#includes];

		for (const lib of this.#libs) {
			for (const obj of includesOf(lib)) {
				for (const i of obj.includes) {
					includes.push(i);
				}

				mergeDefs(defs, obj.defs);
			}
		}

		mergeDefs(defs, this.#implDefs);
		if (this.#apiDef) {
			mergeDefs(defs, [[this.#apiDef, args.useExport ? 'EXPORT' : '']]);
        }

		const objs = [];

		for (const src of this.#srcs) {
			const obj = new CppObject(this.#cpp, {
				src, includes, defs
			});

			objs.push(obj);
		}

		return objs;
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

	definitions(args) {
		const defs = new Map(this.#interfaceDefs);

		if (this.#apiDef) {
			mergeDefs(defs, [[this.#apiDef, args.linkType === 'dynamic' ? 'IMPORT' : '']]);
		}

		return defs;
	}

	isHeaderOnly() {
		return this.#srcs.length < 1;
	}

	deps() {
		return this.#libs;
	}

	linkTypeOf(dep) {
		const name = dep.name();
		if (!(this.#linkTypes[name])) {
			throw new Error(`No defined link type for ${dep}`);
		}

		return this.#linkTypes[name];
	}

	archive() {
		if (this.isHeaderOnly()) {
			return null;
		}

		const that = this;

		class ArchiveImpl extends StaticPath {
			#objects;

			constructor() {
				const sys = that.#cpp.sys();
				const nameUnder = that.name().replaceAll('.', '_');
				const version = that.version();
				const versionPiece = version ? `${version}.` : '';
				const ext = that.#cpp.toolchain().archiveExt;
				const fname = `lib${nameUnder}.${versionPiece}${ext}`;
				super(sys, sys.dest(fname));
				this.#objects = that.copyObjects({ useExport: false });
			}

			deps() {
				return this.#objects;
			}

			build(cb) {
				console.log(`archiving ${this.path()}`);

				const args = {
					gulpCallback: cb,
					outputPath: this.abs(),
					objects: this.#objects.map(o => o.abs())
				};

				return that.#cpp.toolchain().archive(args);
			}
		}

		return new ArchiveImpl();
	}

	image() {
		const nameUnder = this.name().replaceAll('.', '_');
		const version = this.version();
		const versionPiece = version ? `${version}.` : '';
		const ext = this.#cpp.toolchain().dynamicLibExt;
		const fname = `lib${nameUnder}.${versionPiece}${ext}`;
		return this.#image('dynamicLib', fname);
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
			#libs;
			#objects;

			libs() {
				if (!this.#libs) {
					this.#libs = [...linkedLibrariesOf(that)];
				}

				return this.#libs;
			}

			constructor() {
				const cpp = that.#cpp;
				const sys = cpp.sys();
				super(sys, sys.dest(output));
				this.#objects = that.copyObjects({ useExport: imageType === 'dynamicLib' });
			}

			deps() {
				const libObjs = this.libs().map(l => l.obj);
				return [...this.#objects, ...libObjs];
			}

			build(cb) {
				console.log(`linking ${this.path()}`);

				const args = {
					gulpCallback: cb,
					outputPath: this.abs(),
					isDebug: this.sys().isDebugBuild(),
					objects: [...this.#objects.map(o => o.abs())],
					libraries: [],
					type: imageType
				};

				for (const { obj, linkType } of this.libs()) {
					args.libraries.push({ path: obj.abs(), type: linkType });
				}

				return that.#cpp.toolchain().link(args);
			}
		}

		return new ImageImpl();
	}
}

module.exports = { Compilation };
