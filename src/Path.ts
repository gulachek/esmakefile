import * as path from 'path';

export enum PathType {
	build = 'build',
	src = 'src',
}

export type PathLike = string | Path;

export function isPathLike(p: any): p is PathLike {
	return typeof p === 'string' || p instanceof Path;
}

function getComponents(str: string): string[] {
	const sep = '/';
	const pieces: string[] = [];
	for (const piece of str.split(sep)) {
		switch (piece) {
			case '':
			case '.':
				break;
			case '..':
				pieces.pop();
				break;
			default:
				pieces.push(piece);
		}
	}

	return pieces;
}

export interface IBuildPath extends Path {
	readonly type: PathType.build;
	dir(): IBuildPath;
	join(...pieces: string[]): IBuildPath;
}

export class Path {
	readonly type: PathType = PathType.src;
	protected components: string[] = [];

	protected constructor(type: PathType, components: string[]) {
		this.type = type;
		this.components = [...components];
	}

	static src(pathLike: PathLike): Path {
		if (pathLike instanceof Path) {
			return pathLike;
		} else if (typeof pathLike === 'string') {
			return new Path(PathType.src, getComponents(pathLike));
		} else {
			throw new Error(`Invalid path object: ${pathLike}`);
		}
	}

	static build(pLike: BuildPathLike): IBuildPath {
		if (pLike instanceof Path) {
			if (pLike.isBuildPath()) {
				return pLike;
			} else {
				throw new Error(
					`Invalid path given to Path.build(). Source paths cannot be used as build paths (given '${pLike}')`,
				);
			}
		} else if (typeof pLike === 'string') {
			return new Path(PathType.build, getComponents(pLike)) as IBuildPath;
		} else {
			throw new Error(`Invalid path object: ${pLike}`);
		}
	}

	static gen(orig: Path, opts?: BuildPathGenOpts): IBuildPath {
		if (isBuildPathLike(opts)) {
			return Path.build(opts);
		}

		const posix = path.posix;

		const parsed = posix.parse(orig.rel());
		delete parsed.base; // should be able to simply specify extension
		const fmtOpts = { ...parsed, ...opts };
		return new Path(
			PathType.build,
			getComponents(posix.format(fmtOpts)),
		) as IBuildPath;
	}

	toString(): string {
		return path.join(`@${this.type}`, ...this.components);
	}

	isBuildPath(): this is IBuildPath {
		return this.type === PathType.build;
	}

	dir(): Path {
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
		const rel = this.rel() + '/' + pieces.join('/');
		return new Path(this.type, getComponents(rel));
	}

	rel(): string {
		return this.components.join('/');
	}

	abs(root: string | { build: string; src: string }): string {
		root = typeof root === 'string' ? root : root[this.type];
		return path.resolve(path.join(root, this.rel()));
	}
}

export type BuildPathLike = string | IBuildPath;

export function isBuildPathLike(obj: any): obj is BuildPathLike {
	return (
		typeof obj === 'string' ||
		(obj instanceof Path && obj.type === PathType.build)
	);
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
