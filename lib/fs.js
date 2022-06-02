import { createHash } from 'crypto';
import * as path from 'path';
import * as fs from 'fs';

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

export class FileSystem {
	#path;
	#fs;

	#build;
	#src;

	constructor(args) {
		const path = args.path;

		this.#path = args.path || path;
		this.#fs = args.fs || fs;
		this.#build = path.resolve(args.build);
		this.#src = path.resolve(args.src);
	}

	get build() { return this.#build; }
	get src() { return this.#src; }

	#createPath(p, base) {
		if (p instanceof Path)
			return p;

		const components = p.split('/');
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
		this.#fs.mkdirSync(this.abs(dir));
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

		return new Path(components, 'build');
	};

	abs(p) {
		if (!(p instanceof Path))
			throw new Error("argument must be a path returned by 'path'");

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
