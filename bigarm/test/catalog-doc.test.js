import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MOVES } from '../rules/catalog.js';
import { catalogDocument, toYaml } from '../scripts/export-rules.mjs';

test('formal YAML review list covers every move with the same names and spell classification', async () => {
  const yaml = await readFile(new URL('../doc/招式清单.yaml', import.meta.url), 'utf8');
  const moves = yaml.split(/\r?\nmoves:\r?\n/)[1]; assert.ok(moves);
  const entries = [...moves.matchAll(/^  (\w+):\r?\n([\s\S]*?)(?=^  \w+:\r?\n|(?![\s\S]))/gm)];
  assert.deepEqual(entries.map(e => e[1]).sort(), Object.keys(MOVES).sort());
  for (const [, id, body] of entries) {
    assert.equal(JSON.parse(body.match(/^    name: (.+)$/m)[1]), MOVES[id].name, id);
    assert.equal(body.match(/^    is_spell: (true|false)$/m)[1], String(MOVES[id].hasSpell), `${id}: synchronize review decisions with engine classification`);
    assert.equal(JSON.parse(body.match(/^    implementation_status: (.+)$/m)[1]), MOVES[id].implementationStatus, `${id}: synchronize implementation status`);
  }
});

test('YAML export records independent components instead of equating magic damage with spells', () => {
  const doc = catalogDocument();
  assert.equal(doc.moves.phoenix.is_spell, false); assert.equal(doc.moves.sunPunch.is_spell, false);
  assert.equal(doc.moves.fireWheel.is_spell, false); assert.equal(doc.moves.upheaval.is_spell, false);
  assert.equal(doc.moves.hammer3.independent_spell_components[0].cancelled_by_hammer, false);
  assert.equal(doc.moves.ghostDodge.independent_spell_components[0].start_offset, 0);
  assert.equal(doc.moves.crucio.independent_spell_components[0].duration_rounds, 15);
  assert.deepEqual(doc.moves.ghostArrows.cost.inventory, { ghostDodge: 2 });
  assert.deepEqual(doc.moves.ghost.cost.real_shields, { foam: 2 });
  assert.equal(toYaml({ sample: [true, '中文', null], empty: {} }), 'sample:\n  - true\n  - "中文"\n  - null\nempty: {}');
});
