// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // src/db owns the SQLite files and where they live (Library/Application Support on iOS):
    // opening one by name elsewhere would create a second, empty copy in Documents/SQLite.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/db/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'expo-sqlite/kv-store', message: "Use '@/db/kv' (same API)." },
            { name: 'expo-sqlite', importNames: ['openDatabaseSync', 'openDatabaseAsync'], message: "Use db() or indexDb() from '@/db'." },
          ],
        },
      ],
    },
  },
]);
