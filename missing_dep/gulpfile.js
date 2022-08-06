const { task } = require('gulp');
const { BuildSystem } = require('gulpachek');
const { CppSystem } = require('gulpachek/cpp');

const sys = new BuildSystem(__dirname);
const cpp = new CppSystem({
	sys,
	cppVersion: 20
});

const exec = cpp.executable('hello', 'does_not_exist.cpp');

task('default', sys.rule(exec));
