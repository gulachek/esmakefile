/**
 * Test to see if an object is Iterable
 * @param obj The object to test
 * @returns true if the object is Iterable
 */
export function isIterable(obj: any): obj is Iterable<any> {
	return obj && typeof obj[Symbol.iterator] === 'function';
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
