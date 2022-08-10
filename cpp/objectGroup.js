const { CppObject } = require('./object');
const { Target } = require('../lib/target');

function normalizeDefines(defs) {
	const apiDefs = {};
	const implementation = {};

	for (const key in defs) {
		const val = defs[key];
		if (['string', 'boolean', 'number'].indexOf(typeof val) !== -1) {
			const strVal = val.toString();
			apiDefs[key] = implementation[key] = strVal;
		} else if (typeof val === 'object') {
			if (val.implementation) {
				implementation[key] = val.implementation.toString();
			}
			if (val.interface) {
				apiDefs[key] = val.interface.toString();
			}
		}
	}

	return { apiDefs, implementation };
}

class CppObjectGroup extends Target {
	#objects;
	#includes;
	#interfaceDefs;
	#implDefs;
	#libs;
	#cpp;

	constructor(cpp, args) {
		super(cpp.sys());
		this.#cpp = cpp;
		this.#objects = [];
		this.#includes = [];
		this.#libs = [];
		this.#interfaceDefs = {};
		this.#implDefs = {};
	}

	get length() { return this.#objects.length; }

	deps() { return this.#objects; }
	build() { return Promise.resolve(); }
	mtime() {
		let max = new Date(0);
		for (const o of this.#objects) {
			const mtime = o.mtime();
			if (!mtime) { return null; }
			if (mtime > max) { max = mtime; }
		}
		return max;
	}

	define(defs) {
		const { apiDefs, implementation } = normalizeDefines(defs);
		Object.assign(this.#interfaceDefs, apiDefs);
		Object.assign(this.#implDefs, implementation);

		for (const o of this.#objects) {
			o.define(this.#implDefs);
		}
	}

	interfaceDefs() { return this.#interfaceDefs; }

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
		const dirpath = this.sys().src(dir);

		for (const o of this.#objects) {
			o.include(dirpath);
		}

		this.#includes.push(dirpath);
	}

	[Symbol.iterator]() {
		return this.#objects[Symbol.iterator]();
	}
}

module.exports = { CppObjectGroup };
