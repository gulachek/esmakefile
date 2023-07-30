#!/bin/bash

# Run in current directory. Connect via chrome and add debugger statement to line that's being hit.
node --inspect-brk ./node_modules/jasmine/bin/jasmine.js --config=jasmine.json
