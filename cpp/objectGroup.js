const { CppObject } = require('./object');
const { Target } = require('../lib/target');

class CppObjectGroup extends Target {
	#objects;
	#includes;
	#libs;
	#toolchain;

	constructor(sys, args) {
		super(sys);
		this.#toolchain = args.toolchain;
		this.#objects = [];
		this.#includes = [];
		this.#libs = [];
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

	link(lib) {
		for (const o of this.#objects) {
			o.link(lib);
		}

		this.#libs.push(lib);
	}

	add_src(src) {
		const o = new CppObject(this.sys(), {
			src: src,
			toolchain: this.#toolchain
		});

		for (const i of this.#includes) {
			o.include(i);
		}

		for (const lib of this.#libs) {
			o.link(lib);
		}

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
