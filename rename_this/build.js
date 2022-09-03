const { BuildSystem } = require('gulpachek');
const { CppSystem } = require('gulpachek/cpp');

const sys = new BuildSystem(__dirname);
const cpp = new CppSystem({
	sys,
	cppVersion: 20
});

const lib = cpp.compile({
	name: 'com.example.foo',
	version: '0.1.0',
	apiDef: 'FOO_API',
	src: [
		'foo.cpp'
	]
});

lib.include('include');

const image = lib.image();

const test = cpp.compile({
	name: `hello`,
	src: [`hello.cpp`]
});

test.link(image);

sys.build(test.executable());
