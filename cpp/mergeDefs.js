function mergeDefs(defs, newDefs) {
	for (const [key, val] of newDefs) {
		if (defs.has(key)) {
			throw new Error(`${key} is already defined`);
		}

		defs.set(key, val);
	}

	return defs;
}

module.exports = { mergeDefs };
