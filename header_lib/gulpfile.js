const { task } = require('gulp');
const { BuildSystem } = require('gulpachek');
const { CppSystem } = require('gulpachek/cpp');

const sys = new BuildSystem(__dirname);
const cpp = new CppSystem({
	sys,
	cppVersion: 20
});

const dep = cpp.compile({
	name: 'com.example.dep',
	version: '0.1.0',
	apiDef: 'DEP_API',
	src: ['foo/dep.cpp']
});

dep.include('foo/include');

const foo = cpp.compile({
	name: 'com.example.foo',
	version: '0.1.0',
	apiDef: 'FOO_API'
});

foo.include('foo/include');
foo.link(dep.image());

const hello = cpp.compile({
	name: 'hello',
	src: ['hello.cpp']
});

hello.link(foo.headers());

task('default', sys.rule(hello.executable()));
