export type SimpleShape<T> = T | T[] | Record<string, T>;

export type ElemOf<S extends SimpleShape<unknown>> = S extends SimpleShape<
	infer T
>
	? T
	: never;

type MappedRecordType<S extends Record<string, unknown>, TNew> = {
	[P in keyof S]: TNew;
};

export type MappedShape<
	S extends SimpleShape<unknown>,
	TNew,
> = S extends ElemOf<S>
	? TNew
	: S extends unknown[]
	? TNew[]
	: S extends Record<string, unknown>
	? MappedRecordType<S, TNew>
	: never;

function isArray<T>(obj: unknown): obj is T[] {
	return Array.isArray(obj);
}

type TypeGuard<T> = (obj: unknown) => obj is T;

function* iterateObj<T>(obj: Record<string, T>): Generator<[string, T]> {
	for (const k in obj) yield [k, obj[k]];
}

export function* iterateShape<S extends SimpleShape<unknown>>(
	shape: S,
	typeGuard: TypeGuard<ElemOf<S>>,
): Generator<ElemOf<S>> {
	type E = ElemOf<S>;

	if (typeGuard(shape)) {
		yield shape;
		return;
	}

	if (isArray<E>(shape)) {
		for (const elem of shape) yield elem;
		return;
	}

	const recordShape = shape as Record<string, E>;
	for (const entry of iterateObj(recordShape)) {
		yield entry[1];
	}
}

export function mapShape<S extends SimpleShape<unknown>, TNew>(
	shape: S,
	typeGuard: TypeGuard<ElemOf<S>>,
	fn: (elem: ElemOf<S>) => TNew,
): MappedShape<S, TNew> {
	type E = ElemOf<S>;

	if (typeGuard(shape)) {
		return fn(shape) as MappedShape<S, TNew>;
	}

	if (isArray<E>(shape)) {
		const out: TNew[] = [];
		for (const elem of shape) {
			out.push(fn(elem));
		}

		return out as MappedShape<S, TNew>;
	}

	const recordShape = shape as Record<string, E>;
	const out: Record<string, TNew> = {};
	for (const [k, v] of iterateObj(recordShape)) {
		out[k] = fn(v);
	}
	return out as MappedShape<S, TNew>;
}
