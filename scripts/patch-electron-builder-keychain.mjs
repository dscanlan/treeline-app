#!/usr/bin/env node

// electron-builder <=26.16.0 passes the imported .p12 password to
// `security set-key-partition-list -k`, but newer macOS versions require the
// temporary keychain's own password. Backport the merged upstream fix until a
// stable electron-builder release includes it:
// https://github.com/electron-userland/electron-builder/pull/10172

import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const target = require.resolve('app-builder-lib/out/codeSign/macCodeSign.js');

const replacements = [
  [
    'return await importCerts(keychainFile, certPaths, cscPasswords);',
    'return await importCerts(keychainFile, certPaths, cscPasswords, keychainPassword);',
  ],
  [
    'async function importCerts(keychainFile, paths, keyPasswords) {',
    'async function importCerts(keychainFile, paths, keyPasswords, keychainPassword) {',
  ],
  [
    '["set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", password, keychainFile]',
    '["set-key-partition-list", "-S", "apple-tool:,apple:", "-s", "-k", keychainPassword, keychainFile]',
  ],
];

let source = readFileSync(target, 'utf8');
if (replacements.every(([, replacement]) => source.includes(replacement))) {
  console.log('electron-builder keychain fix already present');
  process.exit(0);
}

for (const [expected, replacement] of replacements) {
  const occurrences = source.split(expected).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `Cannot safely patch ${target}: expected one occurrence, found ${occurrences}. ` +
        'Upgrade electron-builder and remove this backport if upstream changed.',
    );
  }
  source = source.replace(expected, replacement);
}

writeFileSync(target, source);
console.log('applied electron-builder macOS keychain password fix');
