import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', '.wrangler', 'worker-configuration.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='localStorage']",
          message: 'Do not put data in localStorage; see docs/architecture.md (offline cache uses IndexedDB, wiped on sign-out).',
        },
      ],
    },
  },
  {
    files: ['public/sw.js'],
    languageOptions: { globals: globals.serviceworker },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Accessibility checks for JSX (WCAG). Strict mode, so problems fail the lint.
      ...jsxA11y.flatConfigs.strict.rules,
      // Our <Field> component associates its label with the input by id.
      'jsx-a11y/label-has-associated-control': ['error', { assert: 'either', controlComponents: ['Field'], depth: 3 }],
      // Data loading on mount legitimately sets state from an effect.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
);
