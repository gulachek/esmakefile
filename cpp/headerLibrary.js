const { Library } = require('./library');

class HeaderLibrary extends Library {
	#cpp;
	#name;
	#version;
	#includes;
	#defs;
	#libs;

	constructor(cpp, args) {
		super();
		this.#cpp = cpp;
		this.#name = args.name;
		this.#version = args.version;
		this.#includes = args.includes;
		this.#defs = args.defs;
		this.#libs = args.libs;
	}

	name() {
		return this.#name;
	}

	version() {
		return this.#version;
	}

	type() {
		return 'header';
	}

	cppVersion() {
		return this.#cpp.cppVersion();
	}

	includes() {
		return this.#includes;
	}

	definitions() {
		return this.#defs;
	}

	// TODO this isn't a necessary function anymore
	isHeaderOnly() {
		return true;
	}

	deps() {
		return this.#libs;
	}

	binary() {
		return null;
	}
}

module.exports = {
	HeaderLibrary
};
