const { Library, linkedLibrariesOf } = require('./library');
const { StaticPath } = require('../lib/pathTargets');

class Image extends Library {
	#cpp;
	#objects;
	#name;
	#version;
	#includes;
	#defs;
	#libs;
	#imageType;
	#filename;

	constructor(cpp, args) {
		super();
		this.#cpp = cpp;
		this.#imageType = args.imageType;
		this.#objects = args.objects;
		this.#name = args.name;
		this.#version = args.version;
		this.#includes = args.includes;
		this.#defs = args.defs;
		this.#libs = args.libs;
		this.#filename = args.filename;
	}

	name() {
		return this.#name;
	}

	version() {
		return this.#version;
	}

	type() {
		return 'dynamic';
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

		class ImageImpl extends StaticPath {
			#libs;

			libs() {
				if (!this.#libs) {
					this.#libs = [...linkedLibrariesOf(that, that.#cpp)];
				}

				return this.#libs;
			}

			constructor() {
				const cpp = that.#cpp;
				const sys = cpp.sys();
				super(sys, sys.dest(that.#filename));
			}

			deps() {
				const libObjs = this.libs().map(l => l.binary());
				return [...that.#objects, ...libObjs];
			}

			build(cb) {
				console.log(`linking ${this.path()}`);

				const args = {
					gulpCallback: cb,
					outputPath: this.abs(),
					isDebug: this.sys().isDebugBuild(),
					objects: [...that.#objects.map(o => o.abs())],
					libraries: [],
					type: that.#imageType
				};

				for (const lib of this.libs()) {
					const path = lib.binary().abs();
					const type = lib.type();
					args.libraries.push({ path, type });
				}

				return that.#cpp.toolchain().link(args);
			}
		}

		return new ImageImpl();
	}
}

module.exports = {
	Image
};
