import * as path from 'path';

export enum PathType {
	build = 'build',
	src = 'src',
}

export type PathLike = string | Path;

function getComponents(str: string, sep: string): string[] {
	return str.split(sep).filter((p) => !!p);
}

export class Path {
	readonly type: PathType = PathType.src;
	readonly components: string[] = [];

	constructor(type: PathType, components: string[]) {
		this.type = type;
		this.components = [...components];
	}

	static src(pathLike: PathLike): Path {
		if (pathLike instanceof Path) {
			return pathLike;
		} else if (typeof pathLike === 'string') {
			return new Path(PathType.src, getComponents(pathLike, '/'));
		} else {
			throw new Error(`Invalid path object: ${pathLike}`);
		}
	}

	toString(): string {
		return path.join(`@${this.type}`, ...this.components);
	}

	get dir(): Path {
		const components = [...this.components];
		components.pop();
		return new Path(this.type, components);
	}

	get basename(): string {
		if (this.components.length)
			return this.components[this.components.length - 1];

		return '';
	}

	get extname(): string {
		return path.extname(this.basename);
	}

	join(...pieces: string[]): Path {
		const components = [...this.components];
		for (const p of pieces) {
			for (const c of getComponents(p, '/')) {
				components.push(c);
			}
		}

		return new Path(this.type, components);
	}

	get rel(): string {
		return this.components.join('/');
	}
}

export type BuildPathLike = string | BuildPath;

export interface IBuildPathGenOpts {
	/**
	 * file extension to replace in given path
	 */
	ext?: string;
}

export class BuildPath extends Path {
	constructor(components: string[]) {
		super(PathType.build, components);
	}

	static from(pathLike: BuildPathLike): BuildPath {
		if (typeof pathLike === 'string') {
			return new BuildPath(getComponents(pathLike, '/'));
		} else if (pathLike instanceof Path) {
			return pathLike;
		}
	}

	static gen(orig: Path, opts?: IBuildPathGenOpts): BuildPath {
		if (opts) {
			if (opts.ext) {
				const parsed = path.posix.parse(orig.rel);
				parsed.ext = opts.ext;
				delete parsed.base;
				return BuildPath.from(path.posix.format(parsed));
			}
		}

		return new BuildPath(orig.components);
	}
}
