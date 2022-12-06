require('jasmine-core');

import { Path, PathType } from '../path';
import * as path from 'node:path';

describe('Path', () => {
	describe('writable', () => {
		it('is writable when build', () => {
			const p = new Path([], PathType.build);
			expect(p.writable).toBeTruthy();
		});

		it('is not writable when src', () => {
			const p = new Path([], PathType.src);
			expect(p.writable).toBeFalsy();
		});

		it('is not writable when external', () => {
			const p = new Path([], PathType.external);
			expect(p.writable).toBeFalsy();
		});
	});

	describe('from', () => {
		it('makes an external path when absolute', () => {
			const p = Path.from('/hello/world', { pathMod: path.posix });
			expect(p.type).toEqual(PathType.external);
		});

		it('makes an external path when absolute win32', () => {
			const p = Path.from('C:\\hello\\world', { pathMod: path.win32 });
			expect(p.type).toEqual(PathType.external);
		});

		it('reuses path if given a path', () => {
			const p = Path.from('/hello/world', { pathMod: path.posix });
			const p2 = Path.from(p);
			expect(p2).toBe(p);
		});

		it('normalizes components', () => {
			const p = Path.from('/hello///////world//', { pathMod: path.posix });
			expect(p.components).toEqual(['hello', 'world']);
		});

		it('normalizes components win32', () => {
			const p = Path.from('C:\\hello\\\\\\\\\\world\\', { pathMod: path.win32 });
			expect(p.components).toEqual(['hello', 'world']);
		});

		it('uses a source path when relative', () => {
			const p = Path.from('hello///////world//');
			expect(p.type).toEqual(PathType.src);
		});

		it('uses a source path when relative and not writable', () => {
			const p = Path.from('hello///////world//', { isWritable: false });
			expect(p.type).toEqual(PathType.src);
		});

		it('uses a build path when relative and writable', () => {
			const p = Path.from('hello///////world//', { isWritable: true });
			expect(p.type).toEqual(PathType.build);
		});

		it('uses a build path when explicitly given dest()', () => {
			const p = Path.dest('hello///////world//');
			expect(p.type).toEqual(PathType.build);
		});

		it('throws when given path is not writable', () => {
			expect(() => Path.dest('/hello///////world//', {
				pathMod: path.posix
			})).toThrow();
		});

		it('splits src paths by "/" instead of path.sep windows', () => {
			const p = Path.from('src/foo', { pathMod: path.win32 });
			expect(p.components).toEqual(['src', 'foo']);
		});

		it('splits build paths by "/" instead of path.sep windows', () => {
			const p = Path.from('build/foo', {
				isWritable: true,
				pathMod: path.win32
			});

			expect(p.components).toEqual(['build', 'foo']);
		});

		it('splits ext paths by "\\" instead of path.sep windows', () => {
			const p = Path.from('C:\\src\\foo', { pathMod: path.win32 });
			expect(p.components).toEqual(['src', 'foo']);
		});

		it('splits ext paths by "/" on posix', () => {
			const p = Path.from('/src/foo', { pathMod: path.posix });
			expect(p.components).toEqual(['src', 'foo']);
		});
	});

	describe('toString', () => {
		it('looks pretty', () => {
			const p = Path.from('hello/world');
			expect(p.toString()).toEqual('@src/hello/world');
		});
	});

	describe('gen', () => {
		const namespace = 'com.example';

		it('throws if given external', () => {
			const p = Path.from('/hello', { pathMod: path.posix });
			expect(() => p.gen({ namespace })).toThrow();
		});

		it('prepends __src__', () => {
			const p = Path.from('hello/world.js').gen({ namespace });
			expect(p.components).toEqual(['__src__', 'hello', '__com.example__', 'world.js']);
		});

		it('puts build in same dir', () => {
			const src = Path.from('hello/world.js', { isWritable: true });
			const p = src.gen({ namespace });
			expect(p.components).toEqual(['hello', '__com.example__', 'world.js']);
		});

		it('adds an extension', () => {
			const src = Path.from('hello/world.js', { isWritable: true });
			const p = src.gen({ namespace, ext: 'tst' });
			expect(p.components[2]).toEqual('world.js.tst');
		});
	});

	describe('dir', () => {
		it('returns equal path when root', () => {
			const p = new Path([], PathType.build);
			expect(p.dir.components).toEqual(p.components);
		});

		it('has same type', () => {
			const p = new Path([], PathType.build);
			expect(p.dir.type).toEqual(PathType.build);
		});

		it('loses tail component when non root', () => {
			const p = new Path(['hello', 'world'], PathType.build);
			expect(p.dir.components).toEqual(['hello']);
		});
	});

	describe('basename', () => {
		it('is the last component', () => {
			const p = new Path(['dir', 'file.txt'], PathType.src);
			expect(p.basename).toEqual('file.txt');
		});

		it('is empty if root', () => {
			const p = new Path([], PathType.src);
			expect(p.basename).toEqual('');
		});
	});

	describe('extname', () => {
		it('includes the period to the end of the basename', () => {
			const p = Path.from('hello/world.txt');
			expect(p.extname).toEqual('.txt');
		});

		it('does not include a prior extension', () => {
			const p = Path.from('hello/world.prior.txt');
			expect(p.extname).toEqual('.txt');
		});

		it('is empty if no period', () => {
			const p = Path.from('hello/world');
			expect(p.extname).toEqual('');
		});
	});

	describe('join', () => {
		it('has same type as src', () => {
			const p = Path.dest('hello/world');
			const j = p.join('file.txt');
			expect(j.type).toEqual(PathType.build);
		});

		it('adds each piece to components', () => {
			const p = Path.dest('hello/world');
			const j = p.join('//hello/sub', 'file.txt');
			expect(j.components).toEqual(['hello', 'world', 'hello', 'sub', 'file.txt']);
		});
	});
});
