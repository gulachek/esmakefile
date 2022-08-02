const { Target } = require('./target');
const fs = require('fs');
const { src, dest } = require('gulp');

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
		return `${this.constructor.name}{${this.path()}}`;
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
		return src(`${this.#src.abs()}/**/*`)
			.pipe(dest(`${this.abs()}`));
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

	build() {
		const dir = this.sys().abs(this.path().dir());
		return src(`${this.#src.abs()}`)
			.pipe(dest(dir));
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
