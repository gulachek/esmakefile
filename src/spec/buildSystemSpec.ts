require('jasmine-core');

import { Target, BuildSystem, Path } from '../index';
import * as path from 'path';

class MyTarget extends Target
{
	called: boolean = false;

	constructor(sys: BuildSystem)
	{
		super(sys);
	}

	build()
	{
		this.called = true;
		return Promise.resolve();
	}
}

describe('BuildSystem', () => {
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

		expect(t.called).toBeTruthy();
	});

	it('continues waiting if target is promise resolution', async () => {
		const b = new BuildSystem();
		const t = new MyTarget(b);

		await b.build(Promise.resolve(t));

		expect(t.called).toBeTruthy();
	});
});
