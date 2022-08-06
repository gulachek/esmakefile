const { StaticPath, copyDir, copyFile } = require('../lib/pathTargets');
const { Target } = require('../lib/target');
const path = require('path');
const fs = require('fs');

function isLibrootName(name) {
	return /^[a-z][a-z0-9-]+(\.[a-z][a-z0-9-]+)+$/.test(name);
}

class InstallLibroot extends StaticPath {
	#cpp;
	#includes;
	#binaries;
	#deps;
	#depLibroots;

	constructor(cpp, args) {
		const { name, version, includes, binaries, deps } = args;
		const sys = cpp.sys();
		const fname = sys.isDebugBuild() ? 'debug' : 'release';
		super(sys, sys.install(`cpplibroot/${name}/${version}/${fname}.json`));

		this.#cpp = cpp;

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
		obj.language = `c++${this.#cpp.cppVersion()}`;
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

class LibrootConfig {
	#lang;
	#deps;
	#cppVersion;

	// TODO: remove these in favor of symlinks
	includes;
	binaries;

	constructor(obj) {
		this.#initLang(obj.language);
		this.#initDeps(obj.deps);

		this.includes = obj.includes;
		this.binaries = obj.binaries;
	}

	#initLang(lang) {
		if (!lang) {
			throw new Error('Missing "language" property');
		}

		const match = lang.match(/c\+\+(\d\d)/);
		if (!match) {
			throw new Error(`Invalid "language": ${lang}`);
		}

		const cppVersion = parseInt(match[1], 10);
		switch (cppVersion) {
			case 98:
			case 11:
			case 14:
			case 17:
			case 20:
				break;
			default:
				throw new Error(`Invalid c++ version: ${cppVersion}`);
				break;
		}

		this.#cppVersion = cppVersion;
		this.#lang = lang;
	}

	#initDeps(deps) {
		this.#deps = {};
		for (const nm in deps) {
			if (!isLibrootName(nm)) {
				throw new Error(`${nm} is not a valid libroot name`);
			}

			if (this.#deps[nm]) {
				throw new Error(`${nm} can only be specified as depencency once`);
			}

			this.#deps[nm] = deps[nm];
		}
	}

	*deps() {
		for (const nm in this.#deps) {
			yield nm;
		}
	}

	depVersion(nm) {
		if (!this.#deps[nm]) {
			throw new Error(`No dependency on ${nm}`);
		}

		return this.#deps[nm];
	}

	cppVersion() { return this.#cppVersion; }
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

	constructor(cpp, args) {
		const sys = cpp.sys();
		super(sys);
		this.#cpp = cpp;

		this.#name = args.name;
		this.#version = args.version;
		this.#dir = args.dir;
		const f = sys.isDebugBuild() ? 'debug.json' : 'release.json';
		const p = path.resolve(this.#dir, f);

		try {
			this.#config = new LibrootConfig(JSON.parse(fs.readFileSync(
				p, { encoding: 'utf8' }
			)));
		} catch (e) {
			e.message = `Error parsing ${p}: ${e.message}`;
			throw e;
		}

		this.#deps = {};
		this.#searchDeps();
	}

	name() { return this.#name; }
	version() { return this.#version; }
	cppVersion() { return this.#config.cppVersion(); }

	toString() {
		return `${this.constructor.name}{${this.#name} (${this.#version})}`;
	}

	#searchDeps()
	{
		for (const name of this.#config.deps()) {
			const version = this.#config.depVersion(name);
			const lib = this.#cpp.require(name, version);
			this.#deps[name] = { lib };
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
