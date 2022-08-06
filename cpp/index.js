const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const semver = require('semver');

const { findToolchain } = require('./findToolchain');

const { StaticPath } = require('../lib/pathTargets');
const { Target } = require('../lib/target');
const { CppLibrary } = require('./library');
const { CppExecutable } = require('./executable');
const { isLibrootName, CppLibrootImport } = require('./libroot');

class CppSystem {
	#sys;
	#cppVersion;
	#toolchain;

	constructor(args) {
		if (!args.sys) {
			throw new Error('sys is required');
		}
		this.#sys = args.sys;

		if (!args.cppVersion) {
			throw new Error('cppVersion is required');
		}
		this.#cppVersion = args.cppVersion;

		this.#toolchain = args.toolchain || findToolchain(os);
	}

	sub(dir) {
		return new CppSystem({
			sys: this.#sys.sub(dir),
			cppVersion: this.#cppVersion,
			toolchain: this.#toolchain
		});
	}

	sys() { return this.#sys; }
	cppVersion() { return this.#cppVersion; }

	executable(name, ...srcs) {
		const exec = new CppExecutable(this.#sys, {
			name, toolchain: this.#toolchain, cppVersion: this.#cppVersion
		});

		for (const src of srcs) {
			exec.add_src(src);
		}

		return exec;
	}

	library(name, version, ...srcs) {
		if (!isLibrootName(name)) {
			throw new Error(`Invalid cpp libroot name ${name}`);
		}

		const parsedVersion = semver.valid(version);
		if (!parsedVersion) {
			throw new Error(`Invalid version '${version}'`);
		}

		const lib = new CppLibrary(this.#sys, {
			name,
			version: parsedVersion,
			toolchain: this.#toolchain,
			cppVersion: this.#cppVersion
		});

		for (const src of srcs) {
			lib.add_src(src);
		}

		return lib;
	}

	require(name, version) {
		if (!isLibrootName(name)) {
			throw new Error(`Invalid cpp libroot name ${name}`);
		}

		const librootPath = process.env.CPP_LIBROOT_PATH;

		if (!librootPath) {
			throw new Error(`Environment variable CPP_LIBROOT_PATH not defined`);
		}

		const paths = librootPath.split(':');
		for (const root of paths) {
			const dir = path.resolve(root, name);
			if (fs.existsSync(dir)) {
				const versions = fs.readdirSync(dir);
				const latest = semver.minSatisfying(versions, `^${version}`);
				if (latest) {
					console.log(`Found ${name} (${latest})`);
					return new CppLibrootImport(this.#sys, {
						cpp: this,
						name,
						version,
						dir: path.join(dir, latest)
					});
				}
			}
		}

		throw new Error(`${name} (${version}) not found in CPP_LIBROOT_PATH`);
	}
}

module.exports = {
	CppSystem
};
