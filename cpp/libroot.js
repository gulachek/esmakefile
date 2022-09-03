const { Library } = require('./library');
const { StaticPath, copyDir, copyFile } = require('../lib/pathTargets');
const { Target } = require('../lib/target');
const path = require('path');
const fs = require('fs');
const { mergeDefs } = require('./mergeDefs');
const semver = require('semver');

const CPP_LIBROOT_VERSION = '0.1.0';

function librootMetaName(sys, lib) {
	const buildType = sys.isDebugBuild() ? 'debug' : 'release';
	const linkType = lib.type();
	return `${linkType}_${buildType}.json`;
}

function isLibrootName(name) {
	return /^[a-z][a-z0-9-]+(\.[a-z][a-z0-9-]+)+$/.test(name);
}

class LibrootConfig {
	#lang;
	#deps;
	#cppVersion;
	#defs;
	
	includes;
	binary;
	version;

	constructor(obj) {
		this.#initLang(obj.language);
		this.#initDeps(obj.deps);
		this.#initDefs(obj.definitions);
		this.#initVersion(obj.version);

		this.includes = obj.includes || [];
		this.binary = obj.binary;
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

	#initVersion(version) {
		if (!version) {
			throw new Error('Missing "version" property');
		}

		if (!semver.valid(version)) {
			throw new Error('Invalid semver "version" property');
		}

		this.version = version;
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

function searchLibroot(paths, name, version, type, isDebug) {
	if (!isLibrootName(name)) {
		throw new Error(`Invalid cpp libroot name ${name}`);
	}

	const major = semver.major(version).toString();
	const buildType = isDebug ? 'debug' : 'release';
	const f = `${type}_${buildType}.json`;

	for (const root of paths) {
		const p = path.resolve(root, name, major, f);
		if (fs.existsSync(p)) {
			let json;
			try {
				json = JSON.parse(fs.readFileSync(p, { encoding: 'utf8' }));
			} catch (e) {
				e.message = `Error parsing ${p}: ${e.message}`;
				throw e;
			}

			if (!json.librootVersion) {
				throw new Error(`${p}: no "librootVersion" property`);
			}

			if (!semver.satisfies(CPP_LIBROOT_VERSION, `^${json.librootVersion}`)) {
				console.log(`Skipping ${p}: librootVersion=${json.librootVersion} incompatible with build system's version ${CPP_LIBROOT_VERSION}`);
				continue;
			}

			let config;
			try {
				config = new LibrootConfig(json);
			} catch (e) {
				e.message = `Error in ${p}: ${e.message}`;
				throw e;
			}

			if (semver.satisfies(config.version, `^${version}`)) {
				console.log(`Found ${name} (${config.version})`);
				return config;
			}
		}
	}

	throw new Error(`${name} (${version}) not found in CPP_LIBROOT_PATH '${paths}'`);
}

class CppLibrootImport extends Library {
	#name;
	#config;
	#binaries;
	#includes;
	#deps;
	#cpp;
	#type;

	constructor(cpp, args) {
		super();
		const sys = cpp.sys();
		this.#cpp = cpp;

		const { name, version, type } = args;
		this.#name = name;
		this.#type = type;

		const librootPath = process.env.CPP_LIBROOT_PATH;

		if (!librootPath) {
			throw new Error(`Environment variable CPP_LIBROOT_PATH not defined`);
		}

		const paths = librootPath.split(':');

		this.#config =
			searchLibroot(paths, name, version, type, sys.isDebugBuild());

		this.#searchDeps();
	}

	name() { return this.#name; }
	version() { return this.#config.version; }
	type() { return this.#type; }
	cppVersion() { return this.#config.cppVersion(); }
	definitions() { return this.#config.definitions(); }

	deps() {
		return this.#deps;
	}

	toString() {
		return `${this.constructor.name}{${this.#name} (${this.version()})}`;
	}

	#searchDeps()
	{
		this.#deps = [];
		for (const [name, link] of this.#config.deps()) {
			this.#deps.push(this.#cpp.require(name, link.version, link.type));
		}
	}

	binary() {
		const binary = this.#config.binary;
		return binary && this.#cpp.sys().ext(binary);
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

class LibrootTarget extends StaticPath {
	#cpp;
	#lib;

	constructor(cpp, args) {
		const { lib, dir } = args;
		const sys = cpp.sys();
		const name = librootMetaName(sys, lib);
		super(sys, dir.join(name));
		this.#cpp = cpp;
		this.#lib = lib;
	}

	build(cb) {
		const {
			GULPACHEK_TARGET_INCLUDE_DIR,
			GULPACHEK_TARGET_LIB_DIR,
			GULPACHEK_TARGET_PLATFORM
		} = process.env;

		if (!GULPACHEK_TARGET_LIB_DIR) {
			throw new Error('GULPACHEK_TARGET_LIB_DIR not defined');
		}

		if (!GULPACHEK_TARGET_INCLUDE_DIR) {
			throw new Error('GULPACHEK_TARGET_INCLUDE_DIR not defined');
		}

		let pathMod;
		switch (GULPACHEK_TARGET_PLATFORM) {
			case 'posix':
				pathMod = path.posix;
				break;
			case 'win32':
				pathMod = path.win32;
				break;
			default:
				throw new Error(`Unknown GULPACHEK_TARGET_PLATFORM '${GULPACHEK_TARGET_PLATFORM}'`);
				break;
		}

		const obj = {};
		obj.librootVersion = CPP_LIBROOT_VERSION;
		obj.language = `c++${this.#cpp.cppVersion()}`;
		obj.version = this.#lib.version();
		obj.includes = [ GULPACHEK_TARGET_INCLUDE_DIR ];

		const basename = path.basename(this.#lib.binary().abs());
		obj.binary = pathMod.join(GULPACHEK_TARGET_LIB_DIR, basename);
		obj.definitions = [...this.#lib.definitions()];
		obj.deps = {};
		for (const dep of this.#lib.deps()) {
			obj.deps[dep.name()] = {
				version: dep.version(),
				type: dep.type()
			}
		}

		fs.writeFile(this.abs(), JSON.stringify(obj), cb);
	}
}

class LibrootPackage extends Target {
	#cpp;
	#lib;
	#binary;
	#libroot;
	#includes;

	constructor(cpp, lib) {
		const name = lib.name();
		const version = lib.version();
		const nameUnder = name.replaceAll('.', '_');
		const sys = cpp.sys();
		const dir = sys.dest(`${nameUnder}.${version}`);
		super(sys, dir);

		this.#cpp = cpp;
		this.#lib = lib;

		this.#includes = [];
		for (const inc of lib.includes()) {
			this.#includes.push(copyDir(sys, inc, dir.join('include')));
		}

		this.#libroot = new LibrootTarget(cpp, {
			lib,
			dir
		});

		this.#binary = copyFile(sys, lib.binary(), dir);
	}

	build() {
		console.log(`packing ${this.#binary.path()}`);
		return Promise.resolve();
	}

	deps() {
		return [this.#libroot, this.#binary, ...this.#includes];
	}
}

module.exports = {
	LibrootPackage,
	CppLibrootImport
};
