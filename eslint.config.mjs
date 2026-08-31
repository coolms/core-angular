// @ts-check
/**
 * ESLint config for `@coolms/core-angular`.
 *
 * The 30 sources here were linted as `src/app/core/**` right up until they
 * moved into a package of their own, at which point they fell outside the
 * admin's `src/**` scope and stopped being checked at all. Nothing reported
 * that -- an extraction takes code OUT of a tool's configured scope silently,
 * exactly as it does for phpstan. This file puts them back under a bar.
 *
 * **One bar, not a fork.** The rules come from the same
 * `packages/eslint.config.base.mjs` factory the admin SPA uses, so a rule
 * added there reaches this package too. The factory takes its runtime deps as
 * arguments because it lives outside any `node_modules` tree; ours resolve
 * through the relative `node_modules` symlink into the admin's, which is the
 * same one that keeps a single `@angular` tree in play for the build.
 *
 * The base is VENDORED here as `eslint.config.base.mjs`, a byte-identical
 * copy of `packages/eslint.config.base.mjs`. That is what lets this package
 * lint inside its own repository, where the shared file does not exist.
 * `make check-fe` fails if a copy drifts; fix drift by editing the canonical
 * file and running `node tools/sync-eslint-base.mjs`, never by editing the
 * copy -- an edit in place is reverted by the next sync, silently.
 */

import createBaseConfig from './eslint.config.base.mjs';
import angular from 'angular-eslint';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/** @type {import('typescript-eslint').ConfigArray} */
export default tseslint.config(
    ...createBaseConfig({ tseslint, globals }),

    // `tsconfig.lib.json` excludes specs, so a type-checked rule has no
    // program for them and fails to parse rather than reporting anything
    // useful. The specs are type-checked by the admin's `tsconfig.spec.json`,
    // which names this package's `src/**/*.spec.ts` explicitly.
    {
        ignores: ['dist/**', 'src/**/*.spec.ts'],
    },

    {
        files: ['**/*.ts'],
        languageOptions: {
            parserOptions: {
                project: ['./tsconfig.lib.json'],
                tsconfigRootDir: import.meta.dirname,
            },
        },
        plugins: {
            '@angular-eslint': angular.tsPlugin,
        },
        processor: angular.processInlineTemplates,
        rules: {
            ...angular.configs.tsRecommended.at(-1).rules,

            // The one component in here is the login page, and it is `app-`
            // prefixed like the app it came from. A package that ships a
            // component should own a prefix, but renaming a selector is a
            // consumer-visible change and belongs to whoever decides this
            // package's public element names -- not to a lint pass.
            '@angular-eslint/component-selector': [
                'warn',
                { type: 'element', prefix: ['app', 'cms', 'coolms'], style: 'kebab-case' },
            ],
            '@angular-eslint/directive-selector': [
                'warn',
                { type: 'attribute', prefix: ['app', 'cms', 'coolms'], style: 'camelCase' },
            ],
            '@angular-eslint/prefer-on-push-component-change-detection': 'warn',

            // Every fire of this rule in this package was the same line:
            // `store.selectSnapshot(SomeState.someSelector)`. An NGXS selector
            // is a STATIC member built by `@Selector()` and never touches
            // `this`, so passing it unbound is the documented API, not a
            // scoping bug. `ignoreStatic` drops exactly those and leaves the
            // rule live for instance methods, where the hazard is real -- the
            // admin blanket-downgrades this to a warning, which would also
            // have hidden the real ones.
            '@typescript-eslint/unbound-method': ['error', { ignoreStatic: true }],
        },
    },

    // Templates carry no TS type info; the type-checked rules expect a TS AST
    // and trip over the extracted inline ones.
    {
        files: ['**/*.html'],
        ...tseslint.configs.disableTypeChecked,
    },
    {
        files: ['**/*.html'],
        languageOptions: { parser: angular.templateParser },
        plugins: { '@angular-eslint/template': angular.templatePlugin },
        rules: {
            ...angular.configs.templateRecommended.at(-1).rules,
            '@angular-eslint/template/click-events-have-key-events': 'warn',
            '@angular-eslint/template/interactive-supports-focus': 'warn',
        },
    },
);
