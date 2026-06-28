#!/bin/bash

script=$(realpath "$0")
rootDir=$(dirname "$script")

spec="$1"

if [ -z "$spec" ]; then
	# Run in current directory. Connect via chrome and add debugger statement to line that's being hit.
	node --inspect-brk ./node_modules/mocha/bin/mocha.js
	exit $?
fi

# Confirm this is a .js or .ts spec file
if [ ! -r "$spec" ]; then
	echo "File '$spec' is not a readable file" >&2
	exit 1
fi

if [[ "$spec" != */spec/*.[jt]s ]]; then
	echo "File '$spec' is not a mocha test" >&2
	exit 1
fi

spec=$(realpath "$spec")

# Transform ".ts" to corresponding ".js"
if [ "${spec:(-3)}" = ".ts" ]; then
	srcRoot="$rootDir/src/"
	distRoot="$rootDir/dist/"
	specRel="${spec#$srcRoot}"
	spec="${distRoot}${specRel%%.ts}.js"
fi

node --inspect-brk ./node_modules/mocha/bin/mocha.js --config=<(echo '{}') "$spec"
