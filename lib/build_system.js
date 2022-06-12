const { FileSystem } = require('./fs.js');
const fs = require('fs');
const asyncDone = require('async-done');

class Target {
	#sys;

	constructor(sys) {
		this.#sys = sys;
	}

	toString() {
		return this.constructor.name;
	}

	sys() { return this.#sys; }

	deps() { return null; }

	build() {
		return Promise.reject(new Error(
			`build() not implemented: ${this}`
		));
	}

	// Date object of mtime, null means out of date
	mtime() { return null; }
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
				cb(new Error('file does not exist'));
			}
		});
	}

	path() { return this.#path; }
}

function pathTarget(sys, p) {
	if (p instanceof Target) { return p; }
	return new StaticPath(sys, p);
}

function normalizeDeps(sys, t) {
	try {
		let deps = t.deps() || [];
		if (typeof deps[Symbol.iterator] !== 'function') {
			deps = [deps];
		}

		const depsArr = Array.from(deps);
		return depsArr.map((d) => { return pathTarget(sys, d); });
	} catch (e) {
		e.message += `\nGetting dependencies of ${t}`;
		throw e;
	}
}

function normalizeMtime(t) {
	try {
		return Math.floor(t.mtime() || Infinity);
	} catch (e) {
		e.message += `\nGetting mtime of ${t}`;
		throw e;
	}
}

class BuildSystem {
	#fs;

	constructor(gulpfileDirOrFs) {
		if (gulpfileDirOrFs instanceof FileSystem) {
			this.#fs = gulpfileDirOrFs;
		}
		else {
			this.#fs = new FileSystem({ src: gulpfileDirOrFs, build: 'build' });
		}
	}

	sub(srcDirName) {
		return new BuildSystem(this.#fs.sub(srcDirName));
	}

	abs(path) { 
		if (path instanceof Target) {
			return this.#fs.abs(path.path());
		}

		return this.#fs.abs(path);
	}

	// convert system path into a path object
	ext(absPath) {
		return pathTarget(this, this.#fs.ext(absPath));
	}

	src(path) {
		if (path instanceof Target) { return path; }
		return pathTarget(this, this.#fs.src(path));
	}

	dest(path) {
		if (path instanceof Target) { return path; }
		return pathTarget(this, this.#fs.dest(path));
	}

	cache(path, args) {
		return pathTarget(this, this.#fs.cache(path, args));
	}

	async #buildTarget(t) {
		const deps = normalizeDeps(this, t);
		const depTasks = [];
		for (const d of deps) {
			if (!(d instanceof Target)) {
				console.error('Invalid dependency', d);
				console.error('Building target', t);
				throw new Error('Invalid dependency');
			}
			depTasks.push(this.#buildTarget(d));
		}

		try {
			await Promise.all(depTasks);
		} catch (e) {
			e.message += `\nBuilding dependency of ${t}`;
			throw e;
		}

		const latestDep = Math.max(...deps.map(normalizeMtime));
		const selfMtime = normalizeMtime(t);

		if (!isFinite(selfMtime) || latestDep > selfMtime) {
			await new Promise((resolve, reject) => {
				asyncDone(t.build.bind(t), (err, result) => {
					if (err) {
						err.message += `\nBuilding ${t}`;
						reject(err);
						return;
					}

					resolve(result);
				});
			});
		}
	}

	rule(t) {
		const bound = this.#buildTarget.bind(this, t);
		Object.defineProperty(bound, 'name', {
			value: t.toString(),
			writable: false
		});
		return bound;
	}
}

module.exports = {
	pathTarget: pathTarget,
	BuildSystem: BuildSystem,
	Target: Target,
	StaticPath: StaticPath
};
