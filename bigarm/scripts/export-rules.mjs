// Explicit documentation export only. Starting/testing the game never overwrites the review YAML.
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { MOVES, EQUIPMENT, BASE_RESOURCE_NAMES, RESOURCE_NAMES, WEIGHTS, RULE_VERSION } from '../rules/catalog.js';

function spellComponents(m) {
  const common = { stage: 'R2', cancelled_by_hammer: true };
  if (m.spell === 'reflectDamage' || m.spell === 'reflectControl') return [{ kind: m.spell, stage: m.spell === 'reflectDamage' ? 'R3' : 'R2', cancelled_by_hammer: true, target_rule: 'if_source_is_not_selected_opponent_redirect_target_to_original_source', preserve_source_and_properties: true, preserve_duplicate_targets: true, recursive_reflection: false, clash_after_retarget: m.spell === 'reflectDamage' }];
  if (m.spell === 'silence') return [{ kind: 'cancel_new_spell_components', stage: 'R1c', level: 2, target: 'selected_opponent', cancelled_by_hammer: false, preserves: ['intrinsic_effects', 'old_statuses', 'attack_damage', 'on_hit_callbacks'], removes_move_stock_gain: true }];
  if (m.spell === 'shock') return [{ ...common, kind: 'remove_equipment', level: 1, target: 'selected_opponent', choose: 'recipient_selects_one_electric_removable_instance', immediate: true }];
  if (m.spell === 'blessing') return [{ ...common, kind: 'gain_resource', target: 'self', resource: 'Q', amount: 3, requires_hit: false }];
  if (m.spell === 'heal') return [{ ...common, kind: 'heal', target: 'self', amount: 1, cap_before_attacks: true }];
  if (m.spell === 'guardSix') return [{ ...common, kind: 'guard_move', target: 'self', move: 'sixFists', duration_rounds: 1, start_offset: 0 }];
  if (m.spell === 'frogWard') return [{ ...common, stage: 'R1c_after_silence_before_stock', kind: 'force_frog_explosion', activation_timing: 'after_all_new_shields_and_silence_before_shock', requires_hit: false }];
  if (m.spell === 'firstAttack') return [{ ...common, kind: 'immune_first_attack_segment', counting_boundary: 'R4_after_clash_air_other_immunity_and_guard_before_shield_or_hp_resolution', duration_rounds: 1, miss_or_block_consumes: false }];
  if (m.spell === 'digitWard') return [{ ...common, kind: 'named_status', target: 'self', status: m.id, start_offset: 0, duration_rounds: 15, immune_attack_name_contains_any: '零一二三四五六七八九十百千万', refresh: 'max_remaining_duration' }];
  if (m.spell === 'damageCurse') return [{ ...common, kind: 'named_status', target: 'selected_opponent', level: 1, status: m.id, positive: false, start_offset: 1, duration_rounds: 3, damage_multiplier: 2, multiplier_after: ['sky_heal_transfer', 'per_event_blessing'], applies_to_life_loss: false, refresh: 'max_remaining_duration_not_multiple_stacks' }];
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
      implementation_status: m.implementationStatus,
      is_spell: m.hasSpell,
      spell_classification_note: classification,
      cost: { inventory: m.cost, real_shields: materialCost },
      stock_gain: { resource: m.resource || m.id, amount: 1, producer_total: m.type === 'basic' && 'BZFY'.includes(m.resource) ? 3 : null, stage: m.type === 'basic' ? 'R1b' : 'R1d', cancelled_when_new_spell_component_is_silenced: !!m.spell && m.spell !== 'silence', independent_of_real_shields_and_statuses: true },
      resource_value_points: WEIGHTS[m.resource || m.id] / 10,
      target: m.target || 'self',
      intrinsic: { damage_immunity_level: m.immunity || 0, conditional_damage_immunity: m.externalImmunity ? { level: m.externalImmunity, stage: 'R4', source_not_equal_selected_opponent: true, cancelled_by_hammer: false } : null, control_immunity_level: m.controlImmunity || 0, basic_defense: m.resource || null, start_of_round_life_loss: m.lifeCost || 0, life_loss_is_damage: false, intrinsic_cancelled_by_hammer: false },
      attack: m.type !== 'attack' ? null : {
        attribute: m.attribute,
        damage_level: 1,
        power_points: m.power / 10,
        power_rule: m.id === 'quake' ? 'one_target_15_else_7.5' : m.target === 'path' ? '3_plus_zero_based_path_index' : 'fixed',
        damage_segments: m.damage,
        damage_rule: m.damageRule || 'fixed',
        damage_calculation: m.damageRule === 'fiveDarts' ? { actual_S: 1, actual_F_or_Y: 3, other: 5, segments: 1 }
          : m.damageRule === 'targetAttackFour' ? { target_selected_attack_action: 4, otherwise: 2, requires_reverse_targeting: false }
          : m.damageRule === 'roundY' ? 'count_of_round_participants_whose_actual_action_is_basicY; zero_is_still_a_hit'
          : m.damageRule === 'freeSlots' ? 'max(0, 5 - source_occupied_shield_slots_at_R3)'
          : null,
        guard_by_elapsed_round: m.guardByRound || null,
        segments_rule: m.segmentsRule || 'damage_segments',
        zero_segment_attacks: 'retain_target_and_power_for_clash_but_do_not_deliver_damage_or_consume_shields',
        segment_calculation: m.segmentsRule === 'remainingS' ? { count: 'source_S_inventory_after_costs_and_gains_at_R3', damage_each: 0.5, zero_inventory_zero_segments: true } : null,
        power_bonus_from_held_equipment: 'sum_of_fixed_bonus_and_per_remaining_layer_bonus_at_R3',
        strictly_presses: 'has_reverse_attack_targeting_source_with_strictly_lower_power_after_retarget',
        true_damage_if_strictly_presses: !!m.trueWhenPressing,
        transfer_damage_to_source_healing: m.transferHeal ? { integer: true, min: 0, max: m.transferHealLimit, damage_after_choice: 'base_damage_minus_x_times_damage_reduction_per_unit', damage_reduction_per_unit: m.transferDamagePerUnit, recipient_life_loss_per_unit: m.transferLifeLossPerUnit, source_healing_per_unit: 1, life_loss_is_damage: false, choice_effect_order: ['recipient_life_loss', 'source_healing'], raises_max_hp: true, timing: 'R4_after_shields_before_blessing_and_curse', choice_effects_exactly_once_across_continuations: true } : null,
        drain: m.drain ? { heal_equal_actual_damage: true, timing: 'R4_immediately_after_curse_multiplied_actual_damage', capped_at_max_hp: true, revives_previous_round_dead_source: false } : null,
        self_explosion: m.frogExplosion ? { life_loss: 2, no_cost: true, requires_R0_affordability: true, cancels_attack_and_stock_gain: true, preserves_intrinsic_protection_and_old_effects: true, timing: 'R1c_after_silence_before_stock' } : null,
        conditional_damage: m.damageRule === 'balance' ? { B: 1, Z: 0.5, F: 1.5, Y: 2, S: 2.5, C: 3.5 } : m.damageRule === 'torch' ? { target_actual_basic_F: 2 } : m.target === 'splash' ? { primary: 2, neighbors: 1 } : null,
        anti_air: m.air,
        guard: { basic_defenses: [...m.guard], action_rule: m.guardRule || (m.damageRule === 'balance' ? 'nonBasicAction' : null), action_rule_reads_original_identity_even_if_spell_cancelled: !!m.guardRule || m.damageRule === 'balance', first_segment_only_defense: m.firstOnly || null, dedicated_guard: m.id === 'sixFists' ? 'guardSix' : null },
        shield_interaction: { true_damage: !!m.trueDamage, ignore: m.ignore || [], pierce: m.pierce || [], pierce_exceptions: m.pierceExceptions || [], ghost_pierce: m.ghostPierce === 'whole' ? 'consume_whole_full_ghost_and_stop_partial_ghost_and_continue' : 'normal_one_layer_or_foam_pierce_two_layers', splash_neighbors_inherit_pierce: false },
        clash: { special_rule: m.clash || (m.id === 'ber' ? 'beats_knife' : null), numeric_fallback: !!m.fallback, reverse_numeric_comparison_if_either_side_has_flag: !!m.reverseClash, reversal_changes_attack_order: false },
        schedule: { start_offset: m.delay || 0, rounds: m.duration || 1, original_target_locked: true, survives_source_death: true, removed_when_target_dies: true },
      },
      independent_spell_components: spellComponents(m),
      on_hit: m.onHit === 'gainY' ? { effect: 'gain_resource', resource: 'Y', amount: 1, once_per_segment: true, shield_hit_counts: true, amplified_by_producer: false, cancelled_by_hammer: false }
        : m.onHit === 'ground' ? { effect: 'ground_airborne_target', control_level: 1, immediate: true, shield_hit_counts: true, cancelled_by_hammer: false } : null,
      on_block: m.onBlock === 'recoil' ? { target: 'self', per_target_damage: 0.5, true_damage: true, skip_if_intrinsic_damage_immunity_level_at_least: 1, merge_events: false } : null,
      equipment: m.equipment ? EQUIPMENT[m.equipment] : null,
      equipment_resolution: m.equipment && EQUIPMENT[m.equipment].budget !== undefined ? { stage: 'R4_after_guard_and_himalaya', initial_budget_points: 8, comparison: 'hit_power_at_most_remaining_budget', budget_cost_per_segment: 'hit_power', over_budget_ordinary_hit: 'blocks_once_then_destroyed', broken_by_name_containing_any: ['剑', '刀'], breaking_named_hit_continues: true, true_damage: 'budget_immunity_applies_but_over_budget_normal_block_is_skipped', max_simultaneously_held: 1, can_create_while_already_held: false } : null,
      description: m.description,
    };
  }
  return {
    schema_version: 3,
    rule_version: RULE_VERSION,
    scope: '全部已登记招式；implementation_status=ready 才能选用，pending_confirmation 表示等待规则确认。新增或修改招式时一并维护；原始 V2/V3 文件保留供以后补充。',
    editing: '可直接修改、批注本表供后续调整。游戏当前读取 rules/catalog.js；修改本表后须同步代码。启动和测试不会自动覆盖本文件。',
    classification: { is_spell: '仅 category=spell 的纯法术/辅助行动为真；攻击即使含独立法术或命中效果组件也为假，此分类不删除其法术组件。', spell_cancellation: '锤锤锤只取消本回合新施放的普通独立法术及其招式库存收益；固有防护、旧状态、攻击伤害和命中回调保留。', actual_cost_membership: '元素盾和刀点刀检查实际库存成本键，不把计算资源价值时的递归展开另算作实际 B/Z/F/Y/S/C 成本。', basic_resource_aliases: BASE_RESOURCE_NAMES, recurring_status_start_offset: { default: 1, ghostDodge: 0, chainDodge: 0, voidDodge: 0 } },
    damage_pipeline: ['clash', 'air', 'ordinary_immunity', 'guard', 'himalaya_first_hit_segment', 'held_shields_including_plastic', 'sky_heal_transfer', 'per_event_integer_blessing', 'curse_multiplier', 'immediate_hp_loss', 'immediate_capped_drain', 'on_hit_callback'],
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
