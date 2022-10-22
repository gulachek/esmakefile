"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _Path_components, _Path_type;
Object.defineProperty(exports, "__esModule", { value: true });
exports.Path = exports.PathType = void 0;
const path = __importStar(require("path"));
var PathType;
(function (PathType) {
    PathType["build"] = "build";
    PathType["src"] = "src";
    PathType["external"] = "external";
})(PathType = exports.PathType || (exports.PathType = {}));
class Path {
    constructor(components, type) {
        _Path_components.set(this, []);
        _Path_type.set(this, PathType.external);
        __classPrivateFieldSet(this, _Path_components, components, "f");
        __classPrivateFieldSet(this, _Path_type, type, "f");
    }
    static from(pathLike, rawOpts) {
        const opts = rawOpts || {};
        let out;
        if (pathLike instanceof Path) {
            out = pathLike;
        }
        else if (typeof pathLike === 'string') {
            const components = pathLike.split(path.sep).filter(p => !!p);
            const relativeType = opts.isWritable ? PathType.build : PathType.src;
            const type = path.isAbsolute(pathLike) ?
                PathType.external : relativeType;
            out = new Path(components, type);
        }
        else {
            return Path.from(pathLike.path(), opts);
        }
        if (opts.isWritable && !out.writable) {
            throw new Error(`Path is not writable ${pathLike}`);
        }
        return out;
    }
    static dest(pathLike) {
        return Path.from(pathLike, { isWritable: true });
    }
    toString() {
        return path.join(`@${__classPrivateFieldGet(this, _Path_type, "f")}`, ...__classPrivateFieldGet(this, _Path_components, "f"));
    }
    get components() {
        return __classPrivateFieldGet(this, _Path_components, "f");
    }
    get type() {
        return __classPrivateFieldGet(this, _Path_type, "f");
    }
    get writable() {
        return __classPrivateFieldGet(this, _Path_type, "f") === PathType.build;
    }
    gen(args) {
        if (this.type === PathType.external) {
            throw new Error(`External paths cannot be used to generate paths: ${this}`);
        }
        const components = [...this.components];
        if (__classPrivateFieldGet(this, _Path_type, "f") === PathType.src) {
            components.unshift('__src__');
        }
        components.splice(components.length - 1, 0, `__${args.namespace}__`);
        if (args.ext) {
            const last = components.length - 1;
            components[last] += `.${args.ext}`;
        }
        return new Path(components, PathType.build);
    }
}
exports.Path = Path;
_Path_components = new WeakMap(), _Path_type = new WeakMap();
