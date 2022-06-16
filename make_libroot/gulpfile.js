const { task } = require('gulp');
const { BuildSystem } = require('gulpachek');
const { Cpp } = require('gulpachek/cpp');

const sys = new BuildSystem(__dirname);
const cpp = new Cpp(sys);

const boost = {
	log: cpp.require('org.boost.log', '1.78.0')
};

const lib = cpp.library('com.example.foo', '0.1.0',
	'foo.cpp'
);

lib.link(boost.log);
lib.include("include");

task('default', sys.rule(lib));

//const libroot = lib.libroot();
/*
 * above makes file at $GULPACHEK_INSTALL_ROOT/share/cpplibroot/<name>/<version>/lib.json
 *
 * {
 * 	"includes": ["$GULPACHEK_INSTALL_ROOT/include"]
 * 	"binaries": ["$GULPACHEK_INSTALL_ROOT/lib/libcom.example.foo_0.1.0.a"],
 * 	"deps": {
 *		"org.boost.log": "1.78.0"
 * 	}
 * }
 */
