// Preloaded with --import before dist/main.js; installs the resolve hook that
// makes the compiled (extensionless-importing) package dists Node-clean.
import { register } from 'node:module';

register('./node-extensions-resolver.mjs', import.meta.url);
