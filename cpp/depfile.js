const { Target } = require('../lib/target');
const fs = require('fs');

class CppDepfile extends Target {
	#path;
	#toolchain;

	constructor(sys, args) {
		super(sys);
		this.#path = args.path;
		this.#toolchain = args.toolchain;
	}

	build() {
		return Promise.resolve();
	}

	toString() {
		return `CppDepfile{${this.abs()}}`;
	}

	abs() {
		return this.sys().abs(this.#path);
	}

	mtime() {
		const zero = new Date(0);
		const path = this.abs();
		if (!fs.existsSync(path)) return zero; // nothing to depend on

		let maxAge = zero;
		for (const f of this.#toolchain.depfileEntries(path)) {
			try {
				const age = fs.statSync(f).mtime;
				maxAge = maxAge < age ? age : maxAge;
			} catch (e) {
				e.message += `: ${f}`;
				throw e;
			}
		}

		return maxAge;
	}
}

module.exports = { CppDepfile };
