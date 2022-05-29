import 'jasmine-core';
import { FileSystem, Path } from '../lib/fs.js';

describe('FileSystem', () => {
	let fs;
	let path;

	beforeEach(() => {
		path = jasmine.createSpyObj('path', [
			'resolve'
		]);

		path.resolve.and.callFake((...args) => {
			const p = args.join('/');
			return p.startsWith('/') ? p : `/resolved/${p}`;
		});

		fs = new FileSystem({
			build: 'build',
			src: 'src',
			path: path
		});
	});

	it('has a build root', () => {
		expect(fs.build).toEqual('/resolved/build');
	});

	it('has a src root', () => {
		expect(fs.src).toEqual('/resolved/src');
	});

	it('has a cache root in the build tree', () => {
		expect(fs.cache).toEqual('/resolved/build/cache');
	});

	describe('path', () => {
		it('turns a relative path into a path object', () => {
			const p = fs.path('build', 'my/path');

			expect(p.type).toEqual('build');
			expect(p.path).toEqual('my/path');
		});
	});
});
