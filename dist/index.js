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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
var _Target_sys, _Target_path, _BuildSystem_instances, _BuildSystem_srcDir, _BuildSystem_buildDir, _BuildSystem_isDebug, _BuildSystem_buildingTargets, _BuildSystem_toTarget, _BuildSystem_recursiveAsyncDone, _BuildSystem_buildTargetMutex, _BuildSystem_buildTarget;
Object.defineProperty(exports, "__esModule", { value: true });
exports.BuildSystem = exports.Target = exports.Path = void 0;
const async_done_1 = __importDefault(require("async-done"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const path_1 = require("./path");
var path_2 = require("./path");
Object.defineProperty(exports, "Path", { enumerable: true, get: function () { return path_2.Path; } });
function hasToTarget(obj) {
    return typeof obj.toTarget === 'function';
}
class Target {
    constructor(sys, p) {
        _Target_sys.set(this, void 0);
        _Target_path.set(this, void 0);
        __classPrivateFieldSet(this, _Target_sys, sys, "f");
        __classPrivateFieldSet(this, _Target_path, p ? path_1.Path.from(p) : null, "f");
    }
    toString() {
        return this.constructor.name;
    }
    get sys() {
        return __classPrivateFieldGet(this, _Target_sys, "f");
    }
    get hasPath() {
        return !!__classPrivateFieldGet(this, _Target_path, "f");
    }
    get path() {
        if (!this.hasPath)
            throw new Error(`Cannot access null path: ${this}`);
        return __classPrivateFieldGet(this, _Target_path, "f");
    }
    get abs() {
        return this.sys.abs(this.path);
    }
    deps() {
        return null;
    }
    static getDeps(t) {
        const deps = t.deps();
        if (!deps)
            return [];
        if (Array.isArray(deps))
            return deps;
        return [deps];
    }
    build(cb) {
        return Promise.resolve();
    }
    // Date object of mtime, null means out of date
    mtime() {
        if (!this.hasPath)
            return null;
        const abs = this.abs;
        if (!fs.existsSync(abs)) {
            return null;
        }
        return fs.statSync(abs).mtime;
    }
}
exports.Target = Target;
_Target_sys = new WeakMap(), _Target_path = new WeakMap();
class BuildSystem {
    constructor(passedOpts) {
        _BuildSystem_instances.add(this);
        _BuildSystem_srcDir.set(this, '');
        _BuildSystem_buildDir.set(this, '');
        _BuildSystem_isDebug.set(this, false);
        _BuildSystem_buildingTargets.set(this, new Map());
        const defaults = {
            srcDir: require && require.main && require.main.path,
            buildDir: 'build',
            isDebug: true
        };
        const opts = Object.assign(defaults, passedOpts || {});
        __classPrivateFieldSet(this, _BuildSystem_isDebug, opts.isDebug, "f");
        __classPrivateFieldSet(this, _BuildSystem_srcDir, opts.srcDir, "f");
        __classPrivateFieldSet(this, _BuildSystem_buildDir, opts.buildDir, "f");
    }
    abs(tLike) {
        const t = __classPrivateFieldGet(this, _BuildSystem_instances, "m", _BuildSystem_toTarget).call(this, tLike);
        const { type, components } = t.path;
        let base;
        switch (type) {
            case path_1.PathType.src:
                base = __classPrivateFieldGet(this, _BuildSystem_srcDir, "f");
                break;
            case path_1.PathType.build:
                base = __classPrivateFieldGet(this, _BuildSystem_buildDir, "f");
                break;
            case path_1.PathType.external:
                base = '/';
                break;
            default:
                throw new Error(`Unknown PathType: ${type}`);
                break;
        }
        return path.resolve(base, ...components);
    }
    isDebugBuild() {
        return __classPrivateFieldGet(this, _BuildSystem_isDebug, "f");
    }
    // convert system path into a target
    ext(absPath) {
        if (!path.isAbsolute(absPath))
            throw new Error(`External paths must be referenced as absolute: ${absPath}`);
        return new Target(this, path_1.Path.from(absPath));
    }
    // convert a TargetLike object to a Target in this system
    src(t) {
        return __classPrivateFieldGet(this, _BuildSystem_instances, "m", _BuildSystem_toTarget).call(this, t);
    }
    build(work) {
        return __classPrivateFieldGet(this, _BuildSystem_instances, "m", _BuildSystem_recursiveAsyncDone).call(this, work);
    }
}
exports.BuildSystem = BuildSystem;
_BuildSystem_srcDir = new WeakMap(), _BuildSystem_buildDir = new WeakMap(), _BuildSystem_isDebug = new WeakMap(), _BuildSystem_buildingTargets = new WeakMap(), _BuildSystem_instances = new WeakSet(), _BuildSystem_toTarget = function _BuildSystem_toTarget(t) {
    if (t instanceof Target) {
        if (t.sys !== this)
            throw new Error(`Target belongs to different system ${t}`);
        return t;
    }
    if (hasToTarget(t)) {
        return __classPrivateFieldGet(this, _BuildSystem_instances, "m", _BuildSystem_toTarget).call(this, t);
    }
    return new Target(this, t);
}, _BuildSystem_recursiveAsyncDone = function _BuildSystem_recursiveAsyncDone(work) {
    return new Promise((resolve, reject) => {
        const wrapCb = (err, result) => {
            if (err)
                reject(err);
            else
                resolve(__classPrivateFieldGet(this, _BuildSystem_instances, "m", _BuildSystem_recursiveAsyncDone).call(this, result));
        };
        // Break recursion
        if (!work) {
            return resolve();
        }
        // BuildTask
        if (typeof work === 'function') {
            return (0, async_done_1.default)(work, wrapCb);
        }
        // AsyncDoneable
        if (isAsyncDoneable(work)) {
            return (0, async_done_1.default)(() => work, wrapCb);
        }
        // TargetLike
        return resolve(__classPrivateFieldGet(this, _BuildSystem_instances, "m", _BuildSystem_buildTarget).call(this, work));
    });
}, _BuildSystem_buildTargetMutex = function _BuildSystem_buildTargetMutex(t) {
    return __awaiter(this, void 0, void 0, function* () {
        const deps = Target.getDeps(t).map(t => __classPrivateFieldGet(this, _BuildSystem_instances, "m", _BuildSystem_toTarget).call(this, t));
        const depTasks = deps.map(d => __classPrivateFieldGet(this, _BuildSystem_instances, "m", _BuildSystem_buildTarget).call(this, d));
        try {
            yield Promise.all(depTasks);
        }
        catch (e) {
            e.message += `\nBuilding dependency of ${t}`;
            throw e;
        }
        const selfMtime = t.mtime();
        let needsBuild = !selfMtime;
        if (!needsBuild) {
            for (const dep of deps) {
                const mtime = dep.mtime();
                if (!mtime || mtime > selfMtime) {
                    needsBuild = true;
                    break;
                }
            }
        }
        if (needsBuild) {
            try {
                yield __classPrivateFieldGet(this, _BuildSystem_instances, "m", _BuildSystem_recursiveAsyncDone).call(this, t.build.bind(t));
            }
            catch (err) {
                err.message += `\nBuilding ${t}`;
                throw err;
            }
        }
    });
}, _BuildSystem_buildTarget = function _BuildSystem_buildTarget(tLike) {
    return __awaiter(this, void 0, void 0, function* () {
        const t = __classPrivateFieldGet(this, _BuildSystem_instances, "m", _BuildSystem_toTarget).call(this, tLike);
        let promise = __classPrivateFieldGet(this, _BuildSystem_buildingTargets, "f").get(t);
        if (promise)
            return promise;
        promise = __classPrivateFieldGet(this, _BuildSystem_instances, "m", _BuildSystem_buildTargetMutex).call(this, t);
        __classPrivateFieldGet(this, _BuildSystem_buildingTargets, "f").set(t, promise);
        try {
            yield promise;
        }
        finally {
            __classPrivateFieldGet(this, _BuildSystem_buildingTargets, "f").delete(t);
        }
    });
};
function isAsyncDoneable(obj) {
    if (typeof obj === 'undefined')
        return false;
    // promise
    if (typeof obj.then === 'function')
        return true;
    // stream
    if (typeof obj.on === 'function')
        return true;
    // something weird that gulp supports
    if (typeof obj.subscribe === 'function')
        return true;
    return false;
}
