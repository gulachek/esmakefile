const { task, series } = require('gulp');
const { BuildSystem } = require('gulpachek');
const { Cpp } = require('gulpachek/cpp');

const sys = new BuildSystem(__dirname);
const cpp = new Cpp(sys);

const boost = {};
boost.log = cpp.require('org.boost.log', '1.74.0');

const foo = cpp.library('com.example.foo', '0.1.0',
	'src/foo.cpp'
);

foo.include('include');
foo.link(boost.log);

const hello = cpp.executable('hello',
	'src/hello.cpp'
);

hello.link(foo);

task('default', series(sys.rule(hello)));
