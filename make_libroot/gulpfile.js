const { task, series } = require('gulp');
const { BuildSystem } = require('gulpachek');
const { CppSystem } = require('gulpachek/cpp');

const sys = new BuildSystem(__dirname);
const cpp = new CppSystem({
	sys,
	cppVersion: 20
});

const boost = {
	log: cpp.require('org.boost.log', '1.78.0')
};

const lib = cpp.compile({
	name: 'com.example.foo',
	version: '0.1.0',
	src: ['foo.cpp']
});

lib.link(boost.log);
lib.include("include");

const libroot = lib.libroot();

process.env.CPP_LIBROOT_PATH =
	`${process.env.GULPACHEK_INSTALL_ROOT_CPPLIBROOT}:${process.env.CPP_LIBROOT_PATH}`;

const postInstall = (cb) => {
	const foo = cpp.require('com.example.foo', '0.1.0');

	const hello = cpp.compile({
		name: 'hello',
		src: ['hello.cpp']
	});

	hello.link(foo);

	const rule = sys.rule(hello.executable());
	return rule(cb);
};

task('default', series(sys.rule(libroot), postInstall));
