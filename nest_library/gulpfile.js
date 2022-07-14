const { task } = require('gulp');
const { BuildSystem, Target } = require('gulpachek');
const { Cpp } = require('gulpachek/cpp');
const { spawn } = require('child_process');

const sys = new BuildSystem(__dirname);
const cpp = new Cpp(sys);

const librootPath = process.env.GULPACHEK_INSTALL_ROOT_CPPLIBROOT ||
	sys.dest('cpplibroot').abs();

class FooTarget extends Target {
	constructor(sys) {
		super(sys);
	}

	build() {
		return spawn('npx', ['gulp', 'install'], {
			cwd: sys.src('foo').abs(),
			stdio: 'inherit',
			env: { ...process.env,
				GULPACHEK_BUILD_DIR: sys.dest('foo').abs(),
				GULPACHEK_INSTALL_ROOT_INCLUDE: sys.dest('include').abs(),
				GULPACHEK_INSTALL_ROOT_LIB: sys.dest('lib').abs(),
				GULPACHEK_INSTALL_ROOT_CPPLIBROOT: librootPath
		}});
	}
}

class HelloTarget extends Target {
	constructor(sys) {
		super(sys);
	}

	deps() { return [new FooTarget()]; }

	build(cb) {
		process.env.CPP_LIBROOT_PATH = librootPath;

		const foo = cpp.require('com.example.foo', '0.1.0');

		const hello = cpp.executable('hello',
			'hello.cpp',
		);

		hello.link(foo);

		return sys.rule(hello)(cb);
	}
}

const hello = new HelloTarget();
task('default', sys.rule(hello));
