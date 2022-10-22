import { Path, PathLike } from './path';
export { Path } from './path';
interface IToTarget {
    toTarget(): TargetLike;
}
declare type TargetLike = Target | IToTarget | PathLike;
export declare class Target {
    #private;
    constructor(sys: BuildSystem, p?: PathLike);
    toString(): string;
    get sys(): BuildSystem;
    get hasPath(): boolean;
    get path(): Path;
    get abs(): string;
    deps(): TargetLike[] | TargetLike | null;
    static getDeps(t: Target): TargetLike[];
    build(cb: ErrorFirstCallback): AsyncDoneable;
    mtime(): Date | null;
}
export interface IBuildSystemOpts {
    srcDir?: string;
    buildDir?: string;
    isDebug?: boolean;
}
export declare class BuildSystem {
    #private;
    constructor(passedOpts?: IBuildSystemOpts);
    abs(tLike: TargetLike): string;
    isDebugBuild(): boolean;
    ext(absPath: string): Target;
    src(t: TargetLike): Target;
    build(work: AsyncWork): Promise<void>;
}
declare type ErrorFirstCallback = (err?: Error) => any;
declare type AsyncDoneable = Promise<any> | undefined;
declare type BuildTask = (cb: ErrorFirstCallback) => AsyncDoneable | void;
declare type AsyncWork = BuildTask | AsyncDoneable | TargetLike;
