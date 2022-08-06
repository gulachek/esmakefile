const { task } = require('gulp');
const { BuildSystem } = require('gulpachek');
const { CppSystem } = require('gulpachek/cpp');

const { foo } = require('./foo');

const sys = new BuildSystem(__dirname);
const cpp = new CppSystem({sys,
	cppVersion: 20
});

const hello = cpp.executable('hello',
	'hello.cpp',
);

const foolib = foo(cpp.sub('foo'));

hello.link(foolib);

task('default', sys.rule(hello));
