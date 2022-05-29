export class FileSystem {
	#build;
	#path;
	#src;
	#cache;

	constructor(args) {
		const path = args.path;

		this.#path = args.path;
		this.#build = path.resolve(args.build);
		this.#src = path.resolve(args.src);
		this.#cache = path.resolve(this.#build, 'cache');
	}

	get build() { return this.#build; }
	get src() { return this.#src; }
	get cache() { return this.#cache; }

	path(type, path) {
		const roots = {
			build: true,
			src: true
		};

		if (!roots[type]) {
			throw new Error(`Cannot resolve path of type '${type}'`);
		}

		return new Path(this, {
			type: type,
			path: path
		});
	}
}

export class Path {
	#fs;
	#type;
	#rel;

	constructor(fs, args) {
		this.#fs = fs;
		this.#type = args.type;
		this.#rel = args.path;
	}

	get type() { return this.#type; }
	get path() { return this.#rel; }
}
