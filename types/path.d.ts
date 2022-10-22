export declare enum PathType {
    build = "build",
    src = "src",
    external = "external"
}
export interface IPathOpts {
    isWritable?: boolean;
}
export interface IDerivedPathOpts {
    namespace: string;
    ext?: string;
}
export interface IHasPath {
    path(): PathLike;
}
export declare type PathLike = string | Path | IHasPath;
export declare class Path {
    #private;
    constructor(components: string[], type: PathType);
    static from(pathLike: PathLike, rawOpts?: IPathOpts): Path;
    static dest(pathLike: PathLike): Path;
    toString(): string;
    get components(): string[];
    get type(): PathType;
    get writable(): boolean;
    gen(args: IDerivedPathOpts): Path;
}
