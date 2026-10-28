// Which files a mutation run mutates, decided on a real Git history.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { mutationScope } from '../../scripts/mutation-scope.mjs'

const SCRIPT = fileURLToPath(new URL('../../scripts/mutation-scope.mjs', import.meta.url))
const CONFIG = 'stryker.core.config.json'

const repository = async () => {
  const root = await mkdtemp(join(tmpdir(), 'mutation-scope-'))
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  const write = async (file, text = `// ${file}\n`) => {
    await mkdir(dirname(join(root, file)), { recursive: true })
    await writeFile(join(root, file), text)
  }
  const commit = (message) => {
    git('add', '-A')
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', message)
    return git('rev-parse', 'HEAD')
  }
  git('init', '-q', '-b', 'main')
  await write(CONFIG, JSON.stringify({ mutate: ['src/domain/*.mjs', 'src/application/*.mjs'] }))
  for (const file of ['src/domain/a.mjs', 'src/domain/b.mjs', 'src/application/c.mjs', 'src/infrastructure/d.mjs', 'tests/a.test.mjs', 'README.md']) await write(file)
  const base = commit('base')
  return { root, git, write, commit, base, scope: (since) => mutationScope({ root, config: CONFIG, base: since }) }
}

describe('mutation scope', () => {
  test('a change of tests, docs or another scope mutates nothing', async () => {
    const repo = await repository()
    await repo.write('tests/a.test.mjs', '// more\n')
    await repo.write('README.md', '# more\n')
    await repo.write('src/infrastructure/d.mjs', '// more\n')
    repo.commit('no core code')
    assert.deepEqual(repo.scope(repo.base), { mode: 'none', files: [], reason: 'no source file of this scope changed' })
  })

  test('only the files of the scope a change touches are mutated, deleted ones left out', async () => {
    const repo = await repository()
    await repo.write('src/domain/b.mjs', '// changed\n')
    await repo.write('src/application/c.mjs', '// changed\n')
    await repo.write('src/domain/new.mjs')
    await rm(join(repo.root, 'src/domain/a.mjs'))
    repo.commit('core code')
    assert.deepEqual(repo.scope(repo.base), {
      mode: 'changed', files: ['src/application/c.mjs', 'src/domain/b.mjs', 'src/domain/new.mjs'], reason: '3 of 3 files changed',
    })
  })

  test('a pull request is compared with its merge base, not with what main got since', async () => {
    const repo = await repository()
    repo.git('switch', '-q', '-c', 'feature')
    await repo.write('src/domain/b.mjs', '// feature\n')
    repo.commit('feature')
    repo.git('switch', '-q', 'main')
    await repo.write('src/domain/a.mjs', '// main moved on\n')
    const main = repo.commit('main')
    repo.git('switch', '-q', 'feature')
    assert.deepEqual(repo.scope(main).files, ['src/domain/b.mjs'])
  })

  test('changes to the scope selector alone do not mutate product code', async () => {
    const repo = await repository()
    await repo.write('scripts/mutation-scope.mjs', '// selector changed\n')
    repo.commit('mutation selector')
    assert.deepEqual(repo.scope(repo.base), {
      mode: 'none', files: [], reason: 'no source file of this scope changed',
    })
  })

  for (const file of [CONFIG, 'stryker.boundary.config.json', 'package.json', 'package-lock.json']) {
    test(`a change of ${file} mutates the whole scope`, async () => {
      const repo = await repository()
      await repo.write(file, '{"mutate":["src/domain/*.mjs","src/application/*.mjs"]}\n')
      repo.commit('tooling')
      assert.deepEqual(repo.scope(repo.base), { mode: 'full', files: ['src/application/c.mjs', 'src/domain/a.mjs', 'src/domain/b.mjs'], reason: `${file} changed` })
    })
  }

  test('without a base, or with a base Git cannot find, the whole scope is mutated', async () => {
    const repo = await repository()
    const all = ['src/application/c.mjs', 'src/domain/a.mjs', 'src/domain/b.mjs']
    assert.deepEqual(repo.scope(''), { mode: 'full', files: all, reason: 'no base to compare with' })
    assert.deepEqual(repo.scope('0000000000000000000000000000000000000000'), { mode: 'full', files: all, reason: 'no base to compare with' })
    assert.deepEqual(repo.scope('1234567890abcdef'), { mode: 'full', files: all, reason: 'base 1234567 is not in the history' })
  })

  test('tells GitHub Actions whether to run and what to mutate, and says why in the job summary', async () => {
    const repo = await repository()
    await repo.write('src/domain/b.mjs', '// changed\n')
    repo.commit('core code')
    const output = join(repo.root, 'output.txt')
    const summary = join(repo.root, 'summary.md')
    const run = (base) => execFileSync(process.execPath, [SCRIPT, CONFIG, base], { cwd: repo.root, encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary } })

    assert.equal(run(repo.base), '{"mode":"changed","files":["src/domain/b.mjs"],"reason":"1 of 3 files changed"}\n')
    run(repo.git('rev-parse', 'HEAD'))
    run('')
    assert.equal(await readFile(output, 'utf8'), 'run=true\nmutate=src/domain/b.mjs\nrun=false\nmutate=\nrun=true\nmutate=src/application/c.mjs,src/domain/a.mjs,src/domain/b.mjs\n')
    assert.equal(await readFile(summary, 'utf8'), [
      `### Mutation \`${CONFIG}\`: changed files\n\n1 of 3 files changed.\n\n- \`src/domain/b.mjs\`\n`,
      `### Mutation \`${CONFIG}\`: skipped\n\nno source file of this scope changed.\n\n`,
      `### Mutation \`${CONFIG}\`: whole scope\n\nno base to compare with.\n\n`,
    ].join(''))
    assert.throws(() => execFileSync(process.execPath, [SCRIPT], { stdio: 'pipe' }), (error) => error.status === 2 && /Usage/.test(error.stderr))
  })
})
