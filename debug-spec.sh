#!/bin/bash

# Run in current directory. Connect via chrome and add debugger statement to line that's being hit.
node --inspect-brk ./node_modules/mocha/bin/mocha.js
