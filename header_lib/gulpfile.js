const { task } = require('gulp');
const { BuildSystem } = require('gulpachek');
const { Cpp } = require('gulpachek/cpp');

const { foo } = require('./foo');

const sys = new BuildSystem(__dirname);
const cpp = new Cpp(sys);

const hello = cpp.executable('hello',
	'hello.cpp',
);

const foolib = foo(sys.sub('foo'));

hello.link(foolib);

task('default', sys.rule(hello));
