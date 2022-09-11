const { Target } = require('./target');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');

class MakeDirTarget extends Target {
	#path;

	constructor(sys, path) {
		super(sys);
		this.#path = path;
	}

	build(cb) {
		return fs.mkdir(this.abs(), { recursive: true }, cb);
	}

	toString() {
		return `${this.constructor.name}{${this.#path}}`;
	}

	mtime() {
		const abs = this.abs();
		if (!fs.existsSync(abs)) { return null; }
		return -Infinity;
	}

	abs() { return this.sys().abs(this.#path); }
}

class PathTarget extends Target {
	constructor(sys) {
		super(sys);
	}

	toString() {
		return `${this.constructor.name}{${this.path()}}`;
	}

	mtime() {
		const abs = this.abs();
		if (!fs.existsSync(abs)) { return null; }
		return fs.statSync(this.abs()).mtime;
	}

	path() { return null; }
	abs() { return this.sys().abs(this.path()); }

	static protoDeps(t) {
		const p = t.path();
		if (p && p.writable) {
			return [new MakeDirTarget(t.sys(), p.dir())];
		}

		return null;
	}
}

class StaticPath extends PathTarget {
	#path;

	constructor(sys, path) {
		if (path instanceof PathTarget) {
			path = path.path();
		}

		if (typeof path === 'string') {
			throw new Error(`StaticPath only accepts path objects: ${path}`);
		}

		super(sys);
		this.#path = path;
	}

	build(cb) {
		const path = this.abs();
		fs.exists(path, (exists) => {
			if (exists) {
				cb();
			} else {
				cb(new Error(`file does not exist: ${path}`));
			}
		});
	}

	path() { return this.#path; }

	join(...children) {
		return new StaticPath(this.sys(), this.#path.join(...children));
	}
}

class CopyDirTarget extends StaticPath {
	#src;

	constructor(sys, from, to) {
		super(sys, sys.dest(to));
		this.#src = sys.src(from);
	}

	deps() {
		return this.#src;
	}

	// always out of date
	mtime() { return null; }

	build() {
		console.log(`(dir) ${this.#src.path()} -> ${this.path()}`);
		if (os.platform() === 'win32') {
			return spawn('xcopy', ['/EIQHY', this.#src.abs(), this.abs()]);
		} else {
			const dir = this.sys().abs(this.path().dir());
			return spawn('cp', ['-R', this.#src.abs(), dir]);
		}
	}
}

class CopyFileTarget extends StaticPath {
	#src;

	constructor(sys, from, to) {
		const fromPath = sys.src(from);
		const toPath = sys.dest(to).path().join(fromPath.path().basename());
		super(sys, toPath);
		this.#src = fromPath;
	}

	deps() {
		return this.#src;
	}

	build(cb) {
		console.log(`(file) ${this.#src.path()} -> ${this.path()}`);
		fs.copyFile(this.#src.abs(), this.abs(), cb);
	}
}

function copyDir(sys, from, to) {
	return new CopyDirTarget(sys, from, to);
}

function copyFile(sys, from, to) {
	return new CopyFileTarget(sys, from, to);
}

module.exports = {
	PathTarget,
	StaticPath,
	copyDir,
	copyFile
};
