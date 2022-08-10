function mergeDefs(defs, newDefs) {
	for (const key in newDefs) {
		if (!newDefs.hasOwnProperty(key)) { continue; }

		if (defs.hasOwnProperty(key)) {
			throw new Error(`${key} is already defined`);
		}

		defs[key] = newDefs[key];
	}

	return defs;
}

module.exports = { mergeDefs };
