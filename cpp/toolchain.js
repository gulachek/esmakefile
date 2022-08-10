class Toolchain {
	#stub(msg) {
		throw new Error(`Not implemented: ${this.constructor.name}.${msg}`);
	}

	get objectExt() { return 'o'; }
	get archiveExt() { return 'a'; }
	get executableExt() { return ''; }

	/*
	 * Compile a c++ source file to an object file
	 * gulpCallback: Function (gulp task completion callback)
	 * cppVersion: number (11 for c++11, 14 for c++14, etc)
	 * depfilePath: string (path to generated header dependencies to be parsed by toolchain)
	 * outputPath: string (path to generated object file)
	 * srcPath: string (path to c++ source)
	 * isDebug: boolean (debug vs release build)
	 * includes: string[]? (paths to directories that should be included in search path)
	 * definitions: { [string]: string } compiler definitions
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
	 * Link objects and libraries into executable
	 * gulpCallback: Function (gulp task completion callback)
	 * outputPath: string (path to generated executable)
	 * objects: string[] (paths to object files and libraries)
	 * isDebug: boolean (debug vs release build)
	 */
	linkExecutable(args) {
		this.#stub('linkExecutable');
	}

	/*
	 * Iterate depfile entries generated at compile time
	 * path: string (path to depfile)
	 */
	depfileEntries(path) {
		this.#stub('depfileEntries');
	}
}

module.exports = {
	Toolchain
};
