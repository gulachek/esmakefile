/**
 * Test to see if an object is Iterable
 * @param obj The object to test
 * @returns true if the object is Iterable
 */
export function isIterable(obj: unknown): obj is Iterable<unknown> {
	return typeof obj === 'object' && Symbol.iterator in obj;
}

/**
 * Iterate over an object that could be Iterable or scalar
 * @param obj The object to iterate over
 * @returns An object to iterate regardless of the object being scalar
 */
export function* iterate<T>(obj: T | Iterable<T>): Generator<T> {
	if (isIterable(obj)) {
		for (const elem of obj) yield elem;
	} else {
		yield obj;
	}
}
