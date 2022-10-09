const semver = require('semver');

class Library {
	#stub() {
		throw new Error(`${this.constructor.name}: not implemented`);
	}

	// (string) reverse domain notation of the library
	name() { this.#stub(); }

	// (string) semver version of library
	version() { this.#stub(); }

	// (string) type of library 'static' | 'dynamic'
	type() { this.#stub(); }

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
	binary() { this.#stub(); }

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

function isHeaderOnly(lib) {
	return !lib.binary();
}

function *linkedLibrariesOf(lib, cpp) {
	const tree = new DepTree({ mode: 'link', cpp });
	tree.add(lib);
	const deps = [...tree.backwards()];
	deps.shift(); // drop self

	for (const dep of deps) {
		if (!isHeaderOnly(dep)) {
			yield dep;
		}
	}
}

function *includesOf(libOrLibs, cpp) {
	const tree = new DepTree({ mode: 'compile', cpp });
	const libs = libOrLibs instanceof Library ? [libOrLibs] : libOrLibs;
	for (const lib of libs) {
		tree.add(lib);
	}

	const deps = [...tree.forwards()];

	for (const dep of deps) {
		yield { includes: dep.includes(), defs: dep.definitions() };
	}
}

class DepTree {
	#root;
	#cpp;

	// compile or link mode
	#mode; 

	// libKey -> newest minor version lib
	#libs;

	// libKey -depends on-> libKey[]
	#deps;

	constructor(opts) {
		this.#root = '<root>';
		this.#libs = {};
		this.#deps = {};
		this.#deps[this.#root] = [];
		this.#mode = opts.mode;
		this.#cpp = opts.cpp;
	}

	add(lib) {
		this.#addDependency(this.#root, lib);
	}

	#addDependency(key, depLib) {
		const depKey = libKey(depLib);
		this.#deps[key].push(depKey);
		this.#recurse(depKey, depLib);
	}

	// add dependencies of lib to tree
	#recurse(key, lib) {
		if (key in this.#libs) {
			const existing = this.#libs[key];

			if (lib.type() !== existing.type()) {
				throw new Error(`Library ${lib} cannot be linked as both ${lib.type()} and ${existing.type()}`);
			}

			if (!isNewer(lib, existing)) {
				return;
			}
		}

		this.#libs[key] = lib;
		this.#deps[key] = [];

		for (const dep of lib.deps()) {
			this.#addDependency(key, dep);
		}
	}

	*#forwardIt(key, guard, skipYield) {
		for (const depKey of this.#deps[key]) {
			if (!guard[depKey]) {
				for (const l of this.#forwardIt(depKey, guard, false)) {
					yield l;
				}
			}
		}

		if (guard[key]) {
			throw new Error(`Circular dependency detected for ${key}`);
		}

		if (!skipYield) yield this.#libs[key];
		guard[key] = 1;
	}

	forwards() {
		const guard = {};
		return this.#forwardIt(this.#root, guard, true);
	}

	backwards() {
		const a = [...this.forwards()];
		a.reverse();
		return a;
	}
}

module.exports = {
	Library,
	linkedLibrariesOf,
	includesOf,
	majorVersion
};
