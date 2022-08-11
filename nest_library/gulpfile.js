const { task } = require('gulp');
const { BuildSystem, Target } = require('gulpachek');
const { CppSystem } = require('gulpachek/cpp');
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');

const sys = new BuildSystem(__dirname);
const cpp = new CppSystem({sys,
	cppVersion: 20
});

const librootPath = process.env.GULPACHEK_INSTALL_ROOT_CPPLIBROOT ||
	sys.dest('cpplibroot').abs();

class NpxTarget extends Target {
	#npxArgs;
	#outputPaths;
	#spawnOpts;

	constructor(sys, opts) {
		super(sys);
		this.#npxArgs = opts.args;
		this.#outputPaths = opts.outputPaths;
		this.#spawnOpts = opts.spawnOpts;
	}

	// as old as the newest output file
	mtime() {
		return  this.#outputPaths && this.sys().mtime(...this.#outputPaths);
    }

	build() {
		const npx = os.platform() === 'win32' ? 'npx.cmd' : 'npx';
		return spawn(npx, this.#npxArgs, this.#spawnOpts);
    }
}

class HelloTarget extends Target {
	#foo;

	constructor(sys) {
		super(sys);
		this.#foo = new NpxTarget(sys, {
			args: ['gulp', 'install'],
			outputPaths: [path.join(librootPath, 'com.example.foo')],
			spawnOpts: {
				cwd: sys.src('foo').abs(),
				stdio: 'inherit',
				env: {
					...process.env,
					GULPACHEK_BUILD_DIR: sys.dest('foo').abs(),
					GULPACHEK_INSTALL_ROOT_INCLUDE: sys.dest('include').abs(),
					GULPACHEK_INSTALL_ROOT_LIB: sys.dest('lib').abs(),
					GULPACHEK_INSTALL_ROOT_CPPLIBROOT: librootPath
				}
			}
		});
	}

	deps() { return [this.#foo]; }

	build(cb) {
		process.env.CPP_LIBROOT_PATH = librootPath;

		const foo = cpp.require('com.example.foo', '0.1.0');

		const hello = cpp.compile({
			name: 'hello',
			src: ['hello.cpp'],
		});

		hello.link(foo);

		return sys.rule(hello.executable())(cb);
	}
}

const hello = new HelloTarget(sys);
task('default', sys.rule(hello));
