const { Library, majorVersion } = require('./library');
const { StaticPath } = require('../lib/pathTargets');

class Archive extends Library {
	#cpp;
	#objects;
	#name;
	#version;
	#includes;
	#defs;
	#libs;

	constructor(cpp, args) {
		super();
		this.#cpp = cpp;
		this.#objects = args.objects;
		this.#name = args.name;
		this.#version = args.version;
		this.#includes = args.includes;
		this.#defs = args.defs;
		this.#libs = args.libs;
	}

	name() {
		return this.#name;
	}

	version() {
		return this.#version;
	}

	type() {
		return 'static';
	}

	cppVersion() {
		return this.#cpp.cppVersion();
	}

	includes() {
		return this.#includes;
	}

	definitions() {
		return this.#defs;
	}

	isHeaderOnly() {
		return false;
	}

	deps() {
		return this.#libs;
	}

	binary() {
		const that = this;

		class ArchiveTarget extends StaticPath {
			constructor() {
				const sys = that.#cpp.sys();
				const nameUnder = that.name().replaceAll('.', '_');
				const version = majorVersion(that);
				const debug = that.#cpp.sys().isDebugBuild() ? '.debug' : '';
				const ext = that.#cpp.toolchain().archiveExt;
				const fname = `lib${nameUnder}.${version}${debug}.${ext}`;
				super(sys, sys.dest(fname));
			}

			deps() {
				return that.#objects;
			}

			build(cb) {
				console.log(`archiving ${this.path()}`);

				const args = {
					gulpCallback: cb,
					outputPath: this.abs(),
					objects: that.#objects.map(o => o.abs())
				};

				return that.#cpp.toolchain().archive(args);
			}
		}

		return new ArchiveTarget();
	}
}

module.exports = {
	Archive
};
