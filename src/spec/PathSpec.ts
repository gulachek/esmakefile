import { isPathLike, Path, isBuildPathLike, BuildPath } from '..';
import { expect } from 'chai';
import { PathType } from '../Path';

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
		expect(isBuildPathLike(BuildPath.from('hello'))).to.be.true;
	});

	it('returns false otherwise', () => {
		expect(isBuildPathLike(Path.src('hello'))).to.be.false;
	});
});

describe('Path', () => {
	describe('src', () => {
		it('makes a src path out of a string', () => {
			const path = Path.src('hello/world');
			expect(path.type).to.equal(PathType.src);
		});

		it('returns a path as is', () => {
			const path = BuildPath.from('hello/world');
			const src = Path.src(path);
			expect(src).to.equal(path);
		});

		it('throws when given an invalid type', () => {
			expect(() => Path.src(false as any)).to.throw();
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
			expect(path.abs('/test')).to.equal('/test/external.txt');
		});
	});

	describe('toString', () => {
		it('prepends @src to relative path', () => {
			const path = Path.src('hello.txt');
			expect(path.toString()).to.equal('@src/hello.txt');
		});

		it('prepends @build to relative path', () => {
			const path = BuildPath.from('hello.txt');
			expect(path.toString()).to.equal('@build/hello.txt');
		});
	});

	describe('dir', () => {
		it('has parent path', () => {
			const path = Path.src('hello/world.txt');
			expect(path.dir.rel()).to.equal('hello');
		});

		it('has same type as path', () => {
			const path = Path.src('hello/world.txt');
			expect(path.dir.type).to.equal(PathType.src);
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
	});
});
