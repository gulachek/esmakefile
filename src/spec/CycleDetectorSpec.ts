import { CycleDetector } from '../CycleDetector.js';
import { Path } from '../Path.js';
import { expect } from 'chai';

describe('CycleDetector', () => {
	let cd: CycleDetector;

	function edge(from: string, to: string): void {
		cd.addEdge(Path.build(from), Path.build(to));
	}

	function expectCycle(...seq: string[]): void {
		const result = cd.findCycle();
		expect(result).not.to.be.null;
		const rels = result.path.map((p) => p.rel());
		rotateToAlignStart(seq, rels);
		expect(seq).to.deep.equal(rels);
	}

	beforeEach(() => {
		cd = new CycleDetector();
	});

	describe('findCycle', () => {
		it('returns null for an empty graph', () => {
			const result = cd.findCycle();
			expect(result).to.be.null;
		});

		it('returns null for a graph with no cycle', () => {
			edge('a', 'b');
			const result = cd.findCycle();
			expect(result).to.be.null;
		});

		it('finds length 1 cycle', () => {
			edge('a', 'a');
			expectCycle('a');
		});

		it('finds length 2 cycle', () => {
			edge('a', 'b');
			edge('b', 'a');
			expectCycle('a', 'b');
		});

		it('finds length 2 cycle w 3 nodes', () => {
			edge('a', 'b');
			edge('a', 'c');
			edge('c', 'a');
			expectCycle('a', 'c');
		});

		it('finds length 3 cycle', () => {
			edge('a', 'b');
			edge('b', 'c');
			edge('c', 'a');
			expectCycle('a', 'b', 'c');
		});

		it('finds length 4 cycle', () => {
			edge('a', 'b');
			edge('b', 'c');
			edge('c', 'd');
			edge('d', 'a');
			expectCycle('a', 'b', 'c', 'd');
		});

		it('finds length 4 cycle added in reverse', () => {
			edge('d', 'a');
			edge('c', 'd');
			edge('b', 'c');
			edge('a', 'b');
			expectCycle('a', 'b', 'c', 'd');
		});

		it('finds shortest cycle', () => {
			edge('a', 'b');
			edge('a', 'c');
			edge('a', 'd');
			edge('b', 'c');
			edge('b', 'd');
			edge('c', 'd');
			edge('d', 'a');
			expectCycle('a', 'd');
		});
	});
});

function rotateToAlignStart(master: string[], slave: string[]): void {
	if (master.length !== slave.length) return;

	const n = master.length;
	if (n < 1) return;

	const offset = slave.indexOf(master[0]);
	if (offset === -1) return;

	for (let i = 0; i < offset; ++i) {
		slave.push(slave.shift());
	}
}
