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
Object.defineProperty(exports, "__esModule", { value: true });
require('jasmine-core');
const index_1 = require("../index");
const path = __importStar(require("path"));
class MyTarget extends index_1.Target {
    constructor(sys) {
        super(sys);
        this.called = false;
    }
    build() {
        this.called = true;
        return Promise.resolve();
    }
}
describe('BuildSystem', () => {
    it('puts the source directory to the running script"s dir', () => {
        const b = new index_1.BuildSystem();
        const self = require.main.path;
        expect(b.abs('hello/world')).toEqual(path.resolve(self, 'hello/world'));
    });
    it('puts the build directory in the current working dir"s build dir', () => {
        const b = new index_1.BuildSystem();
        expect(b.abs(index_1.Path.dest('hello'))).toEqual(path.resolve('build/hello'));
    });
    it('turns a path into a target', () => {
        const b = new index_1.BuildSystem();
        const t = b.src('hello/world');
        expect(t instanceof index_1.Target).toBeTruthy();
    });
    it('turns a target into a path', () => {
        const b = new index_1.BuildSystem();
        const t = b.src(index_1.Path.dest('hello/world'));
        expect(b.abs(t)).toEqual(path.resolve('build/hello/world'));
    });
    it('waits for gulp function to be done', () => __awaiter(void 0, void 0, void 0, function* () {
        const b = new index_1.BuildSystem();
        let called = false;
        yield b.build((cb) => {
            setTimeout(() => {
                called = true;
                cb();
            }, 5);
        });
        expect(called).toBeTruthy();
    }));
    it('waits for promise to be done', () => __awaiter(void 0, void 0, void 0, function* () {
        const b = new index_1.BuildSystem();
        let called = false;
        yield b.build(Promise.resolve().then(() => {
            called = true;
        }));
        expect(called).toBeTruthy();
    }));
    it('waits for target to be built', () => __awaiter(void 0, void 0, void 0, function* () {
        const b = new index_1.BuildSystem();
        const t = new MyTarget(b);
        yield b.build(t);
        expect(t.called).toBeTruthy();
    }));
    it('continues waiting if target is promise resolution', () => __awaiter(void 0, void 0, void 0, function* () {
        const b = new index_1.BuildSystem();
        const t = new MyTarget(b);
        yield b.build(Promise.resolve(t));
        expect(t.called).toBeTruthy();
    }));
});
