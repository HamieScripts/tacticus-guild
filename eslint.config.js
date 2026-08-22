// @ts-check
const eslint = require('@eslint/js');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

module.exports = tseslint.config(
  {
    ignores: ['legacy/**', 'dist/**', 'scripts/**', 'data/**', '.angular/**'],
  },
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...tseslint.configs.stylistic,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      '@angular-eslint/use-component-view-encapsulation': 'off',
    },
  },
  {
    // Architecture rule: components are data-driven, they communicate only via input()/output().
    files: ['src/app/components/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@services/*', '**/services/*'], message: 'Only pages may use data services.' },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.name="inject"]',
          message: 'Components must not inject services. Pass data in via input().',
        },
      ],
    },
  },
  {
    // Architecture rule: the core tier is pure TypeScript, free of Angular.
    files: ['src/app/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@angular/*'], message: 'core/ must stay framework-free.' }] },
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
    rules: {},
  },
);
