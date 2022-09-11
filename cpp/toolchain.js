class Toolchain {
	#stub(msg) {
		throw new Error(`Not implemented: ${this.constructor.name}.${msg}`);
	}

	get objectExt() { return 'o'; }
	get archiveExt() { return 'a'; }
	get executableExt() { return ''; }
	get dynamicLibExt() { return 'so'; }
	get importDef() { return ''; }
	get exportDef() { return '__attribute__((visibility("default")))'; }
	get dynamicLibraryIsLinked() { return true; }

	/*
	 * Compile a c++ source file to an object file
	 * gulpCallback: Function (gulp task completion callback)
	 * cppVersion: number (11 for c++11, 14 for c++14, etc)
	 * depfilePath: string (path to generated header dependencies to be parsed by toolchain)
	 * outputPath: string (path to generated object file)
	 * srcPath: string (path to c++ source)
	 * isDebug: boolean (debug vs release build)
	 * includes: string[]? (paths to directories that should be included in search path)
	 * definitions: iterable [(key)string, (val)string]
	 */
	compile(args) {
		this.#stub('compile');
	}

	/*
	 * Archive objects into a static library
	 * gulpCallback: Function (gulp task completion callback)
	 * outputPath: string (path to generated archive)
	 * objects: string[] (paths to object files to archive)
	 */
	archive(args) {
		this.#stub('archive');
	}

	/*
	 * Link objects and libraries into image
	 * gulpCallback: Function (gulp task completion callback)
	 * outputPath: string (path to generated executable)
	 * objects: string[] (paths to object files for image)
	 * isDebug: boolean (debug vs release build)
	 * libraries: { path, type: 'static'|'dynamic' }[] (libraries)
	 * type: 'executable'|'dynamicLib' (type of image)
	 *
	 */
	link(args) {
		this.#stub('link');
	}

	/*
	 * Iterate depfile entries generated at compile time
	 * path: string (path to depfile)
	 */
	depfileEntries(path) {
		this.#stub('depfileEntries');
	}

	/*
	 * Helper files for binary to package (iterable path targets)
	 * lib: Library
	 */
	binaryPackHelpers(lib) {
		return [];
    }
}

module.exports = {
	Toolchain
};
