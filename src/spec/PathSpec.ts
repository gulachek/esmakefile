import {
	rebasePath,
	isPathLike,
	Path,
	isBuildPathLike,
	PathType,
} from '../index.js';

import { expect } from 'chai';

import { resolve, join } from 'node:path';

describe('rebasePath', () => {
	it('rebases a path', () => {
		const result = rebasePath('a/b/c.js', 'a', 'a2');
		expect(result).to.equal('a2/b/c.js');
	});

	it('throws if path is not relative to fromBase', () => {
		expect(() => rebasePath('a', 'b', 'c')).to.throw(/Cannot rebase/i);
	});

	it('resolves given .. paths that stay within base', () => {
		const result = rebasePath('a/b/../c.js', 'a', 'a2');
		expect(result).to.equal('a2/c.js');
	});
});

describe('isPathLike', () => {
	it('returns true for strings', () => {
		expect(isPathLike('hello')).to.be.true;
	});

	it('returns true for Paths', () => {
		expect(isPathLike(Path.src('hello'))).to.be.true;
	});

	it('returns false otherwise', () => {
		expect(isPathLike(true)).to.be.false;
	});
});

describe('isBuildPathLike', () => {
	it('returns true for strings', () => {
		expect(isBuildPathLike('hello')).to.be.true;
	});

	it('returns true for BuildPaths', () => {
		expect(isBuildPathLike(Path.build('hello'))).to.be.true;
	});

	it('returns false otherwise', () => {
		expect(isBuildPathLike(Path.src('hello'))).to.be.false;
	});
});

describe('Path', () => {
	describe('isPath', () => {
		it('returns false for non objects', () => {
			expect(Path.isPath(undefined)).to.be.false;
			expect(Path.isPath(true)).to.be.false;
			expect(Path.isPath(null)).to.be.false;
			expect(Path.isPath(24)).to.be.false;
		});

		it('returns false when object\'s constructor is not named "Path"', () => {
			const p = {
				type: PathType.build,
				components: ['test'],
			};

			expect(Path.isPath(p)).to.be.false;
		});
	});

	describe('src', () => {
		it('makes a src path out of a string', () => {
			const path = Path.src('hello/world');
			expect(path.type).to.equal(PathType.src);
		});

		it('returns a path as is', () => {
			const path = Path.build('hello/world');
			const src = Path.src(path);
			expect(src).to.equal(path);
		});

		it('throws when given an invalid type', () => {
			expect(() => Path.src(false as unknown as string)).to.throw();
		});

		it('normalizes .. as parent directory', () => {
			const path = Path.src('hello/../world');
			expect(path.rel()).to.equal('world');
		});

		it('normalizes . as current directory', () => {
			const path = Path.src('hello/../world');
			expect(path.rel()).to.equal('world');
		});

		it('normalizes empty dirs away', () => {
			const path = Path.src('hello/./world');
			expect(path.rel()).to.equal('hello/world');
		});

		it('does not allow .. to go above source root', () => {
			const path = Path.src('../external.txt');
			const cwd = resolve('.');
			expect(path.abs(cwd)).to.equal(join(cwd, 'external.txt'));
		});
	});

	describe('build', () => {
		it('makes a build path out of a string', () => {
			const path = Path.build('hello/world');
			expect(path.type).to.equal(PathType.build);
		});

		it('returns a build path as is', () => {
			const path = Path.build('hello/world');
			const build = Path.build(path);
			expect(build).to.equal(path);
		});

		it('throws when given an invalid type', () => {
			expect(() => Path.build(false as unknown as string)).to.throw();
		});

		it('normalizes the path', () => {
			const path = Path.build('hello/../world');
			expect(path.rel()).to.equal('world');
		});
	});

	describe('toString', () => {
		it('prepends @src to relative path', () => {
			const path = Path.src('hello.txt');
			expect(path.toString()).to.equal('@src/hello.txt');
		});

		it('prepends @build to relative path', () => {
			const path = Path.build('hello.txt');
			expect(path.toString()).to.equal('@build/hello.txt');
		});
	});

	describe('dir', () => {
		it('has parent path', () => {
			const path = Path.src('hello/world.txt');
			expect(path.dir().rel()).to.equal('hello');
		});

		it('has same type as path', () => {
			const path = Path.src('hello/world.txt');
			expect(path.dir().type).to.equal(PathType.src);
		});
	});

	describe('basename', () => {
		it('returns filename and extension', () => {
			const path = Path.src('hello/world.txt');
			expect(path.basename).to.equal('world.txt');
		});

		it('returns empty string with an empty path', () => {
			const path = Path.src('');
			expect(path.basename).to.equal('');
		});
	});

	describe('extname', () => {
		it('returns extension of basename', () => {
			const path = Path.src('hello/world.txt');
			expect(path.extname).to.equal('.txt');
		});

		it('returns empty string with an empty path', () => {
			const path = Path.src('');
			expect(path.extname).to.equal('');
		});
	});

	describe('join', () => {
		it('adds components to a path', () => {
			const path = Path.src('hello/world');
			const child = path.join('file.txt');
			expect(child.rel()).to.equal('hello/world/file.txt');
		});

		it('normalizes the given paths', () => {
			const path = Path.src('hello/world');
			const child = path.join('../file.txt');
			expect(child.rel()).to.equal('hello/file.txt');
		});

		it('has the same type as the original path', () => {
			const path = Path.src('hello');
			const child = path.join('file.txt');
			expect(child.type).to.equal(path.type);
		});

		it('accepts multiple string arguments', () => {
			const path = Path.src('hello');
			const child = path.join('sub', '../..', 'file.txt');
			expect(child.rel()).to.equal('file.txt');
		});
	});
});
