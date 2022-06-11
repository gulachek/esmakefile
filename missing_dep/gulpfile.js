const { task } = require('gulp');
const { BuildSystem } = require('gulpachek');
const { Cpp } = require('gulpachek/cpp');

const sys = new BuildSystem(__dirname);
const cpp = new Cpp(sys);

const exec = cpp.executable('hello', 'does_not_exist.cpp');

task('default', sys.rule(exec));
