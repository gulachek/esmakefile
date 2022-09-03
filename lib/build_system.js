const { FileSystem } = require('./fs.js');
const asyncDone = require('async-done');
const { Target } = require('./target');
const { StaticPath, PathTarget } = require('./pathTargets');

function arrayDeps(sys, deps) {
	deps = deps || [];
	if (typeof deps[Symbol.iterator] !== 'function') {
		deps = [deps];
	}

	const depsArr = Array.from(deps);
	return depsArr.map(d => d instanceof Target ? d : sys.path(d));
}

function normalizeDeps(sys, t) {
	if (!(t instanceof Target)) {
		throw new Error(`${t} is not a Target`);
	}

	const deps = [];

	// get instance deps
	try {
		deps.push(...arrayDeps(sys, t.deps()));
	} catch (e) {
		e.message += `\nGetting dependencies of ${t}`;
		throw e;
	}

	// walk prototype chain to get implicit deps
	let ctor = t.constructor;

	while (ctor && ctor !== Target) {
		try {
			deps.push(...arrayDeps(sys, ctor.protoDeps(t)));
		} catch (e) {
			e.message += `\nGetting prototype dependencies of ${ctor.name}`;
			throw e;
		}

		ctor = Object.getPrototypeOf(ctor);
	}

	return deps;
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

	constructor(buildfileDirOrFs) {
		if (!buildfileDirOrFs && require && require.main) {
			buildfileDirOrFs = require.main.path;
		}

		if (buildfileDirOrFs instanceof FileSystem) {
			this.#fs = buildfileDirOrFs;
		}
		else {
			const build = process.env.GULPACHEK_BUILD_DIR || 'build';
			this.#fs = new FileSystem({ src: buildfileDirOrFs, build });
		}
	}

	isDebugBuild() {
		let type = process.env.GULPACHEK_BUILD_TYPE;
		if (!type) {
			return true;
		}

		type = type.toLowerCase();

		switch (type) {
			case 'debug':
				return true;
				break;
			case 'release':
				return false;
				break;
			default:
				throw new Error(`Invalid GULPACHEK_BUILD_TYPE '${type}'. Valid types: release/debug`);
		}
	}

	sub(srcDirName) {
		return new BuildSystem(this.#fs.sub(srcDirName));
	}

	abs(path) { 
		if (path instanceof PathTarget) {
			return this.#fs.abs(path.path());
		}

		return this.#fs.abs(path);
	}

	// convert system path into a path object
	ext(absPath) {
		return new StaticPath(this, this.#fs.ext(absPath));
	}

	install(path) {
		if (path instanceof PathTarget) {
			if (path.path().base !== 'install') {
				throw new Error(`${path} is not an install path`);
			}
			return path;
		}

		return new StaticPath(this, this.#fs.install(path));
	}

	src(path) {
		if (path instanceof PathTarget) { return path; }
		return new StaticPath(this, this.#fs.src(path));
	}

	dest(path) {
		if (path instanceof PathTarget) {
			if (!path.path().writable) {
				throw new Error(`${path} is not a writable path`);
			}
			return path;
		}

		return new StaticPath(this, this.#fs.dest(path));
	}

	cache(path, args) {
		let p = path;

		if (path instanceof PathTarget) {
			if (!path.path().cacherefable) {
				throw new Error(`${path} cannot be used to generate a cache path`);
			}

			p = path.path();
		}

		return new StaticPath(this, this.#fs.cache(p, args));
	}

	path(p) {
		if (typeof p === 'string') { return this.ext(p); }
		if (p instanceof PathTarget) { return p; }
		return new StaticPath(this, p);
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

	async build(t) { return this.#buildTarget(t); }

	rule(t) {
		const bound = this.#buildTarget.bind(this, t);
		Object.defineProperty(bound, 'name', {
			value: t.toString(),
			writable: false
		});
		return bound;
	}

	mtime(...paths) {
		const mtimes = paths.map((p) => {
			const t = this.path(p);
			return normalizeMtime(t);
		});

		return Math.max(...mtimes);
	}
}

module.exports = { BuildSystem };
