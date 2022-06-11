const { Cpp } = require('gulpachek/cpp');

function foo(sys) {
	const cpp = new Cpp(sys.sub(__dirname));

	const lib = cpp.library(
		'libfoo.a',
		'src/foo.cpp'
	);

	lib.include('include');

	return lib;
}

module.exports = {
	foo: foo
};
