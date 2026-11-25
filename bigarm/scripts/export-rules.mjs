// Explicit documentation export only. Starting/testing the game never overwrites the review YAML.
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { MOVES, EQUIPMENT, BASE_RESOURCE_NAMES, RESOURCE_NAMES, WEIGHTS, RULE_VERSION } from '../rules/catalog.js';

function spellComponents(m) {
  const common = { stage: 'R2', cancelled_by_hammer: true };
  if (m.spell === 'silence') return [{ kind: 'cancel_new_spell_components', stage: 'R1c', level: 2, target: 'selected_opponent', cancelled_by_hammer: false, preserves: ['intrinsic_effects', 'old_statuses', 'attack_damage', 'on_hit_callbacks'], removes_move_stock_gain: true }];
  if (m.spell === 'shock') return [{ ...common, kind: 'remove_equipment', level: 1, target: 'selected_opponent', choose: 'recipient_selects_one_electric_removable_instance', immediate: true }];
  if (m.spell === 'blessing') return [{ ...common, kind: 'gain_resource', target: 'self', resource: 'Q', amount: 3, requires_hit: false }];
  if (m.spell === 'heal') return [{ ...common, kind: 'heal', target: 'self', amount: 1, cap_before_attacks: true }];
  if (m.spell === 'guardSix') return [{ ...common, kind: 'guard_move', target: 'self', move: 'sixFists', duration_rounds: 1, start_offset: 0 }];
  if (m.spell === 'defense') return [{ ...common, kind: 'named_status', target: 'self', status: m.id, positive: true, defense: m.defense, start_offset: m.statusStartOffset ?? 1, duration_rounds: m.duration, refresh: 'same_move_and_component_keep_earliest_start_and_latest_end' }];
  if (m.spell === 'void') return [
    { ...common, kind: 'named_status', target: 'self', status: m.id, positive: true, defense: 'C', start_offset: m.statusStartOffset ?? 1, duration_rounds: 1, refresh: 'max_remaining_duration' },
    { ...common, kind: 'named_status', target: 'self', status: m.id, positive: true, immune_scopes: ['single', 'dual', 'splash'], start_offset: m.statusStartOffset ?? 1, duration_rounds: 3, refresh: 'max_remaining_duration' },
  ];
  if (m.spell === 'curse') return [{ ...common, kind: 'named_status', target: 'selected_opponent', level: 1, status: m.id, positive: false, start_offset: 1, duration_rounds: 15, refresh: 'max_remaining_duration_not_multiple_stacks', on_action: { actual_basic_resources: ['S', 'C'], stage: 'R1a', life_loss: 2, damage: false, preventable: false } }];
  return [];
}

export function catalogDocument() {
  const entries = {};
  for (const m of Object.values(MOVES)) {
    const materialCost = m.materials || {};
    const classification = m.type === 'spell' ? '纯法术/辅助行动，算法术' : '非纯法术/辅助行动，不算法术；仍可含独立法术或命中效果组件';
    entries[m.id] = {
      name: m.name,
      category: m.type,
      is_spell: m.hasSpell,
      spell_classification_note: classification,
      cost: { inventory: m.cost, real_shields: materialCost },
      stock_gain: { resource: m.resource || m.id, amount: 1, producer_total: m.type === 'basic' && 'BZFY'.includes(m.resource) ? 3 : null, stage: m.type === 'basic' ? 'R1b' : 'R1d', cancelled_when_new_spell_component_is_silenced: !!m.spell && m.spell !== 'silence', independent_of_real_shields_and_statuses: true },
      resource_value_points: WEIGHTS[m.resource || m.id] / 10,
      target: m.target || 'self',
      intrinsic: { damage_immunity_level: m.immunity || 0, control_immunity_level: m.controlImmunity || 0, basic_defense: m.resource || null, start_of_round_life_loss: m.lifeCost || 0, life_loss_is_damage: false, intrinsic_cancelled_by_hammer: false },
      attack: m.type !== 'attack' ? null : {
        attribute: m.attribute,
        damage_level: 1,
        power_points: m.power / 10,
        power_rule: m.id === 'quake' ? 'one_target_15_else_7.5' : m.target === 'path' ? '3_plus_zero_based_path_index' : 'fixed',
        damage_segments: m.damage,
        damage_rule: m.damageRule || 'fixed',
        conditional_damage: m.damageRule === 'balance' ? { B: 1, Z: 0.5, F: 1.5, Y: 2, S: 2.5, C: 3.5 } : m.damageRule === 'torch' ? { target_actual_basic_F: 2 } : m.target === 'splash' ? { primary: 2, neighbors: 1 } : null,
        anti_air: m.air,
        guard: { basic_defenses: [...m.guard], action_rule: m.guardRule || (m.damageRule === 'balance' ? 'nonBasicAction' : null), action_rule_reads_original_identity_even_if_spell_cancelled: !!m.guardRule || m.damageRule === 'balance', first_segment_only_defense: m.firstOnly || null, dedicated_guard: m.id === 'sixFists' ? 'guardSix' : null },
        shield_interaction: { true_damage: !!m.trueDamage, ignore: m.ignore || [], pierce: m.pierce || [], ghost_pierce: m.ghostPierce === 'whole' ? 'consume_whole_full_ghost_and_stop_partial_ghost_and_continue' : 'normal_one_layer_or_foam_pierce_two_layers', splash_neighbors_inherit_pierce: false },
        clash: { special_rule: m.clash || (m.id === 'ber' ? 'beats_knife' : null), numeric_fallback: !!m.fallback, reverse_numeric_comparison_if_either_side_has_flag: !!m.reverseClash, reversal_changes_attack_order: false },
        schedule: { start_offset: m.delay || 0, rounds: m.duration || 1, original_target_locked: true, survives_source_death: true, removed_when_target_dies: true },
      },
      independent_spell_components: spellComponents(m),
      on_hit: m.onHit === 'gainY' ? { effect: 'gain_resource', resource: 'Y', amount: 1, once_per_segment: true, shield_hit_counts: true, amplified_by_producer: false, cancelled_by_hammer: false }
        : m.onHit === 'ground' ? { effect: 'ground_airborne_target', control_level: 1, immediate: true, shield_hit_counts: true, cancelled_by_hammer: false } : null,
      on_block: m.onBlock === 'recoil' ? { target: 'self', per_target_damage: 0.5, true_damage: true, skip_if_intrinsic_damage_immunity_level_at_least: 1, merge_events: false } : null,
      equipment: m.equipment ? EQUIPMENT[m.equipment] : null,
      description: m.description,
    };
  }
  return {
    schema_version: 2,
    rule_version: RULE_VERSION,
    scope: '当前全部启用招式，新增或修改招式时一并维护；原始 v2-招式.md 保留供以后补充',
    editing: '可直接修改、批注本表供后续调整。游戏当前读取 rules/catalog.js；修改本表后须同步代码。启动和测试不会自动覆盖本文件。',
    classification: { is_spell: '仅 category=spell 的纯法术/辅助行动为真；攻击即使含独立法术或命中效果组件也为假，此分类不删除其法术组件。', spell_cancellation: '锤锤锤只取消本回合新施放的普通独立法术及其招式库存收益；固有防护、旧状态、攻击伤害和命中回调保留。', actual_cost_membership: '元素盾和刀点刀检查实际库存成本键，不把计算资源价值时的递归展开另算作实际 B/Z/F/Y/S/C 成本。', basic_resource_aliases: BASE_RESOURCE_NAMES, recurring_status_start_offset: { default: 1, ghostDodge: 0, chainDodge: 0, voidDodge: 0 } },
    resources: Object.fromEntries(Object.entries(RESOURCE_NAMES).map(([id, name]) => [id, { name, value_points: WEIGHTS[id] / 10, storage: Object.hasOwn(BASE_RESOURCE_NAMES, id) ? 'base_inventory' : 'move_inventory', real_shield: false }])),
    moves: entries,
  };
}

const scalar = value => typeof value === 'string' ? JSON.stringify(value) : String(value);
const keyText = key => /^[A-Za-z_][A-Za-z_0-9]*$/.test(key) ? key : JSON.stringify(key);
export function toYaml(value, depth = 0) {
  const pad = ' '.repeat(depth);
  if (Array.isArray(value)) {
    if (!value.length) return `${pad}[]`;
    return value.map(item => item !== null && typeof item === 'object' ? `${pad}-\n${toYaml(item, depth + 2)}` : `${pad}- ${scalar(item)}`).join('\n');
  }
  if (value !== null && typeof value === 'object') {
    if (!Object.keys(value).length) return `${pad}{}`;
    return Object.entries(value).map(([key, item]) => {
      const prefix = `${pad}${keyText(key)}:`;
      if (item === null || typeof item !== 'object') return `${prefix} ${scalar(item)}`;
      if (!Object.keys(item).length) return `${prefix} ${Array.isArray(item) ? '[]' : '{}'}`;
      return `${prefix}\n${toYaml(item, depth + 2)}`;
    }).join('\n');
  }
  return pad + scalar(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.argv.includes('--write')) throw new Error('仅显式 --write 才导出；请先合并 YAML 中的人工修改，避免覆盖。');
  await writeFile(new URL('../doc/招式清单.yaml', import.meta.url), '# 大臂招式清单：is_spell 是供人工审阅的法术分类。\n# 本表不随启动/测试自动覆盖；新增机制和招式须同步维护。\n' + toYaml(catalogDocument()) + '\n');
  console.log(`已导出 ${Object.keys(MOVES).length} 个招式。`);
}
