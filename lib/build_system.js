const { FileSystem } = require('./fs.js');
const fs = require('fs');
const asyncDone = require('async-done');

class Target {
	#sys;

	constructor(sys) {
		this.#sys = sys;
	}

	sys() { return this.#sys; }

	deps() { return null; }
	build() { return Promise.resolve(); }

	// Date object of mtime
	age() { return null; }
}

class PathTarget extends Target {
	constructor(sys) {
		super(sys);
	}

	age() {
		const abs = this.abs();
		if (!fs.existsSync(abs)) { return NaN }
		return fs.statSync(this.abs()).mtime;
	}

	path() { return null; }
	abs() { return this.sys().abs(this.path()); }
}

class StaticPath extends PathTarget {
	#path;

	constructor(sys, path) {
		super(sys);
		this.#path = path;
	}

	path() { return this.#path; }
}

function pathTarget(sys, p) {
	if (p instanceof Target) { return p; }
	return new StaticPath(sys, p);
}

function normalizeDeps(sys, t) {
	let deps = t.deps() || [];
	if (typeof deps[Symbol.iterator] !== 'function') {
		deps = [deps];
	}

	const depsArr = Array.from(deps);
	return depsArr.map((d) => { return pathTarget(sys, d); });
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

		await Promise.all(depTasks);

		const latestDep = Math.max(...deps.map((d) => { return Math.floor(d.age()); }));
		if (isNaN(latestDep)) {
			throw new Error('Failed to build dependencies');
		}

		const age = Math.floor(t.age());
		if (isNaN(age) || latestDep > age) {
			await new Promise((resolve, reject) => {
				asyncDone(t.build.bind(t), (err, result) => {
					if (err) {
						reject(err);
						return;
					}

					resolve(result);
				});
			});
		}
	}

	rule(t) { return this.#buildTarget.bind(this, t); }
}

module.exports = {
	pathTarget: pathTarget,
	BuildSystem: BuildSystem,
	Target: Target,
	StaticPath: StaticPath
};
