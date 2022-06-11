const { spawn } = require('child_process');
const fs = require('fs');
const { pathTarget, BuildSystem, StaticPath, Target } = require('../lib/build_system.js');

class ClangDepfile extends Target {
	#path;

	constructor(sys, path) {
		super(sys);
		this.#path = path;
	}

	abs() {
		return this.sys().abs(this.#path);
	}

	age() {
		const zero = new Date(0);
		const path = this.abs();
		if (!fs.existsSync(path)) return zero; // nothing to depend on

		const contents = fs.readFileSync(path, { encoding: 'utf8' });
		const lines = contents.split("\n");
		let maxAge = zero;
		for (let i = 1; i < lines.length - 1; i++) {
			const line = lines[i];
			const start = 2;
			let end = line.length - 2;

			if (i == lines.length - 2)
				end += 2;

			const f = line.slice(start, end);
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
		console.log('compiling', this.path().abs());
		const args = [
			'--std=c++20',
			'-MD', '-MF', this.#depfile.abs(),
			'-o', this.path().abs(),
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
	age() {
		return Math.max(...this.#objects.map((o) => { return o.age(); }));
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

	deps() { return [this.#objects, ...this.#libs]; }

	build() {
		console.log('linking', this.path().abs());

		const args = [
			'-o', this.path().abs()
		];

		for (const obj of this.#objects) {
			args.push(obj.path().abs());
		}

		for (const lib of this.#libs) {
			args.push(lib.path().abs());
		}

		return spawn('c++', args, { stdio: 'inherit' });
	}
}

class CppLibrary extends StaticPath {
	#objects;
	#includes;

	constructor(sys, args) {
		super(sys, sys.dest(args.dest));
		this.#objects = new CppObjectGroup(sys);
		this.#includes = [];
	}

	add_src(src) {
		this.#objects.add_src(src);
	}

	include(dir) {
		const dirpath = this.sys().src(dir);

		this.#includes.push(dirpath);
		this.#objects.include(dirpath);
	}

	includes() { return this.#includes; }

	deps() { return this.#objects; }

	build() {
		console.log('linking', this.path().abs());

		const args = [
			'-static',
			'-o', this.path().abs()
		];

		for (const obj of this.#objects) {
			args.push(obj.path().abs());
		}

		return spawn('libtool', args, { stdio: 'inherit' });
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
}

module.exports = {
	Cpp: Cpp
};
