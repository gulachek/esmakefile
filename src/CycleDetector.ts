import { IBuildPath } from './Path.js';

type EdgeList = Set<number>[];

export class CycleDetector {
	private _nodes = new Map<string, number>();
	private _paths: IBuildPath[] = [];
	private _edges: EdgeList = [];

	/**
	 * Add node if it isn't already added
	 * @param path The path to add a node for
	 * @returns The node ID associated with the path
	 */
	private addNode(path: IBuildPath): number {
		const rel = path.rel();
		let nodeId = this._nodes.get(rel);
		if (typeof nodeId === 'number') {
			return nodeId;
		}

		nodeId = this._paths.length;
		this._paths.push(path);
		this._edges.push(new Set<number>());
		this._nodes.set(rel, nodeId);
		return nodeId;
	}

	public addEdge(from: IBuildPath, to: IBuildPath): void {
		const fromId = this.addNode(from);
		const toId = this.addNode(to);
		this._edges[fromId].add(toId);
	}

	public findCycle(): FindCycleResult {
		// want to quickly rule out cycle
		const search = new CycleSearch(this._edges);
		const nodeId = search.findCycle();
		if (typeof nodeId !== 'number') {
			return null;
		}

		const bfs = new BfsSelfSearch(this._edges);
		const nodes = bfs.search(nodeId);
		if (!nodes) {
			const path = this._paths[nodeId];
			throw new Error(
				`Cycle detected for target '${path.rel()}', but the nodes in the path were not correctly identified. You should remove the cycle if it exists in your Makefile and also file an issue with esmakefile.`,
			);
		}

		return { path: nodes.map((id) => this._paths[id]) };
	}
}

export type FindCycleResult = null | { path: IBuildPath[] };

class CycleSearch {
	private _reach: EdgeList = [];
	private _backReach: EdgeList = [];

	constructor(edges: EdgeList) {
		this._backReach = edges.map((_) => new Set<number>());

		for (let from = 0; from < edges.length; ++from) {
			this._reach.push(new Set<number>(edges[from]));

			for (const to of edges[from]) {
				this._backReach[to].add(from);
			}
		}
	}

	private _addEdge(from: number, to: number): void {
		this._reach[from].add(to);
		this._backReach[to].add(from);
	}

	private _removeEdge(from: number, to: number): void {
		this._reach[from].delete(to);
		this._backReach[to].delete(from);
	}

	public findCycle(): number | null {
		for (let i = 0; i < this._reach.length; ++i) {
			if (this._reach[i].has(i)) {
				return i;
			}

			for (const to of this._reach[i]) {
				for (const from of this._backReach[i]) {
					this._addEdge(from, to);
				}
			}

			for (const from of this._backReach[i]) {
				this._removeEdge(from, i);
			}

			for (const to of this._reach[i]) {
				this._removeEdge(i, to);
			}
		}

		return null;
	}
}

class BfsSelfSearch {
	private _edges: EdgeList;

	constructor(edges: EdgeList) {
		this._edges = edges;
	}

	public search(node: number): null | number[] {
		const nodesToExplore = [...this._edges[node]];
		const shortestPointee = new Map<number, number>();
		for (const firstStep of nodesToExplore) {
			shortestPointee.set(firstStep, node);
		}

		let found = false;
		while (nodesToExplore.length > 0) {
			const currentNode = nodesToExplore.shift();
			if (currentNode === node) {
				found = true;
				break;
			}

			for (const nextNode of this._edges[currentNode]) {
				if (shortestPointee.has(nextNode)) {
					continue;
				}

				shortestPointee.set(nextNode, currentNode);
				nodesToExplore.push(nextNode);
			}
		}

		if (!found) return null;

		const path = [];
		let destNode = node;

		do {
			destNode = shortestPointee.get(destNode);
			path.unshift(destNode);
		} while (destNode !== node);

		return path;
	}
}
