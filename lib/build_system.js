const { FileSystem } = require('./fs.js');
const asyncDone = require('async-done');
const { Target } = require('./target');
const { StaticPath, PathTarget } = require('./pathTargets');

// can asyncDone handle this result? unfortunately dove into implementation
function asyncDoneable(result) {
	return typeof result.on === 'function'
	|| typeof result.subscribe === 'function'
	|| typeof result.then === 'function';
}

function makePromise() {
	let resolve, reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});

	return { promise, resolve, reject };
}

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
	#isDebug;
	#buildingTargets;

	constructor(passedOpts) {
		const defaults = {
			srcDir: require && require.main && require.main.path,
			fs: null,
			buildDir: 'build',
			isDebug: true
		};

		const opts = Object.assign(defaults, passedOpts);

		this.#isDebug = opts.isDebug;
		this.#buildingTargets = {};

		if (opts.fs) {
			this.#fs = opts.fs;
		}
		else {
			this.#fs = new FileSystem({
				src: opts.srcDir,
				build: opts.buildDir
			});
		}
	}

	isDebugBuild() {
		return this.#isDebug;
	}

	sub(srcDirName) {
		return new BuildSystem({
			fs: this.#fs.sub(srcDirName),
			isDebug: this.#isDebug
		});
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

	toTarget(t) {
		if (t instanceof Target) {
			return t;
		}

		if (typeof t.toTarget === 'function') {
			return t.toTarget();
		}

		return null;
	}

	#recursiveAsyncDone(work) {
		return new Promise((resolve, reject) => {
			const wrapCb = (err, result) => {
				if (err) reject(err);
				else resolve(this.#recursiveAsyncDone(result));
			};

			if (!work) {
				return resolve();
			}

			if (typeof work === 'function') {
				return asyncDone(work, wrapCb);
			}

			if (asyncDoneable(work)) {
				return asyncDone(() => work, wrapCb);
			}

			const t = this.toTarget(work);
			if (t) {
				return resolve(this.#buildTarget(t));
			}

			resolve();
		});
	}

	async #buildTargetMutex(t) {
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
			try {
				await this.#recursiveAsyncDone(t.build.bind(t));
			} catch (err) {
				err.message += `\nBuilding ${t}`;
				throw err;
			}
		}
	}

	async #buildTarget(t) {
		if (this.#buildingTargets[t]) {
			return this.#buildingTargets[t];
		}

		this.#buildingTargets[t] = this.#buildTargetMutex(t);
		try {
			await this.#buildingTargets[t];
		} finally {
			delete this.#buildingTargets[t];
		}
	}

	build(work) { return this.#recursiveAsyncDone(work); }

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
