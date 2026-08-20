import ts from 'typescript'
import { defineConfig } from 'vitest/config'

const decoratorSyntax = /^\s*@[A-Za-z_$][\w$]*/m

/**
 * Transform standard TypeScript decorators before Vite's default parser sees
 * source files (the harness's `@Remote` markers and similar).
 * @returns a pre-transform Vite plugin shared by all test configurations.
 */
export function standardDecoratorPlugin() {
  return {
    name: 'dsh-standard-decorators',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      const file = id.split('?', 1)[0]!
      if (!/\.[cm]?tsx?$/.test(file) || !decoratorSyntax.test(code)) return
      const result = ts.transpileModule(code, {
        fileName: file,
        compilerOptions: {
          target: ts.ScriptTarget.ES2024,
          module: ts.ModuleKind.ESNext,
          jsx: file.endsWith('x') ? ts.JsxEmit.ReactJSX : undefined,
          sourceMap: true,
        },
      })
      return {
        code: result.outputText.replace(/\n?\/\/# sourceMappingURL=.*$/u, '\n'),
        map: result.sourceMapText,
      }
    },
  }
}

/**
 * Stub every CSS import during tests: @deepseek-ai/dsh-client-ui-primitives
 * reaches katex's katex.min.css, which node would try to load natively and
 * fail on ("Unknown file extension"). Tests assert behavior, not styles.
 * @returns a Vite plugin answering every `.css` import with an empty module.
 */
export function cssStubPlugin() {
  return {
    name: 'dsh-test-css-stub',
    resolveId(source: string) {
      if (source.endsWith('.css')) return `\0dsh-css:${source}`
      return null
    },
    load(id: string) {
      if (id.startsWith('\0dsh-css:')) return 'export default {}'
      return null
    },
  }
}

/**
 * Keep the UI primitives (and katex) inside the Vite transform pipeline:
 * externalized, node would load their CSS imports natively and fail.
 * Vitest reads resolve.noExternal (not ssr.noExternal) and forwards it to
 * server.deps.inline for each environment.
 */
export const TEST_NO_EXTERNAL = ['@deepseek-ai/dsh-client-ui-primitives', 'katex'] as const

export default defineConfig({
  plugins: [standardDecoratorPlugin(), cssStubPlugin()],
  resolve: {
    noExternal: [...TEST_NO_EXTERNAL],
  },
  test: {
    environment: 'node',
  },
})
