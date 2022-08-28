const { task, series } = require('gulp');
const { BuildSystem } = require('gulpachek');
const { CppSystem } = require('gulpachek/cpp');

const sys = new BuildSystem(__dirname);
const cpp = new CppSystem({sys,
	cppVersion: 20
});

const boost = {};
boost.log = cpp.require('org.boost.log', '1.74.0', 'static');

const foo = cpp.compile({
	name: 'com.example.foo',
	version: '0.1.0',
	apiDef: 'FOO_API',
	src: ['src/foo.cpp']
});

foo.include('include');
foo.link(boost.log);

const hello = cpp.compile({
	name: 'hello',
	src: ['src/hello.cpp']
});

hello.link(foo.image());

task('default', series(sys.rule(hello.executable())));
