import * as path from 'path';

export enum PathType {
	build = 'build',
	src = 'src',
}

export function rebasePath(
	p: string,
	fromBase: string,
	toBase: string,
): string {
	const pRel = path.relative(fromBase, p);
	if (pRel.includes('..')) {
		throw new Error(
			`Cannot rebase path '${p}' from base '${fromBase}' because it is not within the base path`,
		);
	}

	return path.join(toBase, pRel);
}

export type PathLike = string | Path;

export function isPathLike(p: unknown): p is PathLike {
	return typeof p === 'string' || Path.isPath(p);
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

export class Path {
	readonly type: PathType = PathType.src;
	protected components: string[] = [];

	protected constructor(type: PathType, components: string[]) {
		this.type = type;
		this.components = [...components];
	}

	// This is important because there are a few cases like
	// `isPathLike` where we want to see if something is a
	// Path. `instanceof` has proven brittle due to npm
	// resolving different versions, especially when one
	// package depends on esmakefile, and another local
	// package does. Npm will use 2 different esmakefiles,
	// even if they're on the same version.
	static isPath(obj: unknown): obj is Path {
		if (!obj) return false;
		switch ((obj as Path).type) {
			case PathType.build:
			case PathType.src:
				break;
			default:
				return false;
		}

		if (!Array.isArray((obj as Path).components)) return false;
		return obj.constructor.name === 'Path';
	}

	static src(pathLike: PathLike): Path {
		if (Path.isPath(pathLike)) {
			return pathLike;
		} else if (typeof pathLike === 'string') {
			return new Path(PathType.src, getComponents(pathLike));
		} else {
			throw new Error(`Invalid path object: ${pathLike}`);
		}
	}

	static build(pLike: BuildPathLike): Path {
		if (Path.isPath(pLike)) {
			if (pLike.isBuildPath()) {
				return pLike;
			} else {
				throw new Error(
					`Invalid path given to Path.build(). Source paths cannot be used as build paths (given '${pLike}')`,
				);
			}
		} else if (typeof pLike === 'string') {
			return new Path(PathType.build, getComponents(pLike)) as Path;
		} else {
			throw new Error(`Invalid path object: ${pLike}`);
		}
	}

	toString(): string {
		return path.posix.join(`@${this.type}`, ...this.components);
	}

	isBuildPath(): this is Path {
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

	abs(root: string | IPathRoots): string {
		root = typeof root === 'string' ? root : root[this.type];
		return path.resolve(path.join(root, this.rel()));
	}
}

export type BuildPathLike = string | Path;

export function isBuildPathLike(obj: unknown): obj is BuildPathLike {
	return (
		typeof obj === 'string' || (Path.isPath(obj) && obj.type === PathType.build)
	);
}

export interface IPathRoots {
	build: string;
	src: string;
}
