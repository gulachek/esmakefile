# TSDoc Conventions

## When to add TSDoc

The following are the expectations for adding TSDoc comments:

1. Every export in the public API (`src/index.ts`) MUST have
   TSDoc comments.

  This is a no brainer. Users will expect documentation for
  public entities.

2. Every internal export (not in `src/index.ts`) SHOULD have
   TSDoc comments.

  If something is expected to be used across the codebase, it's
  likely useful to have inline help in editors. However, some
  things are straightforward and don't always require TSDoc.

3. Non exported entities MAY have TSDoc comments.

  Most entities local to a file don't need extra documentation.
  Prefer making a longer, more descriptive, name for something
  if it will suffice for readability. If something is complex
  enough such that readability will benefit from TSDoc, then it
  makes sense to add it.

## Parameter cross-references

When a function's documentation references a parameter by name,
use markdown-style backticks to format it.

```typescript
/**
 * Compute the foo-product of two strings
 * @param a The first parameter
 * @param b References the `a` parameter
 * @returns The foo-product of `a` and `b`
 */
export function foo(a: string, b: string): string { /*...*/ }
```

An example of when _not_ to use this is for entities that have
their own TSDoc comments. In this case, a `{@link entity}`
should be used.

## Internet links

If an internet link is being provided, it should generally be
formatted as follows:

```typescript
/** {@link http://my-link/a/b/links-are-ugly | readable link text} */
```
