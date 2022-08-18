const { task } = require('gulp');
const { BuildSystem } = require('gulpachek');
const { CppSystem } = require('gulpachek/cpp');

const sys = new BuildSystem(__dirname);
const cpp = new CppSystem({sys,
	cppVersion: 17
});

const foo = cpp.compile({
	name: 'com.example.foo',
	version: '0.1.0',
	src: ['src/foo.cpp']
});

foo.include('include');

foo.define({
	FOO_PRIVATE: { implementation: '"private"' },
	FOO_PUBLIC: '"public"',
	FOO_API: { implementation: 'EXPORT', interface: 'IMPORT' }
});

task('install', (cb) => {
	const libroot = foo.libroot();
	const rule = sys.rule(libroot);
	return rule(cb);
});
