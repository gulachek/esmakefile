const { task, series } = require('gulp');
const { BuildSystem } = require('gulpachek');
const { CppSystem } = require('gulpachek/cpp');

const sys = new BuildSystem(__dirname);
const cpp = new CppSystem({sys,
	cppVersion: 20
});

const boost = {};
boost.log = cpp.require('org.boost.log', '1.74.0');

const foo = cpp.compile({
	name: 'com.example.foo',
	version: '0.1.0',
	src: ['src/foo.cpp']
});

foo.define({
	FOO_API: { interface: 'IMPORT', implementation: 'EXPORT' }
});

foo.include('include');
foo.link(boost.log, { type: 'dynamic' });

const hello = cpp.compile({
	name: 'hello',
	src: ['src/hello.cpp']
});

hello.link(foo, { type: 'dynamic' });

task('default', series(sys.rule(hello.executable())));
