const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const semver = require('semver');
const { pathTarget, BuildSystem, StaticPath, Target } = require('../lib/build_system.js');

// testing with clang, generates invalid makefile w/ ':' in src file name
// based on that, assume ':' clearly delimits end of target name,
// no escaping necessary.
//
// based on section 3.8 https://www.gnu.org/software/make/manual/make.html,
// make parses logical lines which has backslash/newline converted to space
//
// then each dependency is separated by a space. testing with clang, if an
// included file contains a space, it will escape it. make handles this
// correctly, so need to account for "\ " in file names.
//
// it looks like the c/c++ standards don't like #include w/ backslash in
// name (take that, windows). assume that we don't have to worry about
// escaping '\' in generated depfile. Make treats this weird anyway with
// seemingly complex rules instead of '\' always being an escape character.
// Sigh.
//
function* depfileEntries(path) {
	let contents = fs.readFileSync(path, { encoding: 'utf8' });

	// handle escaped new lines for logical line
	contents = contents.replace("\\\n", " ");

	let index = contents.indexOf(': ');
	if (index === -1) {
		throw new Error(`expected target to end with ': ' in depfile '${path}'`);
	}

	index += 2; // due to ': '

	for (let fstart = NaN; index < contents.length; ++index) {
		if (contents[index].match(/\s/)) {
			if (fstart) {
				yield contents.slice(fstart, index)
					.replace("\\ ", " ");
				fstart = NaN;
			}
		}
		// let's just assume all \ is escape. make is weird about this
		// so technically wrong but who cares
		else if (contents[index] === '\\') {
			++index;
		}
		else if (!fstart) {
			fstart = index;
		}
	}
}

class ClangDepfile extends Target {
	#path;

	constructor(sys, path) {
		super(sys);
		this.#path = path;
	}

	build() {
		return Promise.resolve();
	}

	toString() {
		return `ClangDepfile{${this.abs()}}`;
	}

	abs() {
		return this.sys().abs(this.#path);
	}

	mtime() {
		const zero = new Date(0);
		const path = this.abs();
		if (!fs.existsSync(path)) return zero; // nothing to depend on

		let maxAge = zero;
		for (const f of depfileEntries(path)) {
			const age = fs.statSync(f).mtime;
			maxAge = maxAge < age ? age : maxAge;
		}

		return maxAge;
	}
}

class ClangObject extends StaticPath {
	#src;
	#includes;
	#libs;
	#depfile;

	constructor(sys, args) {
		const src = sys.src(args.src);
		super(sys, sys.cache(src.path(), {
			namespace: 'com.gulachek.clang.cpp.obj',
			ext: 'o'
		}));
		this.#src = src;
		this.#includes = [];
		this.#libs = [];

		this.#depfile = new ClangDepfile(sys, sys.cache(src.path(), {
			namespace: 'com.gulachek.clang.cpp.obj',
			ext: 'd'
		}));
	}

	include(dir) {
		this.#includes.push(this.sys().src(dir));
	}

	link(lib) {
		this.#libs.push(lib);
	}

	deps() {
		return [this.#src, ...this.#includes, this.#depfile];
	}

	build() {
		console.log(`compiling ${this.path()}`);
		const args = [
			'--std=c++20',
			'-MD', '-MF', this.#depfile.abs(),
			'-o', this.abs(),
			'-c', this.#src.abs()
		];

		for (const i of this.#includes) {
			args.push('-I');
			args.push(i.abs());
		}

		for (const lib of this.#libs) {
			for (const i of lib.includes()) {
				args.push('-I');
				args.push(i.abs());
			}
		}

		return spawn('c++', args, { stdio: 'inherit' });
	}
}

class CppObjectGroup extends Target {
	#objects;
	#includes;
	#libs;

	constructor(sys) {
		super(sys);
		this.#objects = [];
		this.#includes = [];
		this.#libs = [];
	}

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
		const o = new ClangObject(this.sys(), { src: src });

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

class CppExecutable extends StaticPath {
	#objects;
	#libs;

	constructor(sys, args) {
		super(sys, sys.dest(args.dest));
		this.#objects = new CppObjectGroup(sys);
		this.#libs = [];
	}

	add_src(src) {
		this.#objects.add_src(src);
	}

	link(lib) {
		this.#libs.push(lib);
		this.#objects.link(lib);
	}

	include(dir) {
		this.#objects.include(dir);
	}

	deps() {
		const deps = [this.#objects];

		for (const lib of this.#libs) {
			for (const bin of lib.binaries()) {
				deps.push(bin);
			}
		}

		return deps;
	}

	build() {
		console.log(`linking ${this.path()}`);

		const args = [
			'-o', this.abs()
		];

		for (const obj of this.#objects) {
			args.push(obj.abs());
		}

		for (const lib of this.#libs) {
			for (const bin of lib.binaries()) {
				args.push(bin.abs());
			}
		}

		return spawn('c++', args, { stdio: 'inherit' });
	}
}

class CppLibrary extends StaticPath {
	#objects;
	#includes;
	#libs;

	constructor(sys, args) {
		super(sys, sys.dest(args.dest));
		this.#objects = new CppObjectGroup(sys);
		this.#includes = [];
		this.#libs = [];
	}

	add_src(src) {
		this.#objects.add_src(src);
	}

	link(lib) {
		this.#libs.push(lib);
		this.#objects.link(lib);
	}

	include(dir) {
		const dirpath = this.sys().src(dir);

		this.#includes.push(dirpath);
		this.#objects.include(dirpath);
	}

	includes() { return this.#includes; }
	binaries() { return [this]; }

	deps() {
		const deps = [this.#objects];

		for (const lib of this.#libs) {
			for (const bin of lib.binaries()) {
				deps.push(bin);
			}
		}

		return deps;
	}

	build() {
		console.log(`linking ${this.path()}`);

		const args = [
			'-static',
			'-o', this.abs()
		];

		for (const obj of this.#objects) {
			args.push(obj.abs());
		}

		for (const lib of this.#libs) {
			for (const bin of lib.binaries()) {
				args.push(bin.abs());
			}
		}

		return spawn('libtool', args, { stdio: 'inherit' });
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

	constructor(sys, args) {
		super(sys);

		this.#name = args.name;
		this.#version = args.version;
		this.#dir = args.dir;
		this.#config = JSON.parse(fs.readFileSync(
			path.resolve(this.#dir, 'lib.json'),
			{ encoding: 'utf8' }
		));

		this.#deps = {};

		this.#searchDeps('deps', { include: true, binary: false });
		this.#searchDeps('leaky-deps', { include: true, binary: true });
		this.#searchDeps('leaky-bin-deps', { include: false, binary: true });
	}

	toString() {
		return `${this.constructor.name}{${this.#name} (${this.#version})}`;
	}

	#searchDeps(key, traits)
	{
		for (const dep in this.#config[key]) {
			if (this.#deps[dep]) {
				throw new Error(`${dep} can only be specified as depencency once`);
			}

			const cpp = new Cpp(this.sys());
			const version = this.#config[key][dep];
			const lib = cpp.require(dep, version);
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

class Cpp {
	#sys;

	constructor(sys) {
		this.#sys = sys;
	}

	executable(name, ...srcs) {
		const exec = new CppExecutable(this.#sys, { dest: name });

		for (const src of srcs) {
			exec.add_src(src);
		}

		return exec;
	}

	library(fname, ...srcs) {
		const lib = new CppLibrary(this.#sys, { dest: fname });

		for (const src of srcs) {
			lib.add_src(src);
		}

		return lib;
	}

	require(name, version) {
		if (!/^[a-z][a-z0-9-]+(\.[a-z][a-z0-9-]+)+$/.test(name)) {
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
						name,
						version,
						dir: path.join(dir, latest)
					});
				}
			}
		}

		throw new Error(`${name} (${semverRange}) not found in CPP_LIBROOT_PATH`);
	}
}

module.exports = {
	Cpp: Cpp
};
