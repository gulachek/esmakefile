const { createHash } = require('crypto');
const path = require('path');
const fs = require('fs');

class Path {
	#components;
	#base;

	constructor(components, base) {
		this.#components = components;
		this.#base = base;
	}

	get components() { return this.#components; }
	get base() { return this.#base; }
}

function jsonMd5Base64Url(obj) {
	const md5 = createHash('md5');
	md5.update(JSON.stringify(obj));
	return md5.digest().toString('base64url');
}

class FileSystem {
	#path;
	#fs;

	#build;
	#src;
	#sub;

	constructor(args) {
		const pathMod = args.path || path;

		this.#path = pathMod;
		this.#fs = args.fs || fs;
		this.#sub = args.sub || [];
		this.#build = pathMod.resolve(args.build);
		this.#src = pathMod.resolve(args.src);
	}

	#clone(args) {
		return new FileSystem(
			Object.assign({
						path: this.#path,
						fs: this.#fs,
						build: this.#build,
						src: this.#src,
						sub: this.#sub
					}, args)
		);
	}

	sub(srcDir) {
		const src = this.#path.resolve(this.#src, srcDir);

		if (!src.startsWith(this.#src)) {
			throw new Error(`'${srcDir}' is not a subdir of '${this.#src}'`);
		}

		const sub = src.slice(this.#src.length).split('/')
			.filter((d) => { return d.length; });

		return this.#clone({ sub });
	}

	#createPath(p, base) {
		if (p instanceof Path)
			return p;

		const components = [...this.#sub, ...p.split('/')];
		return new Path(components, base);
	}

	#dirname(p) {
		const base = p.base;
		const components = p.components.slice(0);
		components.pop();
		return new Path(components, base);
	}

	// path to readable path
	src(p) {
		return this.#createPath(p, 'src');
	}

	// path to writable path
	dest(p) {
		const out = this.#createPath(p, 'build');
		const dir = this.#dirname(out);
		this.#fs.mkdirSync(this.abs(dir), { recursive: true });
		return out;
	}

	cache(p, args) {
		const components = p.components.slice(0);

		if (p.base === 'src') {
			components.unshift('__src__');
		}

		components.splice(components.length-1, 0, `__${args.namespace}__`);

		if (args.params) {
			const last = components.length - 1;
			components.splice(last, 0, jsonMd5Base64Url(args.params));
		}

		if (args.ext) {
			const last = components.length - 1;
			components[last] += `.${args.ext}`;
		}

		const out = new Path(components, 'build');
		const dir = this.#dirname(out);
		this.#fs.mkdirSync(this.abs(dir), { recursive: true });
		return out;
	};

	abs(p) {
		if (!(p instanceof Path))
			throw new Error(`argument must be a path returned by 'path': ${p}`);

		let base;
		switch (p.base) {
			case 'build':
				base = this.#build;
				break;
			case 'src':
				base = this.#src;
				break;
			default:
				throw new Error(`Unknown path base '${p.base}'`);
				break;
		}

		return this.#path.join(base, ...p.components);
	}
}

module.exports = {
	FileSystem: FileSystem
};
