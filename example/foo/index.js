const { Cpp } = require('gulpachek/cpp');

function foo(sys) {
	const cpp = new Cpp(sys);
	const lib = cpp.library(
		'com.example.foo', '0.1.0',
		'src/foo.cpp'
	);

	lib.include('include');

	return lib;
}

module.exports = {
	foo
};
