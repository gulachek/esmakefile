const { task } = require('gulp');
const { BuildSystem } = require('gulpachek');
const { Cpp } = require('gulpachek/cpp');

const sys = new BuildSystem(__dirname);
const cpp = new Cpp(sys);

const boost = {};
boost.log = cpp.require('org.boost.log', '1.78.0');

const hello = cpp.executable('hello',
	'src/hello.cpp'
);

hello.link(boost.log);

task('default', sys.rule(hello));
