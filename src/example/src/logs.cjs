// eslint-disable-next-line @typescript-eslint/no-var-requires
const { stderr, stdout, exit } = require('node:process');

stderr.write('stderr\n');
stdout.write('stdout\n');
exit(1);
