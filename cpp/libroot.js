const { Library } = require('./library');
const { StaticPath, copyDir, copyFile } = require('../lib/pathTargets');
const { Target } = require('../lib/target');
const path = require('path');
const fs = require('fs');
const { mergeDefs } = require('./mergeDefs');

function isLibrootName(name) {
	return /^[a-z][a-z0-9-]+(\.[a-z][a-z0-9-]+)+$/.test(name);
}

class InstallLibroot extends StaticPath {
	#cpp;
	#lib;
	#includes;
	#deps;
	#depLibroots;
	#defs;
	#binaries;

	constructor(cpp, lib) {
		const name = lib.name();
		const version = lib.version();
		const sys = cpp.sys();
		const fname = sys.isDebugBuild() ? 'debug' : 'release';
		super(sys, sys.install(`cpplibroot/${name}/${version}/${fname}.json`));

		this.#cpp = cpp;
		this.#lib = lib;

		this.#includes = [];
		for (const inc of lib.includes()) {
			this.#includes.push(copyDir(this.sys(), inc, sys.install('include')));
		}

		this.#binaries = [];
		if (lib.archive()) { this.#binaries.push(lib.archive()); }
		if (lib.image()) { this.#binaries.push(lib.image()); }

		this.#depLibroots = [];
		const deps = [...lib.deps()];
		for (const dep of deps) {
			if (typeof dep.libroot === 'function') {
				this.#depLibroots.push(dep.libroot());
			}
		}

		this.#defs = [];
		for (const kv of lib.definitions()) {
			this.#defs.push(kv);
		}

		this.#deps = deps;
	}

	build(cb) {
		const obj = {};
		obj.language = `c++${this.#cpp.cppVersion()}`;
		obj.includes = this.#includes.map(i => i.abs());
		const archive = this.#lib.archive();
		const image = this.#lib.image();
		if (archive) { obj.archive = archive.abs(); }
		if (image) { obj.image = image.abs(); }
		obj.definitions = this.#defs;
		obj.deps = {};
		for (const dep of this.#deps) {
			obj.deps[dep.name()] = {
				version: dep.version(),
				linkType: this.#lib.linkTypeOf(dep)
			}
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
	#defs;
	
	includes;
	archive;
	image;

	constructor(obj) {
		this.#initLang(obj.language);
		this.#initDeps(obj.deps);
		this.#initDefs(obj.definitions);

		this.includes = obj.includes || [];
		this.archive = obj.archive;
		this.image = obj.image;
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

	#initDefs(defs) {
		this.#defs = new Map();
		mergeDefs(this.#defs, defs || []);
	}

	*deps() {
		for (const nm in this.#deps) {
			yield [nm, this.#deps[nm]];
		}
	}

	definitions() {
		return this.#defs;
	}

	cppVersion() { return this.#cppVersion; }
}

class CppLibrootImport extends Library {
	#dir;
	#name;
	#version;
	#config;
	#binaries;
	#includes;
	#deps;
	#cpp;
	#linkTypes;

	constructor(cpp, args) {
		super();
		const sys = cpp.sys();
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

		this.#searchDeps();
	}

	name() { return this.#name; }
	version() { return this.#version; }
	cppVersion() { return this.#config.cppVersion(); }
	definitions() { return this.#config.definitions(); }

	deps() {
		return this.#deps;
	}

	linkTypeOf(dep) {
		return this.#linkTypes[dep.name()];
	}

	toString() {
		return `${this.constructor.name}{${this.#name} (${this.#version})}`;
	}

	#searchDeps()
	{
		this.#deps = [];
		this.#linkTypes = {};
		for (const [name, link] of this.#config.deps()) {
			this.#deps.push(this.#cpp.require(name, link.version));
			this.#linkTypes[name] = link.type;
		}
	}

	archive() {
		const archive = this.#config.archive;
		return archive && this.#cpp.sys().ext(archive);
	}

	image() {
		const image = this.#config.image;
		return image && this.#cpp.sys().ext(image);
	}

	includes() {
		if (this.#includes) {
			return this.#includes;
		}

		this.#includes = [];
		const includes = this.#config.includes;
		if (includes) {
			for (const inc of includes) {
				this.#includes.push(this.#cpp.sys().ext(inc));
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
