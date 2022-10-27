import * as path from 'path';

export enum PathType
{
	build = 'build',
	src = 'src',
	external = 'external'
}

export interface IPathOpts
{
	isWritable?: boolean;
}

export interface IDerivedPathOpts
{
	// make sure one rule's generation doesn't conflict w/ another's
	namespace?: string;

	// extension to append
	ext?: string;
}

export interface IHasPath
{
	path(): PathLike;
}

export type PathLike = string | Path | IHasPath;

function getComponents(str: string): string[]
{
	return str.split(path.sep).filter(p => !!p);
}

export class Path
{
	private _components: string[] = [];
	private _type: PathType = PathType.external;

	constructor(components: string[], type: PathType)
	{
		this._components = components;
		this._type = type;
	}

	static from(pathLike: PathLike, rawOpts?: IPathOpts): Path
	{
		const opts: IPathOpts = rawOpts || {};
		let out: Path | undefined;

		if (pathLike instanceof Path)
		{
			out = pathLike;
		}
		else if (typeof pathLike === 'string')
		{
			const components = getComponents(pathLike);
			const relativeType = opts.isWritable ? PathType.build : PathType.src;
			const type = path.isAbsolute(pathLike) ?
				PathType.external : relativeType;

			out = new Path(components, type);
		}
		else
		{
			return Path.from(pathLike.path(), opts);
		}

		if (opts.isWritable && !out.writable)
		{
			throw new Error(`Path is not writable ${pathLike}`);
		}

		return out;
	}

	static dest(pathLike: PathLike): Path
	{
		return Path.from(pathLike, { isWritable: true });
	}

	toString(): string
	{
		return path.join(`@${this._type}`, ...this._components);
	}

	get components(): string[]
	{
		return this._components;
	}

	get type(): PathType
	{
		return this._type;
	}

	get writable(): boolean
	{
		return this._type === PathType.build;
	}

	get dir(): Path
	{
		const components = [...this.components];
		components.pop();
		return new Path(components, this.type);
	}

	get basename(): string
	{
		if (this.components.length)
			return this.components[this.components.length - 1];

		return '';
	}

	get extname(): string
	{
		return path.extname(this.basename);
	}

	join(...pieces: string[]): Path
	{
		const components = [...this.components];
		for (const p of pieces)
		{
			for (const c of getComponents(p))
			{
				components.push(c);
			}
		}

		return new Path(components, this.type);
	}

	gen(args: IDerivedPathOpts): Path
	{
		if (this.type === PathType.external)
		{
			throw new Error(`External paths cannot be used to generate paths: ${this}`);
		}

		const components = [...this.components];

		if (this._type === PathType.src) {
			components.unshift('__src__');
		}

		if (args.namespace)
			components.splice(components.length - 1, 0, `__${args.namespace}__`);

		if (args.ext) {
			const last = components.length - 1;
			components[last] += `.${args.ext}`;
		}

		return new Path(components, PathType.build);
	}
}

