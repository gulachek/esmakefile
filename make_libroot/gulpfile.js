const { task, series } = require('gulp');
const { BuildSystem } = require('gulpachek');
const { Cpp } = require('gulpachek/cpp');

const sys = new BuildSystem(__dirname);
const cpp = new Cpp(sys);

const boost = {
	log: cpp.require('org.boost.log', '1.78.0')
};

const lib = cpp.library('com.example.foo', '0.1.0',
	'foo.cpp'
);

lib.link(boost.log);
lib.include("include");

const libroot = lib.libroot();

process.env.CPP_LIBROOT_PATH =
	`${process.env.GULPACHEK_INSTALL_ROOT}/share/cpplibroot:${process.env.CPP_LIBROOT_PATH}`;

const postInstall = (cb) => {
	const foo = cpp.require('com.example.foo', '0.1.0');

	const hello = cpp.executable('hello',
		'hello.cpp'
	);

	hello.link(foo);

	const rule = sys.rule(hello);
	return rule(cb);
};

task('default', series(sys.rule(libroot), postInstall));
