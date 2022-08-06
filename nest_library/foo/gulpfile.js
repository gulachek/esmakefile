const { task } = require('gulp');
const { BuildSystem } = require('gulpachek');
const { CppSystem } = require('gulpachek/cpp');

const sys = new BuildSystem(__dirname);
const cpp = new CppSystem({sys,
	cppVersion: 17
});

const foo = cpp.library(
	'com.example.foo', '0.1.0',
	'src/foo.cpp'
);

foo.include('include');

task('install', (cb) => {
	const libroot = foo.libroot();
	const rule = sys.rule(libroot);
	return rule(cb);
});
