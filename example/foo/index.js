function foo(cpp) {
	const lib = cpp.compile({
		name: 'com.example.foo',
		version: '0.1.0',
		src: [ 'src/foo.cpp' ]
	});

	lib.include('include');

	lib.define({
		FOO_DEFAULT_DEFINE: 'default',
		FOO_DEFINE: {
			implementation: 'implementation',
			interface: 'interface'
		},
		FOO_API: {
			implementation: 'EXPORT',
			interface: 'IMPORT'
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
