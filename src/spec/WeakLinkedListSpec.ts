import { WeakLinkedList } from '../WeakLinkedList.js';
import { expect } from 'chai';

function o(n: number): object {
	return new Number(n);
}

describe('WeakLinkedList', () => {
	describe('Symbol.iterator', () => {
		it('iterates elements in insertion order', () => {
			const wl = new WeakLinkedList<object>();
			const o1 = wl.push(o(1));
			const o2 = wl.push(o(2));

			const a = Array.from(wl);
			expect(a).to.deep.equal([o1, o2]);
		});
	});

	describe('prune', () => {
		it('clears out references that are no longer held', () => {
			const wl = new WeakLinkedList<object>();
			const o1 = wl.push(o(1));
			const o2 = wl.push(o(2));

			expect(wl.prune()).to.equal(2);

			// only adding these to avoid compiler warnings about unused vars
			expect(o1).not.to.be.null;
			expect(o2).not.to.be.null;
		});
	});
});
