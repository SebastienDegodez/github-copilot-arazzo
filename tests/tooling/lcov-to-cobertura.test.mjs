// The coverage report GitHub Code Quality reads: LCOV of node --test turned into Cobertura XML.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseLcov, toCobertura } from '../../scripts/lcov-to-cobertura.mjs'

const LCOV = `TN:
SF:src/a/one.mjs
FN:1,f
DA:1,3
DA:2,0
BRDA:2,0,0,1
BRDA:2,0,1,0
BRDA:3,0,0,-
end_of_record
SF:src/b/two&<three>.mjs
DA:5,1
DA:5,1
end_of_record
`

test('turns the lines and branches of an LCOV report into Cobertura, one package per folder', () => {
  assert.equal(toCobertura(parseLcov(LCOV), 42), `<?xml version="1.0" ?>
<!DOCTYPE coverage SYSTEM "http://cobertura.sourceforge.net/xml/coverage-04.dtd">
<coverage line-rate="0.6667" branch-rate="0.3333" lines-covered="2" lines-valid="3" branches-covered="1" branches-valid="3" complexity="0" version="1" timestamp="42">
  <sources><source>.</source></sources>
  <packages>
    <package name="src/a" line-rate="0.5000" branch-rate="0.3333" complexity="0">
      <classes>
        <class name="src/a/one.mjs" filename="src/a/one.mjs" line-rate="0.5000" branch-rate="0.3333" complexity="0">
          <methods/>
          <lines>
            <line number="1" hits="3" branch="false"/>
            <line number="2" hits="0" branch="false"/>
          </lines>
        </class>
      </classes>
    </package>
    <package name="src/b" line-rate="1.0000" branch-rate="1.0000" complexity="0">
      <classes>
        <class name="src/b/two&amp;&lt;three&gt;.mjs" filename="src/b/two&amp;&lt;three&gt;.mjs" line-rate="1.0000" branch-rate="1.0000" complexity="0">
          <methods/>
          <lines>
            <line number="5" hits="2" branch="false"/>
          </lines>
        </class>
      </classes>
    </package>
  </packages>
</coverage>
`)
})

test('writes the report from the command line, and says how to call it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cobertura-'))
  await writeFile(join(dir, 'lcov.info'), LCOV.replaceAll('\n', '\r\n'))
  const script = fileURLToPath(new URL('../../scripts/lcov-to-cobertura.mjs', import.meta.url))
  const out = execFileSync(process.execPath, [script, join(dir, 'lcov.info'), join(dir, 'cobertura.xml')], { encoding: 'utf8' })
  assert.equal(out, 'cobertura: 2 files, 2/3 lines\n')
  assert.match(await readFile(join(dir, 'cobertura.xml'), 'utf8'), /lines-covered="2" lines-valid="3"/)
  assert.throws(() => execFileSync(process.execPath, [script], { stdio: 'pipe' }), (error) => error.status === 2 && /Usage/.test(error.stderr))
})
