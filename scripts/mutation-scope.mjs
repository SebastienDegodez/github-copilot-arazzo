// Which files a mutation run mutates: only the files of a Stryker scope that a change touches.
//
// - no base (first push, manual or scheduled run) or a base Git cannot find → the whole scope;
// - a change to what decides how tests and mutants run (Stryker configs, package manifests,
//   this script) → the whole scope;
// - otherwise the scope files changed since the base (merge base of a pull request, previous
//   commit of a push) — tests, docs or other scopes alone mutate nothing.
//
// Usage: node scripts/mutation-scope.mjs <stryker config> [base sha]
// Prints the decision as JSON; in GitHub Actions also writes `run` and `mutate` to $GITHUB_OUTPUT
// and a line to the job summary.
import { execFileSync } from 'node:child_process'
import { appendFileSync, globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const WHOLE_SCOPE_TRIGGERS = [
  /^stryker\.[a-z]+\.config\.json$/,
  /^package(-lock)?\.json$/,
  /^scripts\/mutation-scope\.mjs$/,
]
const NO_BASE = /^0*$/

const gitDiff = (root, base) => execFileSync('git', ['diff', '--name-only', '--diff-filter=d', `${base}...HEAD`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  .split('\n').filter(Boolean)

/**
 * @param {{ root: string, config: string, base?: string, diff?: (root: string, base: string) => string[] }} options
 * @returns {{ mode: 'full' | 'changed' | 'none', files: string[], reason: string }}
 */
export const mutationScope = ({ root, config, base = '', diff = gitDiff }) => {
  const { mutate } = JSON.parse(readFileSync(join(root, config), 'utf8'))
  const scope = [...new Set(mutate.flatMap((pattern) => globSync(pattern, { cwd: root })))].sort()
  const full = (reason) => ({ mode: 'full', files: scope, reason })
  if (NO_BASE.test(base)) return full('no base to compare with')
  let changed
  try {
    changed = diff(root, base)
  } catch {
    return full(`base ${base.slice(0, 7)} is not in the history`)
  }
  const trigger = changed.find((file) => WHOLE_SCOPE_TRIGGERS.some((pattern) => pattern.test(file)))
  if (trigger) return full(`${trigger} changed`)
  const files = scope.filter((file) => changed.includes(file))
  return files.length
    ? { mode: 'changed', files, reason: `${files.length} of ${scope.length} files changed` }
    : { mode: 'none', files: [], reason: 'no source file of this scope changed' }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [config, base = ''] = process.argv.slice(2)
  if (!config) {
    process.stderr.write('Usage: node scripts/mutation-scope.mjs <stryker config> [base sha]\n')
    process.exit(2)
  }
  const decision = mutationScope({ root: process.cwd(), config, base })
  process.stdout.write(`${JSON.stringify(decision)}\n`)
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `run=${decision.mode !== 'none'}\nmutate=${decision.files.join(',')}\n`)
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const what = decision.mode === 'none' ? 'skipped' : `${decision.mode === 'full' ? 'whole scope' : 'changed files'}`
    const list = decision.files.map((file) => `- \`${file}\``).join('\n')
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Mutation \`${config}\`: ${what}\n\n${decision.reason}.\n\n${decision.mode === 'changed' ? `${list}\n` : ''}`)
  }
}
