const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { findToolchain } = require('./findToolchain');
const { Compilation } = require('./compilation');
const { Library } = require('./library');
const { CppLibrootImport, LibrootPackage } = require('./libroot');

const { StaticPath } = require('../lib/pathTargets');
const { Target } = require('../lib/target');
const { BuildSystem } = require('../lib/build_system');

const { Command } = require('commander');

class CppSystem {
	#sys;
	#cppVersion;
	#toolchain;
	#isStaticLink;

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
		this.#isStaticLink = args.isStaticLink;
	}

	sub(dir) {
		return new CppSystem({
			sys: this.#sys.sub(dir),
			cppVersion: this.#cppVersion,
			toolchain: this.#toolchain,
			isStaticLink: this.#isStaticLink
		});
	}

	sys() { return this.#sys; }
	cppVersion() { return this.#cppVersion; }
	linkType() { return this.#isStaticLink ? 'static' : 'dynamic'; }
	toolchain() { return this.#toolchain; }

	compile(args) {
		return new Compilation(this, args);
	}

	require(name, version, type) {
		type = type || (this.#isStaticLink ? 'static' : 'dynamic');
		return new CppLibrootImport(this, { name, version, type });
	}

	/*
	 * Package library in a build directory
	 *
	 * dir/<libroot>.json
	 * dir/<binary>
	 * dir/<include>
	 */
	pack(lib, args) {
		return new LibrootPackage(this, lib, args);
	}

	toLibrary(obj) {
		if (obj instanceof Library) return obj;

		if (typeof obj.toLibrary === 'function') {
			return obj.toLibrary({ isStaticLink: this.#isStaticLink });
		}

		throw new Error(`${obj} cannot be converted to a Library`);
	}
}

class CppBuildCommand
{
	#program;
	#cppVersion;

	constructor(args) {
		const { program, cppVersion } = args;
		this.#program = program;
		this.#cppVersion = cppVersion;
	}

	#configure(args) {
		const { isDebug, isStaticLink } = args;
		const sys = new BuildSystem({ isDebug });
		const cpp = new CppSystem({
			sys,
			isStaticLink,
			cppVersion: this.#cppVersion
		});

		return { sys, cpp };
	}

	configure(command, fTarget) {
		return command
		.option('--release', 'release build (default debug)')
		.option('--static-link', 'static linkage (default dynamic)')
		.action((opts) => {
			const { sys, cpp } = this.#configure({
				isDebug: !opts.release,
				isStaticLink: opts.staticLink
			});

			const target = fTarget({ sys, cpp, opts });

			return sys.build(target);
		});
	}

	build(fTarget) {
		const command = this.#program.command('build')
		.description('build binaries');
		return this.configure(command, fTarget);
	}

	pack(fLib) {
		this.#program.command('pack')
		.requiredOption('--target-platform <platform>', 'posix or win32')
		.requiredOption('--target-include-dir <include>', 'where to install headers on target system')
		.requiredOption('--target-lib-dir <lib>', 'where to install libraries on target system')
		.action(async (opts) => {

			const tf = [true, false];

			for (const isDebug of tf) {
				for (const isStaticLink of tf) {
					const { sys, cpp } = this.#configure({ isDebug, isStaticLink });

					const lib = cpp.toLibrary(fLib({ sys, cpp }));

					await sys.build(cpp.pack(lib, { target: {
						platform: opts.targetPlatform,
						includeDir: opts.targetIncludeDir,
						libDir: opts.targetLibDir
					}}));
				}
			}
		});
	}
}

module.exports = {
	CppSystem,
	CppBuildCommand
};
