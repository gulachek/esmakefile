import * as path from 'path';

export enum PathType {
	build = 'build',
	src = 'src',
}

export type PathLike = string | Path;

export function isPathLike(p: any): p is PathLike {
	return typeof p === 'string' || p instanceof Path;
}

function getComponents(str: string, sep: string): string[] {
	return str.split(sep).filter((p) => !!p);
}

export class Path {
	readonly type: PathType = PathType.src;
	private components: string[] = [];

	protected constructor(type: PathType, components: string[]) {
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

	rel(): string {
		return this.components.join('/');
	}

	abs(root: string | { build: string; src: string }): string {
		root = typeof root === 'string' ? root : root[this.type];
		return path.resolve(path.join(root, this.rel()));
	}
}

export type BuildPathLike = string | BuildPath;

export function isBuildPathLike(obj: any): obj is BuildPathLike {
	return typeof obj === 'string' || obj instanceof BuildPath;
}

export interface IBuildPathGenOpts {
	/**
	 * file extension to replace in given path
	 */
	ext?: string;

	/**
	 * Directory of path to generate
	 */
	dir?: string;
}

export type BuildPathGenOpts = BuildPathLike | IBuildPathGenOpts;

export class BuildPath extends Path {
	private constructor(components: string[]) {
		super(PathType.build, components);
	}

	// always has this type
	override readonly type: PathType.build = PathType.build;

	static from(pathLike: BuildPathLike): BuildPath {
		if (typeof pathLike === 'string') {
			return new BuildPath(getComponents(pathLike, '/'));
		} else if (pathLike instanceof Path) {
			return pathLike;
		}
	}

	static gen(orig: Path, opts?: BuildPathGenOpts): BuildPath {
		if (isBuildPathLike(opts)) {
			return BuildPath.from(opts);
		}

		const posix = path.posix;

		const parsed = posix.parse(orig.rel());
		delete parsed.base; // should be able to simply specify extension
		const fmtOpts = { ...parsed, ...opts };
		return new BuildPath(getComponents(posix.format(fmtOpts), '/'));
	}
}

export function isBuildPath(path: Path): path is BuildPath {
	return path.type === PathType.build;
}
