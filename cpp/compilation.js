const { CppObject } = require('./object');
const { InstallLibroot } = require('./libroot');
const { StaticPath } = require('../lib/pathTargets');
const { mergeDefs } = require('./mergeDefs');
const { includesOf } = require('./library');
const { Archive } = require('./archive');
const { Image } = require('./image');
const { HeaderLibrary } = require('./headerLibrary');

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

class Compilation {
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

	link(lib) {
		const order = [98, 3, 11, 14, 17, 20];
		const libIndex = order.indexOf(lib.cppVersion());

		if (libIndex === -1) {
			throw new Error(`'${lib.name()}' has an invalid c++ version ${lib.cppVersion()}`);
		}

		if (order.indexOf(this.#cpp.cppVersion()) < libIndex) {
			throw new Error(`'${lib.name()}' uses a newer version of c++ than ${this.name()}`);
		}

		this.#libs.push(lib);
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
			for (const obj of includesOf(lib, this.#cpp)) {
				for (const i of obj.includes) {
					includes.push(i);
				}

				mergeDefs(defs, obj.defs);
			}
		}

		mergeDefs(defs, this.#implDefs);

		if (args.define) {
			const { implementation } = normalizeDefines(args.define);
			mergeDefs(defs, implementation);
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

	name() {
		return this.#name;
	}

	version() {
		return this.#version;
	}

	cppVersion() {
		return this.#cpp.cppVersion();
	}

	isHeaderOnly() {
		return this.#srcs.length < 1;
	}

	archive() {
		if (this.isHeaderOnly()) {
			throw new Error('Library has no sources');
		}

		if (!this.#apiDef) {
			throw new Error('Library should define an apiDef');
		}

		const apiDefs = new Map(this.#interfaceDefs);
		mergeDefs(apiDefs, [[this.#apiDef, '']]);

		return new Archive(this.#cpp, {
			objects: this.copyObjects({ define: { [this.#apiDef]: '' } }),
			name: this.#name,
			version: this.#version,
			includes: [...this.#includes],
			defs: apiDefs,
			libs: [...this.#libs]
		});
	}

	image() {
		const nameUnder = this.name().replaceAll('.', '_');
		const version = this.version();
		const versionPiece = version ? `${version}.` : '';
		const ext = this.#cpp.toolchain().dynamicLibExt;
		const fname = `lib${nameUnder}.${versionPiece}${ext}`;
		return this.#image('dynamicLib', fname);
	}

	executable() {
		const name = this.name();
		const ext = this.#cpp.toolchain().executableExt;
		const out = ext ? `${name}.${ext}` : name;
		return this.#image('executable', out).binary();
	}

	#image(imageType, output) {
		if (this.isHeaderOnly()) {
			throw new Error('Library has no sources');
		}

		if (imageType === 'dynamicLib' && !this.#apiDef) {
			throw new Error('Library should define an apiDef');
		}

		const apiDefs = new Map(this.#interfaceDefs);

		if (this.#apiDef) {
			mergeDefs(apiDefs, [[this.#apiDef, 'IMPORT']]);
		}

		return new Image(this.#cpp, {
			objects: this.copyObjects({ define: { [this.#apiDef]: 'EXPORT' } }),
			imageType: imageType,
			filename: output,
			name: this.#name,
			version: this.#version,
			includes: [...this.#includes],
			defs: apiDefs,
			libs: [...this.#libs]
		});
	}

	headers() {
		if (!this.isHeaderOnly()) {
			throw new Error('Library is not header only');
		}

		// makes it smoother to add sources later. Don't need to hunt cpp code
		if (!this.#apiDef) {
			throw new Error('Library should define an apiDef');
		}

		const apiDefs = new Map(this.#interfaceDefs);

		if (this.#apiDef) {
			mergeDefs(apiDefs, [[this.#apiDef, '']]);
		}

		return new HeaderLibrary(this.#cpp, {
			name: this.#name,
			version: this.#version,
			includes: [...this.#includes],
			defs: apiDefs,
			libs: [...this.#libs]
		});
	}
}

module.exports = { Compilation };
