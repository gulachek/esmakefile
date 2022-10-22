"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require('jasmine-core');
const path_1 = require("../path");
describe('Path', () => {
    describe('writable', () => {
        it('is writable when build', () => {
            const p = new path_1.Path([], path_1.PathType.build);
            expect(p.writable).toBeTruthy();
        });
        it('is not writable when src', () => {
            const p = new path_1.Path([], path_1.PathType.src);
            expect(p.writable).toBeFalsy();
        });
        it('is not writable when external', () => {
            const p = new path_1.Path([], path_1.PathType.external);
            expect(p.writable).toBeFalsy();
        });
    });
    describe('from', () => {
        it('makes an external path when absolute', () => {
            const p = path_1.Path.from('/hello/world');
            expect(p.type).toEqual(path_1.PathType.external);
        });
        it('reuses path if given a path', () => {
            const p = path_1.Path.from('/hello/world');
            const p2 = path_1.Path.from(p);
            expect(p2).toBe(p);
        });
        it('normalizes components', () => {
            const p = path_1.Path.from('/hello///////world//');
            expect(p.components).toEqual(['hello', 'world']);
        });
        it('uses a source path when relative', () => {
            const p = path_1.Path.from('hello///////world//');
            expect(p.type).toEqual(path_1.PathType.src);
        });
        it('uses a source path when relative and not writable', () => {
            const p = path_1.Path.from('hello///////world//', { isWritable: false });
            expect(p.type).toEqual(path_1.PathType.src);
        });
        it('uses a build path when relative and writable', () => {
            const p = path_1.Path.from('hello///////world//', { isWritable: true });
            expect(p.type).toEqual(path_1.PathType.build);
        });
        it('uses a build path when explicitly given dest()', () => {
            const p = path_1.Path.dest('hello///////world//');
            expect(p.type).toEqual(path_1.PathType.build);
        });
        it('throws when given path is not writable', () => {
            expect(() => path_1.Path.dest('/hello///////world//')).toThrow();
        });
    });
    describe('toString', () => {
        it('looks pretty', () => {
            const p = path_1.Path.from('hello/world');
            expect(p.toString()).toEqual('@src/hello/world');
        });
    });
    describe('gen', () => {
        const namespace = 'com.example';
        it('throws if given external', () => {
            const p = path_1.Path.from('/hello');
            expect(() => p.gen({ namespace })).toThrow();
        });
        it('prepends __src__', () => {
            const p = path_1.Path.from('hello/world.js').gen({ namespace });
            expect(p.components).toEqual(['__src__', 'hello', '__com.example__', 'world.js']);
        });
        it('puts build in same dir', () => {
            const src = path_1.Path.from('hello/world.js', { isWritable: true });
            const p = src.gen({ namespace });
            expect(p.components).toEqual(['hello', '__com.example__', 'world.js']);
        });
        it('adds an extension', () => {
            const src = path_1.Path.from('hello/world.js', { isWritable: true });
            const p = src.gen({ namespace, ext: 'tst' });
            expect(p.components[2]).toEqual('world.js.tst');
        });
    });
});
