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
	// args:
	// linkType: 'static'|'dynamic'|'header'
	// ( { key: string, val: string }[] )
	definitions(args) { this.#stub(); }

	// (boolean) is this a header-only library?
	isHeaderOnly() { this.#stub(); }

	// (PathTarget?) static library if available
	archive() { this.#stub(); }

	// (PathTarget?) dynamic library if available
	image() { this.#stub(); }

	// iterable dependencies that also must be included / linked
	// (Library[])
	deps() { this.#stub(); }

	// how does this library link to dependency 'lib'
	// ('static'|'dynamic'|'header')
	linkTypeOf(lib) { this.#stub(); }
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

function *linkedLibrariesOf(lib) {
	const tree = new DepTree(lib, { mode: 'link' });
	const deps = [...tree.backwards()];
	deps.shift(); // drop self

	for (const dep of deps) {
		const linkType = tree.linkTypeOf(dep);
		switch (tree.linkTypeOf(dep)) {
			case 'static':
				yield { obj: dep.archive(), linkType };
				break;
			case 'dynamic':
				yield { obj: dep.image(), linkType };
				break;
			case 'header':
				break;
			default:
				throw new Error(`Unhandled link type ${linkType}`);
				break;
		}
	}
}

function *includesOf(lib) {
	const tree = new DepTree(lib, { mode: 'compile' });
	const deps = [...tree.forwards()];

	for (const dep of deps) {
		yield { includes: dep.includes(), defs: dep.definitions(tree.linkTypeOf(dep) || 'static') }; // TODO: 'static' is WRONG. temp workaround
	}
}

class DepTree {
	#root;

	// compile or link mode
	#mode; 

	// libKey -> newest minor version lib
	#libs;

	// libKey -> link type
	#linkTypes;

	// libKey -depends on-> libKey[]
	#deps;

	constructor(lib, opts) {
		const key = libKey(lib);
		this.#root = key;
		this.#libs = {};
		this.#linkTypes = {};
		this.#deps = {};
		this.#mode = opts.mode;
		this.#recurse(key, lib, 'static');
	}

	#shouldRecurse(linkType) {
		return this.#mode === 'compile' || linkType !== 'dynamic';
	}

	// add dependencies of lib to tree
	#recurse(key, lib, linkType) {
		if (key in this.#libs) {
			if (this.#linkTypes[key] !== linkType) {
				throw new Error(`Library ${lib} cannot be linked as both ${linkType} and ${this.linkTypes[key]}`);
			}

			if (!isNewer(lib, this.#libs[key])) {
				return;
			}
		}

		this.#libs[key] = lib;
		this.#linkTypes[key] = linkType;
		this.#deps[key] = [];

		if (this.#shouldRecurse(linkType)) {
			for (const dep of lib.deps()) {
				const depKey = libKey(dep);
				this.#deps[key].push(depKey);
				this.#recurse(depKey, dep, lib.linkTypeOf(dep));
			}
		}
	}

	*#forwardIt(key, guard) {
		for (const depKey of this.#deps[key]) {
			if (!guard[depKey]) {
				for (const l of this.#forwardIt(depKey, guard)) {
					yield l;
				}
			}
		}

		if (guard[key]) {
			throw new Error(`Circular dependency detected for ${key}`);
		}

		yield this.#libs[key];
		guard[key] = 1;
	}

	forwards() {
		const guard = {};
		return this.#forwardIt(this.#root, guard);
	}

	backwards() {
		const a = [...this.forwards()];
		a.reverse();
		return a;
	}

	linkTypeOf(lib) {
		const key = libKey(lib);
		return this.#linkTypes[key];
	}
}

module.exports = { Library, linkedLibrariesOf, includesOf };
