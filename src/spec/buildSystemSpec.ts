require('jasmine-core');

import { Target, BuildSystem } from '../buildSystem';
import { Path, PathLike } from '../path';

import * as path from 'path';

class MyTarget extends Target
{
	static counter: number = 0;
	count: number = -1;

	constructor(sys: BuildSystem, p?: PathLike)
	{
		super(sys, p);
	}

	build()
	{
		this.count = ++MyTarget.counter;
		return Promise.resolve();
	}

	mtime()
	{
		return this.count >= 0 ? new Date(this.count) : null;
	}
}

describe('BuildSystem', () => {
	beforeEach(() => {
		MyTarget.counter = 0;
	});

	it('puts the source directory to the running script"s dir', () => {
		const b = new BuildSystem();
		const self = require.main.path;
		expect(b.abs('hello/world')).toEqual(path.resolve(self, 'hello/world'));
	});

	it('puts the build directory in the current working dir"s build dir', () => {
		const b = new BuildSystem();
		expect(b.abs(Path.dest('hello'))).toEqual(path.resolve('build/hello'));
	});

	it('turns a path into a target', () => {
		const b = new BuildSystem();
		const t = b.src('hello/world');
		expect(t instanceof Target).toBeTruthy();
	});

	it('turns a target into a path', () => {
		const b = new BuildSystem();
		const t = b.src(Path.dest('hello/world'));
		expect(b.abs(t)).toEqual(path.resolve('build/hello/world'));
	});

	it('waits for gulp function to be done', async () => {
		const b = new BuildSystem();
		let called = false;

		await b.build((cb) => {
			setTimeout(() => {
				called = true;
				cb();
			}, 5);
		});

		expect(called).toBeTruthy();
	});

	it('waits for promise to be done', async () => {
		const b = new BuildSystem();
		let called = false;

		await b.build(Promise.resolve().then(() => {
				called = true;
		}));

		expect(called).toBeTruthy();
	});

	it('waits for target to be built', async () => {
		const b = new BuildSystem();
		const t = new MyTarget(b);

		await b.build(t);

		expect(t.mtime).toBeTruthy();
	});

	it('continues waiting if target is promise resolution', async () => {
		const b = new BuildSystem();
		const t = new MyTarget(b);

		await b.build(Promise.resolve(t));

		expect(t.mtime).toBeTruthy();
	});

	it('waits for dependency to be built', async () => {
		const b = new BuildSystem();
		const t = new MyTarget(b);
		const dep = new MyTarget(b);

		t.dependsOn(dep);

		await b.build(t);

		expect(dep.mtime).toBeTruthy();
		expect(t.count).toBeGreaterThan(dep.count);
	});

	it('only builds targets once', async () => {
		const b = new BuildSystem();
		const t = new MyTarget(b);
		const dep = new MyTarget(b);

		t.dependsOn(dep, dep);

		await b.build(t);

		expect(dep.count).toEqual(1);
	});

	it('simultaneous builds of same path are ignored', async () => {
		const b = new BuildSystem();
		const t = new MyTarget(b);
		const dep1 = new MyTarget(b, 'dep');
		const dep2 = new MyTarget(b, 'dep');

		t.dependsOn(dep1, dep2);

		await b.build(t);

		expect(dep1.count).toEqual(1);
		expect(dep2.count).toEqual(-1);
	});
});
