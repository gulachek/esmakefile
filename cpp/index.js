const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const semver = require('semver');

const { findToolchain } = require('./findToolchain');
const { Compilation } = require('./compilation');

const { StaticPath } = require('../lib/pathTargets');
const { Target } = require('../lib/target');
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
	toolchain() { return this.#toolchain; }

	compile(args) {
		return new Compilation(this, args);
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
					return new CppLibrootImport(this, {
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
