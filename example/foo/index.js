function foo(cpp) {
	const lib = cpp.library(
		'com.example.foo', '0.1.0',
		'src/foo.cpp'
	);

	lib.include('include');

	lib.define({
		FOO_DEFAULT_DEFINE: 'default',
		FOO_DEFINE: {
			implementation: 'implementation',
			interface: 'interface'
		}
	});

	// make sure we don't require install paths to be defined
	// simply to reference this
	const libroot = lib.libroot();

	return lib;
}

module.exports = {
	foo
};
