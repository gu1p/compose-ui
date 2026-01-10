import js from '@eslint/js';
import globals from 'globals';
import sveltePlugin from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';
import tseslint from 'typescript-eslint';

const tsProjectOptions = {
  project: ['./tsconfig.json'],
  tsconfigRootDir: import.meta.dirname
};

const tsConfigs = tseslint.configs.recommendedTypeChecked.map((config) => ({
  ...config,
  files: config.files ?? ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
  languageOptions: {
    ...(config.languageOptions ?? {}),
    parserOptions: {
      ...(config.languageOptions?.parserOptions ?? {}),
      ...tsProjectOptions
    },
    globals: {
      ...globals.browser,
      ...globals.node,
      ...(config.languageOptions?.globals ?? {})
    }
  }
}));

export default [
  {
    ignores: ['dist/**', 'node_modules/**']
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        svelteConfig: './svelte.config.js',
        parser: tseslint.parser,
        extraFileExtensions: ['.svelte'],
        ...tsProjectOptions
      },
      globals: {
        ...globals.browser,
        ...globals.node
      }
    },
    plugins: {
      svelte: sveltePlugin
    },
    rules: {
      ...sveltePlugin.configs['flat/recommended'].rules,
      ...sveltePlugin.configs['flat/prettier'].rules
    }
  },
  ...tsConfigs,
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    rules: {
      ...js.configs.recommended.rules
    }
  }
];
