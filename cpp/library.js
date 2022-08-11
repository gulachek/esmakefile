const { StaticPath } = require('../lib/pathTargets');
const semver = require('semver');

class Library {
	#stub() {
		throw new Error(`${this.constructor.name}: not implemented`);
	}

	// (string) reverse domain notation of the library
	name() { this.#stub(); }

	// (string) semver version of library
	version() { this.#stub(); }

	// minimum version of c++ the library can be compiled against
	// (one of 98, 3, 11, 14, 17, 20)
	cppVersion() { this.#stub(); }

	// iterable absolute paths to directories needed to include for this
	// library (not dependencies)
	// PathTarget[]
	includes() { this.#stub(); }

	// compiling against library requires these definitions. values have
	// to be strings. Deps definitions() not included. Defined in order
	// after dependency definitions
	// ( { key: string, val: string }[] )
	definitions() { this.#stub(); }

	// (boolean) is this a header-only library?
	isHeaderOnly() { this.#stub(); }

	// (PathTarget?) static library if available
	archive() { this.#stub(); }

	// (PathTarget?) dynamic library if available
	dynamic() { this.#stub(); }

	// iterable dependencies that also must be included / linked
	// (Library[])
	deps() { this.#stub(); }
}

function majorVersion(lib) {
	const v = lib.version();
	return v ? v.split('.')[0] : '';
}

function isNewer(a, b) {
	return semver.gt(a.version(), b.version());
}

function libKey(lib) {
	return `${lib.name()}/${majorVersion(lib)}`;
}

class DepTree {
	#root;

	// libKey -> newest minor version lib
	#libs;

	// libKey -depends on-> libKey[]
	#deps;

	// libKey -is depended on by-> libKey[]
	#backDeps;

	constructor(lib) {
		const key = libKey(lib);
		this.#root = key;
		this.#libs = {};
		this.#deps = {};
		this.#backDeps = {};
		this.#recurse(key, lib);
		this.#backRecurse(key);
	}

	// add dependencies of lib to tree
	#recurse(key, lib) {
		if (key in this.#libs && !isNewer(lib, this.#libs[key])) {
			return;
		}

		this.#libs[key] = lib;
		this.#deps[key] = [];
		this.#backDeps[key] = [];

		for (const dep of lib.deps()) {
			const depKey = libKey(dep);
			this.#deps[key].push(depKey);
			this.#recurse(depKey, dep);
		}
	}

	#backRecurse(key) {
		for (const depKey of this.#deps[key]) {
			this.#backDeps[depKey].push(key);
			this.#backRecurse(depKey);
		}
	}

	backwards() {
		const guard = {};
		return this.#backwardsIt(this.#root, guard);
	}

	*#backwardsIt(key, guard) {
		// need to list out everything that depends on lib before it
		for (const refKey of this.#backDeps[key]) {
			if (refKey in guard) { continue; }
			for (const l of this.#backwardsIt(refKey, guard)) {
				yield l;
			}
		}

		// list out this lib
		yield this.#libs[key];
		guard[key] = true;

		// list out all dependencies
		for (const depKey of this.#deps[key]) {
			if (depKey in guard) {
				throw new Error(`${key} was listed after dependency ${depKey}`); 
			}

			for (const l of this.#backwardsIt(depKey, guard)) {
				yield l;
			}
		}
	}
}

/*
class CppLibrary extends StaticPath {
	#name;
	#version;
	#objects;
	#includes;
	#libs;
	#cpp;

	constructor(cpp, args) {
		const sys = cpp.sys();
		const nameUnder = args.name.replaceAll('.', '_');
		const fname = `lib${nameUnder}.${args.version}.${cpp.toolchain().archiveExt}`;
		super(sys, sys.dest(fname));
		this.#name = args.name;
		this.#version = args.version;
		this.#cpp = cpp;
		this.#objects = new CppObjectGroup(cpp);
		this.#includes = [];
		this.#libs = [];
	}

	name() { return this.#name; }
	version() { return this.#version; }
	cppVersion() { return this.#cpp.cppVersion(); }

	#headerOnly() { return this.#objects.length < 1; }

	libroot() {
		return new InstallLibroot(this.#cpp, {
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

	define(defs) {
		this.#objects.define(defs);
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

	definitions() {
		// ERROR: does not include dependencies right now
		return this.#objects.interfaceDefs();
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

		return this.#cpp.toolchain().archive(args);
	}
}
*/

module.exports = { Library, DepTree };
