type WeakNode<T extends object> = {
	value: WeakRef<T>;
	next?: WeakNode<T>;
};

export class WeakLinkedList<T extends object> implements Iterable<T> {
	private head?: WeakNode<T>;
	private tail?: WeakNode<T>;

	*[Symbol.iterator](): Generator<T> {
		let head: WeakNode<T> | undefined = this.head;
		if (!head) return;

		// first make sure head has a value
		let headElem = head.value.deref() as T | undefined;
		while (head && !headElem) {
			head = this.head = head.next;
			headElem = head && head.value.deref();
		}

		if (headElem) yield headElem;
		else return;

		let current: WeakNode<T> = head;
		let next: WeakNode<T> | undefined = current.next;
		while (next) {
			const elem: T | undefined = next.value.deref();
			if (elem) {
				yield elem;
				current = next;
				next = next.next;
			} else {
				next = current.next = next.next;
			}
		}
	}

	prune(): number {
		// full iteration causes a prune
		let n = 0;
		for (const _ of this) {
			n += 1;
		}
		return n;
	}

	push(elem: T): T {
		const node = { value: new WeakRef<T>(elem) };

		const tail = this.tail;
		if (tail) {
			tail.next = node;
		}

		this.tail = node;

		if (!this.head) {
			this.head = node;
		}

		return elem;
	}
}
