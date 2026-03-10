import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const jsonPath = path.join(root, 'src', 'data', 'weapon-balance.json');
const outPath = path.join(root, 'weapon_balance_export.csv');
const weaponBalance = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

const columns = [
  'type',
  'name',
  'category',
  'shop_category',
  'shop_price',
  'bundle_count',
  'effect_count',
  'ammo_label',
  'speed_multiplier',
  'blast_radius',
  'damage_per_burst',
  'sound_style',
  'explosion_style',
  'special_effects',
  'projectile_color',
  'trail_color',
  'projectile_size',
  'projectile_radius_px',
  'effect_family',
  'effect_core_color',
  'effect_outer_color',
  'effect_glow_color',
  'effect_rim_color',
  'homing_fuel',
  'homing_lock_frames',
  'homing_lock_range',
  'homing_turn_rate',
  'homing_trigger_radius',
  'split_count',
  'split_trigger',
  'split_spread_base',
  'split_spread_narrow',
  'split_spread_normal',
  'split_spread_wide',
  'chaos_chain_count',
  'chaos_decay_factor',
  'push_radius',
  'push_force',
  'flavor',
  'debug_behavior'
];

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return '"' + text.replaceAll('"', '""') + '"';
}

function valueForColumn(row, column) {
  switch (column) {
    case 'shop_category': return row.shopCategory;
    case 'shop_price': return row.shopPrice;
    case 'bundle_count': return row.bundleCount;
    case 'effect_count': return row.effectCount;
    case 'ammo_label': return row.ammoLabel;
    case 'speed_multiplier': return row.speedMultiplier;
    case 'blast_radius': return row.blastRadius;
    case 'damage_per_burst': return row.damage;
    case 'sound_style': return row.soundStyle;
    case 'explosion_style': return row.explosionStyle;
    case 'special_effects': return row.specialEffects.join(' | ');
    case 'projectile_color': return row.projectileColor;
    case 'trail_color': return row.trailColor;
    case 'projectile_size': return row.projectileSize;
    case 'projectile_radius_px': return row.projectileRadiusPx;
    case 'effect_family': return row.effectFamily;
    case 'effect_core_color': return row.effectCoreColor;
    case 'effect_outer_color': return row.effectOuterColor;
    case 'effect_glow_color': return row.effectGlowColor;
    case 'effect_rim_color': return row.effectRimColor;
    case 'homing_fuel': return row.homingFuel;
    case 'homing_lock_frames': return row.homingLockFrames;
    case 'homing_lock_range': return row.homingLockRange;
    case 'homing_turn_rate': return row.homingTurnRate;
    case 'homing_trigger_radius': return row.homingTriggerRadius;
    case 'split_count': return row.splitCount;
    case 'split_trigger': return row.splitTrigger;
    case 'split_spread_base': return row.splitSpreadBase;
    case 'split_spread_narrow': return row.splitSpreadNarrow;
    case 'split_spread_normal': return row.splitSpreadNormal;
    case 'split_spread_wide': return row.splitSpreadWide;
    case 'chaos_chain_count': return row.chaosChainCount;
    case 'chaos_decay_factor': return row.chaosDecayFactor;
    case 'push_radius': return row.pushRadius;
    case 'push_force': return row.pushForce;
    case 'debug_behavior': return row.debugBehavior;
    default: return row[column];
  }
}

const lines = [columns.map(csvEscape).join(',')];
for (const row of weaponBalance) {
  lines.push(columns.map((column) => csvEscape(valueForColumn(row, column))).join(','));
}

fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
console.log(`Exported ${weaponBalance.length} weapons to ${path.relative(root, outPath)}`);

