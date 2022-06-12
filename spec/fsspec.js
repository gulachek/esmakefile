require('jasmine-core');
const { FileSystem } = require('../lib/fs.js');

describe('FileSystem', () => {
	let fsMod;
	let path;

	let fs;

	beforeEach(() => {
		path = jasmine.createSpyObj('path', [
			'resolve',
			'join',
			'isAbsolute'
		]);

		path.sep = '/';

		fsMod = jasmine.createSpyObj('fs', [
			'mkdirSync'
		]);

		path.resolve.and.callFake((...args) => {
			const p = args.join('/');
			return p.startsWith('/') ? p : `/resolved/${p}`;
		});

		path.join.and.callFake((...args) => {
			return args.join(path.sep);
		});

		path.isAbsolute.and.callFake((p) => {
			return p.startsWith(path.sep);
		});

		fs = new FileSystem({
			build: 'src/build',
			src: 'src',
			path: path,
			fs: fsMod
		});
	});

	describe('dest', () => {
		it('makes a build path', () => {
			const p = fs.dest('my/path');
			const abs = fs.abs(p);
			expect(abs).toEqual('/resolved/src/build/my/path');
		});

		it('throws if given a source path', () => {
			const src = fs.src('my/path');
			expect(() => {
				fs.dest(src);
			}).toThrow();
		});

		it('throws if given a system path', () => {
			const src = fs.ext('/my/path');
			expect(() => {
				fs.dest(src);
			}).toThrow();
		});
	});

	it('throws if non-path is given to abs', () => {
		const go = () => {
			fs.abs({ components: ['my', 'path'], base: 'build' });
		};

		expect(go).toThrow();
	});

	it('makes a src path', () => {
		const p = fs.src('my/path');
		const abs = fs.abs(p);
		expect(abs).toEqual('/resolved/src/my/path');
	});

	it('returns a path if already constructed', () => {
		const p = fs.dest('my/path');
		const p2 = fs.src(p);
		const abs = fs.abs(p);
		expect(abs).toEqual('/resolved/src/build/my/path');
	});

	it('dest makes a new dir', () => {
		fs.dest('my/path');
		expect(fsMod.mkdirSync).toHaveBeenCalledWith(
			'/resolved/src/build/my',
			{ recursive: true }
		);
	});

	it('makes a cache path from a build path', () => {
		const b = fs.dest('my/path.ext');
		const p = fs.cache(b, {
			namespace: 'com.gulachek.test'
		});
		const abs = fs.abs(p);
		expect(abs).toEqual('/resolved/src/build/my/__com.gulachek.test__/path.ext');
	});

	it('makes a directory for a cache path', () => {
		const b = fs.dest('my/path.ext');
		const p = fs.cache(b, {
			namespace: 'com.gulachek.test'
		});
		const abs = fs.abs(p);
		expect(fsMod.mkdirSync).toHaveBeenCalledWith('/resolved/src/build/my/__com.gulachek.test__', { recursive: true });
	});

	it('adds an extension in cache path', () => {
		const b = fs.dest('my/path.ext');
		const p = fs.cache(b, {
			namespace: 'com.gulachek.test',
			ext: 'ext2'
		});
		const abs = fs.abs(p);
		expect(abs).toEqual('/resolved/src/build/my/__com.gulachek.test__/path.ext.ext2');
	});

	it('adds an md5 hash dir for input params', () => {

		const b = fs.dest('my/path.ext');
		const p = fs.cache(b, {
			namespace: 'com.gulachek.test',
			params: { hello: 'world' }
		});
		const abs = fs.abs(p);
		expect(abs).toEqual('/resolved/src/build/my/__com.gulachek.test__/-8JLzHoXlHWPwTJ_z-va9g/path.ext');
	});

	it('caches a src path into build dir', () => {

		const b = fs.src('my/path.ext');
		const p = fs.cache(b, {
			namespace: 'com.gulachek.test'
		});
		const abs = fs.abs(p);
		expect(abs).toEqual('/resolved/src/build/__src__/my/__com.gulachek.test__/path.ext');
	});

	it('nests cache dirs', () => {

		const b = fs.dest('my/path.ext');
		const p = fs.cache(b, {
			namespace: 't.one'
		});

		const p2 = fs.cache(p, {
			namespace: 't.two'
		});

		const abs = fs.abs(p2);
		expect(abs).toEqual('/resolved/src/build/my/__t.one__/__t.two__/path.ext');
	});

	describe('ext', () => {
		beforeEach(() => {
			path.isAbsolute.and.returnValue(true);
		});

		it('imports external paths', () => {
			const p = fs.ext('/my/ext/path');
			expect(fs.abs(p)).toEqual('/my/ext/path');
		});

		it('uses native path separator', () => {
			path.sep = '\\';
			const p = fs.ext('C:\\Program Files\\Test\\path.exe');
			expect(fs.abs(p)).toEqual('C:\\Program Files\\Test\\path.exe');
		});

		it('throws if importing relative path', () => {
			path.isAbsolute.and.returnValue(false);

			expect(() => {
				fs.ext('my/relative/path');
			}).toThrow();
		});
	});
});
