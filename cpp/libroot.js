const { StaticPath, copyDir, copyFile } = require('../lib/pathTargets');
const { Target } = require('../lib/target');
const path = require('path');
const fs = require('fs');

function isLibrootName(name) {
	return /^[a-z][a-z0-9-]+(\.[a-z][a-z0-9-]+)+$/.test(name);
}

class InstallLibroot extends StaticPath {
	#includes;
	#binaries;
	#deps;
	#depLibroots;

	constructor(sys, args) {
		const { name, version, includes, binaries, deps } = args;
		const fname = sys.isDebugBuild() ? 'debug' : 'release';
		super(sys, sys.install(`cpplibroot/${name}/${version}/${fname}.json`));

		this.#includes = [];
		for (const inc of includes) {
			this.#includes.push(copyDir(this.sys(), inc, sys.install('include')));
		}

		this.#binaries = [];
		for (const bin of binaries) {
			this.#binaries.push(copyFile(this.sys(), bin, sys.install('lib')));
		}

		this.#depLibroots = [];
		for (const dep of deps) {
			if (typeof dep.libroot === 'function') {
				this.#depLibroots.push(dep.libroot());
			}
		}

		this.#deps = deps;
	}

	build(cb) {
		const obj = {};
		obj.includes = this.#includes.map(i => i.abs());
		obj.binaries = this.#binaries.map(b => b.abs());
		obj.deps = {};
		for (const dep of this.#deps) {
			obj.deps[dep.name()] = dep.version();
		}

		fs.writeFile(this.abs(), JSON.stringify(obj), cb);
	}

	deps() {
		return [
			...this.#includes,
			...this.#binaries,
			...this.#depLibroots
		];
	}
}

class CppLibrootImport extends Target {
	#dir;
	#name;
	#version;
	#config;
	#binaries;
	#includes;
	#deps;
	#cpp;

	constructor(sys, args) {
		super(sys);
		this.#cpp = args.cpp;

		this.#name = args.name;
		this.#version = args.version;
		this.#dir = args.dir;
		const f = sys.isDebugBuild() ? 'debug.json' : 'release.json';
		this.#config = JSON.parse(fs.readFileSync(
			path.resolve(this.#dir, f),
			{ encoding: 'utf8' }
		));

		this.#deps = {};

		this.#searchDeps('deps', { include: true, binary: true });
		this.#searchDeps('bin-deps', { include: false, binary: true });
	}

	name() { return this.#name; }
	version() { return this.#version; }

	toString() {
		return `${this.constructor.name}{${this.#name} (${this.#version})}`;
	}

	#searchDeps(key, traits)
	{
		for (const dep in this.#config[key]) {
			if (this.#deps[dep]) {
				throw new Error(`${dep} can only be specified as depencency once`);
			}

			const version = this.#config[key][dep];
			const lib = this.#cpp.require(dep, version);
			this.#deps[dep] = { traits, lib };
		}
	}

	build() {
		return Promise.resolve();
	}

	binaries() {
		if (this.#binaries) {
			return this.#binaries;
		}

		this.#binaries = [];
		const binaries = this.#config.binaries;
		if (binaries) {
			for (const bin of binaries) {
				this.#binaries.push(this.sys().ext(bin));
			}
		}

		for (const dep in this.#deps) {
			if (!this.#deps[dep].traits.binary) { continue; }
			for (const bin of this.#deps[dep].lib.binaries()) {
				this.#binaries.push(bin);
			}
		}

		return this.#binaries;
	}

	includes() {
		if (this.#includes) {
			return this.#includes;
		}

		this.#includes = [];
		const includes = this.#config.includes;
		if (includes) {
			for (const inc of includes) {
				this.#includes.push(this.sys().ext(inc));
			}
		}

		for (const dep in this.#deps) {
			if (!this.#deps[dep].traits.include) { continue; }
			for (const inc of this.#deps[dep].lib.includes()) {
				this.#includes.push(inc);
			}
		}

		return this.#includes;
	}
}

module.exports = {
	isLibrootName,
	InstallLibroot,
	CppLibrootImport
};
