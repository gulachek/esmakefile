class Target {
	#sys;

	constructor(sys) {
		this.#sys = sys;
	}

	toString() {
		return this.constructor.name;
	}

	sys() { return this.#sys; }

	deps() { return null; }

	build() {
		return Promise.reject(new Error(
			`build() not implemented: ${this}`
		));
	}

	// Date object of mtime, null means out of date
	mtime() { return null; }
}

module.exports = { Target };
