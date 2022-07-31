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

	toString() {
		return path.join(`@${this.#base}`, ...this.#components);
	}

	get components() { return this.#components; }
	get base() { return this.#base; }
	get writable() {
		return this.#base === 'build' || this.#base === 'install';
	}

	basename() {
		return this.#components[this.#components.length - 1];
	}

	isRoot() {
		return this.#components.length === 0 ||
			this.#base === 'install' && this.#components.length === 1;
	}

	dir() {
		const components = [...this.#components];
		if (!(this.isRoot())) {
			components.pop();
		}

		return new Path(components, this.#base);
	}

	join(...components) {
		return new Path([...this.#components, ...components], this.#base);
	}
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
		return this.#clone({ sub: srcDir.split('/') });
	}

	#createPath(p, base) {
		if (p instanceof Path)
			return p;

		const useSub = base === 'build' || base === 'src';
		const split = p.split('/');
		const components = useSub ? [...this.#sub, ...split] : split;
		return new Path(components, base);
	}


	// path to imported file relative to system root
	ext(absPath) {
		if (!this.#path.isAbsolute(absPath)) {
			throw new Error(`Cannot import relative path '${absPath}'`);
		}

		return new Path(absPath.split(this.#path.sep), 'sys');
	}

	// path to installed file
	install(p) {
		const out = this.#createPath(p, 'install');
		if (out.base !== 'install') {
			throw new Error(`'${this.abs(out)}' is not an install path`);
		}

		const dir = out.dir();
		this.#fs.mkdirSync(this.abs(dir), { recursive: true });
		return out;
	}

	// path to readable path
	src(p) {
		return this.#createPath(p, 'src');
	}

	// path to writable path
	dest(p) {
		const out = this.#createPath(p, 'build');

		if (!out.writable) {
			throw new Error(`Non writable path given to dest '${this.abs(out)}'`);
		}

		const dir = out.dir();
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
		const dir = out.dir();
		this.#fs.mkdirSync(this.abs(dir), { recursive: true });
		return out;
	};

	abs(p) {
		if (!(p instanceof Path))
			throw new Error(`argument must be a path returned by 'path': ${p}`);

		const components = [...p.components];

		let base;
		switch (p.base) {
			case 'build':
				base = this.#build;
				break;
			case 'src':
				base = this.#src;
				break;
			case 'sys':
				base = '/';
				break;
			case 'install':
				const installBase = components.shift().toUpperCase();
				const envRoot = `GULPACHEK_INSTALL_ROOT_${installBase}`;

				base = process.env[envRoot];
				if (!base) {
					throw new Error(`${envRoot} is not defined`);
				}
				break;
			default:
				throw new Error(`Unknown path base '${p.base}'`);
				break;
		}

		return this.#path.resolve(base, ...components);
	}
}

module.exports = {
	FileSystem: FileSystem
};
