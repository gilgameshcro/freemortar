import type { BotDifficulty, LoadoutId, PowerRule, WeaponState, WeaponType } from './types';
import weaponBalance from './data/weapon-balance.json';

export type WeaponCategory = 'attack' | 'utility' | 'defense' | 'hybrid';
export type WeaponShopCategory = 'basic-attack' | 'anti-shield-attack' | 'control-attack' | 'homing-attack' | 'mass-attack' | 'utility' | 'retired';
export type WeaponExplosionStyle = 'standard' | 'heavy' | 'precision' | 'chaos' | 'drill' | 'ember' | 'terrain' | 'shield' | 'tech' | 'gravity' | 'shrapnel' | 'roller' | 'nuclear' | 'nova_blast' | 'solar' | 'void' | 'prism';
export type WeaponSoundStyle = 'cannon' | 'mortar' | 'needle' | 'heavy' | 'chaos' | 'drill' | 'burst' | 'terrain' | 'shield' | 'tech' | 'gravity' | 'roller' | 'omega';

export const LOGICAL_WIDTH = 400;
export const LOGICAL_HEIGHT = 225;
export const MAX_PLAYERS = 8;
export const MAX_HEALTH = 100;
export const MIN_POWER = 6;
export const STATIC_MAX_POWER = 160;
export const HEALTH_LINKED_POWER_FACTOR = 2;
export const STARTING_POWER = 96;
export const ROUND_SHOP_BASE_CREDITS = 100;
export const WEAPON_SELLBACK_RATIO = 0.6;
export const MAX_SHIELD = 100;

export interface BotDifficultyPreset {
    level: BotDifficulty;
    title: string;
    description: string;
}

export const BOT_DIFFICULTY_PRESETS: Record<BotDifficulty, BotDifficultyPreset> = {
    1: { level: 1, title: 'Pebble Brain', description: 'Barely tracks arcs. Mostly guesses, forgets wind, and lobs panic shots.' },
    2: { level: 2, title: 'Mud Scholar', description: 'Understands that hills exist, but still overreacts and wastes power.' },
    3: { level: 3, title: 'Crater Intern', description: 'Finds rough splash lines and sometimes buys something sensible.' },
    4: { level: 4, title: 'Slope Goblin', description: 'Reads terrain a bit, mixes in safer shots, and avoids total nonsense.' },
    5: { level: 5, title: 'Wind Sniffer', description: 'Starts correcting for wind and looking for practical blast zones.' },
    6: { level: 6, title: 'Ridge Reader', description: 'Builds decent firing solutions, shops with intent, and punishes exposed tanks.' },
    7: { level: 7, title: 'Siege Clerk', description: 'Searches systematically, uses stronger weapons well, and rarely wastes a turn.' },
    8: { level: 8, title: 'Horizon Reaper', description: 'Strong tactical bot that spots kill windows and terrain advantages quickly.' },
    9: { level: 9, title: 'Orbit Butcher', description: 'Very high accuracy. Usually finds the right shell, angle, and power combination.' },
    10: { level: 10, title: 'Cataclysm Auditor', description: 'Nearly optimal. Reads the board deeply and plays close to a 90% perfect game.' }
};

export const COLOR_OPTIONS = [
    '#ff7a59',
    '#3bc9db',
    '#b197fc',
    '#94d82d',
    '#ffd43b',
    '#ff8787',
    '#74c0fc',
    '#f783ac'
] as const;

export interface WeaponDefinition {
    type: WeaponType;
    name: string;
    glyph: string;
    flavor: string;
    ammoLabel: string;
    speedMultiplier: number;
    blastRadius: number;
    damage: number;
    projectileColor: string;
    trailColor: string;
}

interface ActiveWeaponBalanceEntry extends WeaponDefinition {
    category: WeaponCategory;
    shopCategory: WeaponShopCategory;
    shopPrice: number | null;
    bundleCount: number;
    effectCount: number;
    specialEffects: string[];
    soundStyle: WeaponSoundStyle;
    explosionStyle: WeaponExplosionStyle;
    projectileSize: string;
    projectileRadiusPx: number;
    effectFamily: string;
    effectCoreColor: string;
    effectOuterColor: string;
    effectGlowColor: string;
    effectRimColor: string;
    homingFuel: number | null;
    homingLockFrames: number | null;
    homingLockRange: number | null;
    homingTurnRate: number | null;
    homingTriggerRadius: number | null;
    splitCount: number | null;
    splitTrigger: string;
    splitSpreadBase: number | null;
    splitSpreadNarrow: number | null;
    splitSpreadNormal: number | null;
    splitSpreadWide: number | null;
    chaosChainCount: number | null;
    chaosDecayFactor: number | null;
    pushRadius: number | null;
    pushForce: number | null;
    debugBehavior: string;
}

export const SHIELD_VALUES: Record<'shield_small' | 'shield_medium' | 'shield_large', number> = {
    shield_small: 25,
    shield_medium: 50,
    shield_large: 100
};

export const WEAPON_DEFINITIONS: Record<WeaponType, WeaponDefinition> = {
    cannon: { type: 'cannon', name: 'Cannon', glyph: '==>', flavor: 'Baseline iron shell.', ammoLabel: 'INF', speedMultiplier: 1, blastRadius: 10, damage: 28, projectileColor: '#ffe08a', trailColor: '#fff4c2' },
    mortar: { type: 'mortar', name: 'Mortar', glyph: '{*}', flavor: 'Wide crater and good splash.', ammoLabel: '4', speedMultiplier: 1, blastRadius: 17, damage: 42, projectileColor: '#ff9966', trailColor: '#ffd0b0' },
    needle: { type: 'needle', name: 'Needle', glyph: '-->', flavor: 'Sharp direct-hit punisher.', ammoLabel: '4', speedMultiplier: 1, blastRadius: 6, damage: 56, projectileColor: '#8ce99a', trailColor: '#d3f9d8' },
    nova: { type: 'nova', name: 'Nova', glyph: '<*>', flavor: 'Heavy blast finisher with a cold nova bloom.', ammoLabel: '1', speedMultiplier: 1, blastRadius: 28, damage: 76, projectileColor: '#c9f2ff', trailColor: '#e8fbff' },
    omega_blast: { type: 'omega_blast', name: 'Omega Blast', glyph: '<***>', flavor: 'Dreadful atomic fireball with slow expanding shock rings.', ammoLabel: '0', speedMultiplier: 0.98, blastRadius: 68, damage: 132, projectileColor: '#ffb36b', trailColor: '#ffe0c4' },
    merv: { type: 'merv', name: 'MIRV Mk I', glyph: '}|{', flavor: 'Splits into three falling warheads after apex or rebound.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 11, damage: 24, projectileColor: '#74c0fc', trailColor: '#d0ebff' },
    merv_mk2: { type: 'merv_mk2', name: 'MIRV Mk II', glyph: '}|||{', flavor: 'Splits into five falling warheads after apex or rebound.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 9, damage: 20, projectileColor: '#8ccfff', trailColor: '#ddf3ff' },
    chaos: { type: 'chaos', name: 'Chaos', glyph: '?!>', flavor: 'Chains three explosions through the sky.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 13, damage: 30, projectileColor: '#ffd43b', trailColor: '#fff3bf' },
    chaos_mirv: { type: 'chaos_mirv', name: 'Chaos MIRV', glyph: '?!{|}', flavor: 'A MIRV whose bomblets keep chaining chaos blasts.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 10, damage: 22, projectileColor: '#ffb74d', trailColor: '#ffe8a3' },
    driller: { type: 'driller', name: 'Driller', glyph: '>>>', flavor: 'Punches forward with a line of detonations.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 8, damage: 18, projectileColor: '#c0a7ff', trailColor: '#e0d5ff' },
    blast_bomb: { type: 'blast_bomb', name: 'Blast Bomb', glyph: 'OOO', flavor: 'Huge terrain clear, weak direct damage.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 34, damage: 10, projectileColor: '#ffd96a', trailColor: '#fff0a8' },
    autocannon: { type: 'autocannon', name: 'Auto Cannon', glyph: '::::', flavor: 'Bursts five jittered shells downrange.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 6, damage: 10, projectileColor: '#f1f3f5', trailColor: '#ffffff' },
    wall: { type: 'wall', name: 'Wall', glyph: '|||', flavor: 'Raises a dirt wall at the impact point.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 0, damage: 0, projectileColor: '#b08968', trailColor: '#ddc2a1' },
    large_wall: { type: 'large_wall', name: 'Large Wall', glyph: '|||||', flavor: 'Raises a massive dirt barrier that can reshape the ridge.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 0, damage: 0, projectileColor: '#9c7c58', trailColor: '#ecd0b1' },
    bunker_buster: { type: 'bunker_buster', name: 'Bunker Buster', glyph: 'v>>', flavor: 'Burrows through terrain, then punches out with a shaped charge on exit.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 15, damage: 36, projectileColor: '#ffd29d', trailColor: '#fff0d0' },
    homing_missile: { type: 'homing_missile', name: 'Missile Mk I', glyph: '~>>', flavor: 'Entry missile with limited terminal correction.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 12, damage: 32, projectileColor: '#9bf6ff', trailColor: '#dffcff' },
    missile_mk2: { type: 'missile_mk2', name: 'Missile Mk II', glyph: '~=>>', flavor: 'Improved missile with more terminal correction fuel.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 14, damage: 40, projectileColor: '#8ee7ff', trailColor: '#dcfbff' },
    missile_mk3: { type: 'missile_mk3', name: 'Missile Mk III', glyph: '~==>>', flavor: 'Advanced missile with the deepest steering reserve.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 16, damage: 50, projectileColor: '#7fe1ff', trailColor: '#d4f7ff' },
    nuclear_missile_mk1: { type: 'nuclear_missile_mk1', name: 'Nuclear Missile Mk I', glyph: '~N1>', flavor: 'Mk I missile guidance wrapped around a nuclear payload.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 26, damage: 74, projectileColor: '#ffd39c', trailColor: '#fff0d6' },
    nuclear_missile_mk2: { type: 'nuclear_missile_mk2', name: 'Nuclear Missile Mk II', glyph: '~N2>', flavor: 'Mk II missile guidance with a large nuclear detonation.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 30, damage: 88, projectileColor: '#ffca8d', trailColor: '#ffe7c0' },
    nuclear_missile_mk3: { type: 'nuclear_missile_mk3', name: 'Nuclear Missile Mk III', glyph: '~N3>', flavor: 'Top-tier missile guidance paired with a brutal nuclear blast.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 36, damage: 104, projectileColor: '#ffbf7c', trailColor: '#ffe0b3' },
    emp_missile: { type: 'emp_missile', name: 'EMP Missile', glyph: '~EMP>', flavor: 'Mk II homing missile that strips 50 shield before impact damage.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 12, damage: 22, projectileColor: '#8de8ff', trailColor: '#dffbff' },
    bridge: { type: 'bridge', name: 'Bridge Seed', glyph: '===', flavor: 'Projects a dirt bridge across a gap.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 0, damage: 0, projectileColor: '#d4a373', trailColor: '#ecd8c4' },
    relocator: { type: 'relocator', name: 'Relocator', glyph: '<!>', flavor: 'Teleports the firing tank to the impact zone.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 0, damage: 0, projectileColor: '#7dd3fc', trailColor: '#d9f5ff' },
    leech: { type: 'leech', name: 'Leech Shell', glyph: '<~>', flavor: 'Steals an amplified shield charge only from shielded targets.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 12, damage: 26, projectileColor: '#f38ba8', trailColor: '#ffd6df' },
    blossom: { type: 'blossom', name: 'Blossom', glyph: '{o}', flavor: 'Retired bloom shell kept only for backwards compatibility.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 8, damage: 18, projectileColor: '#ff8fab', trailColor: '#ffd6e0' },
    sinker: { type: 'sinker', name: 'Sinker', glyph: 'V|', flavor: 'Bores straight downward into the earth with a wider cutting shaft.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 9, damage: 16, projectileColor: '#b197fc', trailColor: '#e5dbff' },
    crossfire: { type: 'crossfire', name: 'Crossfire', glyph: '+', flavor: 'Unfolds into prism-lit crossing lanes of delayed fire.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 7, damage: 17, projectileColor: '#ffd166', trailColor: '#fff1bf' },
    roller: { type: 'roller', name: 'Roller', glyph: 'o--', flavor: 'Drops to the ground, rolls forward, and detonates on contact or burnout.', ammoLabel: '0', speedMultiplier: 0.9, blastRadius: 14, damage: 30, projectileColor: '#f6c177', trailColor: '#ffe6bf' },
    flux_bomb: { type: 'flux_bomb', name: 'Flux Bomb', glyph: '<~*>', flavor: 'Balanced shell with elastic damage falloff and a tuned payload.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 20, damage: 34, projectileColor: '#a5b4fc', trailColor: '#dbe4ff' },
    emp_bomb: { type: 'emp_bomb', name: 'EMP Bomb', glyph: '[EMP]', flavor: 'Wide disruption blast that strips 50 shield before the payload lands.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 24, damage: 16, projectileColor: '#8cf3ff', trailColor: '#dcfcff' },
    emp_shell: { type: 'emp_shell', name: 'EMP Shell', glyph: '=EMP=', flavor: 'Tight heavy shell that strips 75 shield before the strike lands.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 8, damage: 54, projectileColor: '#8bf7ff', trailColor: '#e1fdff' },
    minigun: { type: 'minigun', name: 'Minigun', glyph: '::::::::', flavor: 'Sprays fifteen light shells in a long suppressive burst.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 5, damage: 7, projectileColor: '#f5f7fa', trailColor: '#ffffff' },
    command_mirv: { type: 'command_mirv', name: 'Command MIRV', glyph: '}^|{', flavor: 'Power-tuned MIRV with tighter or wider split spacing.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 10, damage: 22, projectileColor: '#93c5fd', trailColor: '#e0f2fe' },
    seeder: { type: 'seeder', name: 'Seeder', glyph: '::o', flavor: 'Scatters bomblets along the final section of its flight path.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 7, damage: 15, projectileColor: '#fca5a5', trailColor: '#ffe4e6' },
    nuclear_seeder: { type: 'nuclear_seeder', name: 'Nuclear Seeder', glyph: '::N', flavor: 'Drops delayed nuclear bomblets along its flight path.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 13, damage: 26, projectileColor: '#ffc482', trailColor: '#ffe6c2' },
    echo_shell: { type: 'echo_shell', name: 'Gravity Echo Shell', glyph: '))>', flavor: 'Implodes first, then detonates with a delayed gravity burst.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 11, damage: 22, projectileColor: '#7dd3fc', trailColor: '#d7f5ff' },
    shrapnel_cone: { type: 'shrapnel_cone', name: 'Shrapnel Cone', glyph: '>^>', flavor: 'Drills underground and expands with each successive buried shrapnel burst.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 8, damage: 18, projectileColor: '#fcd34d', trailColor: '#fef3c7' },
    phase_round: { type: 'phase_round', name: 'Phase Round', glyph: '~|>', flavor: 'Ignores the first terrain layer and bursts on the second contact.', ammoLabel: '0', speedMultiplier: 1.04, blastRadius: 13, damage: 28, projectileColor: '#86efac', trailColor: '#dcfce7' },
    gravity_well: { type: 'gravity_well', name: 'Gravity Well', glyph: '@@', flavor: 'Weak blast that drags tanks inward and roughens the ground.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 12, damage: 12, projectileColor: '#93c5fd', trailColor: '#bfdbfe' },
    magnet_shell: { type: 'magnet_shell', name: 'Magnet Shell', glyph: '<+>', flavor: 'Tugs nearby tanks toward the impact point before the dust settles.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 10, damage: 16, projectileColor: '#67e8f9', trailColor: '#cffafe' },
    large_cannon: { type: 'large_cannon', name: 'Large Cannon', glyph: '==>>', flavor: 'Bigger shell with extra punch.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 14, damage: 36, projectileColor: '#ffe7a6', trailColor: '#fff7dc' },
    large_mortar: { type: 'large_mortar', name: 'Large Mortar', glyph: '{**}', flavor: 'Wider blast and deeper crater.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 23, damage: 52, projectileColor: '#ffb27d', trailColor: '#ffe0ca' },
    large_needle: { type: 'large_needle', name: 'EMP Needle', glyph: '--=>', flavor: 'Strips shields on contact, then drives through with needle damage.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 9, damage: 68, projectileColor: '#8ff7ff', trailColor: '#dffcff' },
    large_nova: { type: 'large_nova', name: 'Large Nova', glyph: '<**>', flavor: 'Even heavier endgame detonation.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 34, damage: 92, projectileColor: '#f3a6ff', trailColor: '#fbe0ff' },
    large_merv: { type: 'large_merv', name: 'Large MIRV', glyph: '}||{', flavor: 'Three heavier split warheads.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 15, damage: 30, projectileColor: '#90d5ff', trailColor: '#dff4ff' },
    large_chaos: { type: 'large_chaos', name: 'Large Chaos', glyph: '?!>>', flavor: 'Five chained detonations through the sky.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 18, damage: 38, projectileColor: '#ffe066', trailColor: '#fff8c5' },
    large_chaos_mirv: { type: 'large_chaos_mirv', name: 'Large Chaos MIRV', glyph: '?!{||}', flavor: 'Heavy MIRV bomblets that each spiral into chaos.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 14, damage: 28, projectileColor: '#ffc078', trailColor: '#ffe7c2' },
    large_driller: { type: 'large_driller', name: 'Large Driller', glyph: '>>>>', flavor: 'Longer line-bore demolition strike.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 10, damage: 24, projectileColor: '#d0bfff', trailColor: '#eee5ff' },
    large_blast_bomb: { type: 'large_blast_bomb', name: 'Large Blast Bomb', glyph: 'OOOO', flavor: 'Massive terrain eraser with light damage.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 46, damage: 12, projectileColor: '#ffe387', trailColor: '#fff3c4' },
    large_autocannon: { type: 'large_autocannon', name: 'Large Auto Cannon', glyph: ':::::', flavor: 'Seven heavier jittered shells.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 8, damage: 16, projectileColor: '#ffffff', trailColor: '#f8f9fa' },
    grapeshot: { type: 'grapeshot', name: 'Grapeshot', glyph: ':::>', flavor: 'Launches a seven-pellet spread cone.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 5, damage: 11, projectileColor: '#ffe9a8', trailColor: '#fff5d6' },
    orbital_lance: { type: 'orbital_lance', name: 'Orbital Lance', glyph: '|*|', flavor: 'Marks the ground, then calls down three sky strikes.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 12, damage: 24, projectileColor: '#8fd8ff', trailColor: '#e5fbff' },
    aftershock: { type: 'aftershock', name: 'Aftershock', glyph: '~~>', flavor: 'Impact ripples into ground-hugging tremors on both sides.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 9, damage: 18, projectileColor: '#c7b8ff', trailColor: '#ece6ff' },
    bulwark_shell: { type: 'bulwark_shell', name: 'Bulwark Shell', glyph: '[*>', flavor: 'Blasts a crater and immediately throws up a higher berm.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 12, damage: 22, projectileColor: '#d8b37a', trailColor: '#f1dfc5' },
    deadfall: { type: 'deadfall', name: 'Deadfall', glyph: 'v*v', flavor: 'Tags a zone, then rains delayed strikes from above.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 9, damage: 20, projectileColor: '#ffb4a2', trailColor: '#ffe2db' },
    helix_shell: { type: 'helix_shell', name: 'Helix Shell', glyph: '@>>', flavor: 'Twists into alternating corkscrew bursts beyond the hit point.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 8, damage: 16, projectileColor: '#9bf6ff', trailColor: '#e1fcff' },
    arc_mine: { type: 'arc_mine', name: 'Arc Mine', glyph: '(*)', flavor: 'Plants quietly, then detonates after a short delay.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 15, damage: 38, projectileColor: '#ffd6a5', trailColor: '#fff1da' },
    volt_net: { type: 'volt_net', name: 'Volt Net', glyph: '#+#', flavor: 'Spreads an electric trap grid and tugs targets inward.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 8, damage: 14, projectileColor: '#7dd3fc', trailColor: '#d7f4ff' },
    geyser: { type: 'geyser', name: 'Geyser', glyph: '^|^', flavor: 'Detonates upward in a violent erupting column.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 7, damage: 15, projectileColor: '#ffadad', trailColor: '#ffe1e1' },
    fault_line: { type: 'fault_line', name: 'Fault Line', glyph: '/_/', flavor: 'Crawls forward along the surface, tearing the ridge apart.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 8, damage: 17, projectileColor: '#bdb2ff', trailColor: '#ece8ff' },
    supernova_mirv: { type: 'supernova_mirv', name: 'Supernova MIRV', glyph: '}***{', flavor: 'Three blue-white nova bomblets with tighter but deadlier cores.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 14, damage: 44, projectileColor: '#9ed8ff', trailColor: '#eefaff' },
    apocalypse_mirv: { type: 'apocalypse_mirv', name: 'Apocalypse MIRV', glyph: '}#####{', flavor: 'Five catastrophic nuclear bomblets for full battlefield denial.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 22, damage: 30, projectileColor: '#ffbf7c', trailColor: '#ffe7c9' },
    solar_mirv: { type: 'solar_mirv', name: 'Solar MIRV', glyph: '}ooo{', flavor: 'Three sun-hot bomblets that erase terrain in huge solar blooms.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 28, damage: 22, projectileColor: '#ffe27a', trailColor: '#fff4bf' },
    void_bomb: { type: 'void_bomb', name: 'Void Bomb', glyph: '<0>', flavor: 'Collapses into a dark sphere that drags in half the battlefield before tearing terrain away.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 26, damage: 58, projectileColor: '#b388ff', trailColor: '#eadcff' },
    singularity_echo: { type: 'singularity_echo', name: 'Singularity Echo', glyph: '((@', flavor: 'Implodes hard, pauses, then answers with a dark shock bloom.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 18, damage: 28, projectileColor: '#9f7aea', trailColor: '#e7dbff' },
    prism_lance: { type: 'prism_lance', name: 'Prism Lance', glyph: '<|+|>', flavor: 'Marks the ground and slices it with a five-strike prism grid.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 10, damage: 22, projectileColor: '#7ee7ff', trailColor: '#e4fcff' },
    chaos_crown: { type: 'chaos_crown', name: 'Nova Crown', glyph: '<*o*>', flavor: 'A central nova bloom that crowns the impact with pale blue nova bursts.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 12, damage: 34, projectileColor: '#bdefff', trailColor: '#effbff' },
    eclipse_shell: { type: 'eclipse_shell', name: 'Eclipse Shell', glyph: '<()>', flavor: 'Starts as a dark implosion, then breaks into a surrounding eclipse halo.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 16, damage: 24, projectileColor: '#c4b5fd', trailColor: '#efe8ff' },
    aurora_helix: { type: 'aurora_helix', name: 'Aurora Helix', glyph: '@~>', flavor: 'Threads a blue-white helix of delayed nova blooms through the air.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 10, damage: 18, projectileColor: '#8fd8ff', trailColor: '#ecfbff' },
    storm_net: { type: 'storm_net', name: 'Storm Net', glyph: '#~#', flavor: 'Throws a larger electric snare with repeated net pulses and stronger drag.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 10, damage: 16, projectileColor: '#76e4ff', trailColor: '#dbfbff' },
    shield_small: { type: 'shield_small', name: 'Small Shield', glyph: '[+]', flavor: 'Raises shield up to 25 next round.', ammoLabel: '0', speedMultiplier: 0, blastRadius: 0, damage: 0, projectileColor: '#62e7ff', trailColor: '#b5f6ff' },
    shield_medium: { type: 'shield_medium', name: 'Medium Shield', glyph: '[++]', flavor: 'Raises shield up to 50 next round.', ammoLabel: '0', speedMultiplier: 0, blastRadius: 0, damage: 0, projectileColor: '#51cfde', trailColor: '#c5f6fa' },
    shield_large: { type: 'shield_large', name: 'Large Shield', glyph: '[+++]', flavor: 'Raises shield up to 100 next round.', ammoLabel: '0', speedMultiplier: 0, blastRadius: 0, damage: 0, projectileColor: '#38d9a9', trailColor: '#c3fae8' }
};

export const WEAPON_SHOP_PRICES: Record<WeaponType, number | null> = {
    cannon: null,
    mortar: 85,
    needle: 110,
    nova: 180,
    omega_blast: 460,
    merv: 210,
    merv_mk2: 290,
    chaos: 260,
    chaos_mirv: 320,
    driller: 135,
    blast_bomb: 115,
    autocannon: 145,
    wall: 95,
    large_wall: 185,
    bunker_buster: 95,
    homing_missile: 225,
    missile_mk2: 280,
    missile_mk3: 345,
    nuclear_missile_mk1: 300,
    nuclear_missile_mk2: 380,
    nuclear_missile_mk3: 470,
    bridge: null,
    relocator: 135,
    leech: 145,
    blossom: null,
    sinker: 150,
    crossfire: 170,
    roller: 145,
    flux_bomb: 155,
    command_mirv: 240,
    seeder: 140,
    nuclear_seeder: 280,
    echo_shell: 150,
    shrapnel_cone: null,
    phase_round: 180,
    gravity_well: 200,
    magnet_shell: 170,
    large_cannon: 150,
    large_mortar: 190,
    large_needle: 220,
    large_nova: 320,
    large_merv: 300,
    large_chaos: 380,
    large_chaos_mirv: 540,
    large_driller: 270,
    large_blast_bomb: 210,
    large_autocannon: 240,
    grapeshot: 125,
    orbital_lance: null,
    aftershock: 175,
    bulwark_shell: 165,
    deadfall: null,
    helix_shell: 170,
    arc_mine: null,
    volt_net: null,
    geyser: null,
    fault_line: null,
    supernova_mirv: 360,
    apocalypse_mirv: 510,
    solar_mirv: 360,
    void_bomb: 280,
    singularity_echo: 310,
    prism_lance: null,
    chaos_crown: 315,
    eclipse_shell: 335,
    aurora_helix: 245,
    storm_net: 275,
    shield_small: 95,
    shield_medium: 180,
    emp_bomb: 190,
    emp_missile: 240,
    emp_shell: 170,
    minigun: 195,
    shield_large: 310
};

const ACTIVE_WEAPON_BALANCE = weaponBalance as ActiveWeaponBalanceEntry[];
const ACTIVE_WEAPON_TYPES = ACTIVE_WEAPON_BALANCE.map((entry) => entry.type) as WeaponType[];

export const WEAPON_DISPLAY_ORDER: WeaponType[] = [...ACTIVE_WEAPON_TYPES];

export const WEAPON_SHOP_BUNDLES: Record<WeaponType, number> = {
    cannon: 1,
    mortar: 2,
    needle: 2,
    nova: 1,
    omega_blast: 1,
    merv: 2,
    merv_mk2: 1,
    chaos: 1,
    chaos_mirv: 1,
    driller: 3,
    blast_bomb: 3,
    autocannon: 3,
    wall: 2,
    large_wall: 1,
    bunker_buster: 2,
    homing_missile: 2,
    missile_mk2: 2,
    missile_mk3: 1,
    nuclear_missile_mk1: 1,
    nuclear_missile_mk2: 1,
    nuclear_missile_mk3: 1,
    bridge: 1,
    relocator: 2,
    leech: 2,
    blossom: 2,
    sinker: 2,
    crossfire: 2,
    roller: 2,
    flux_bomb: 2,
    command_mirv: 2,
    seeder: 3,
    nuclear_seeder: 2,
    echo_shell: 2,
    shrapnel_cone: 3,
    phase_round: 2,
    gravity_well: 2,
    magnet_shell: 2,
    large_cannon: 1,
    large_mortar: 1,
    large_needle: 1,
    large_nova: 1,
    large_merv: 1,
    large_chaos: 1,
    large_chaos_mirv: 1,
    large_driller: 1,
    large_blast_bomb: 1,
    large_autocannon: 1,
    emp_bomb: 2,
    emp_missile: 2,
    emp_shell: 2,
    minigun: 2,
    grapeshot: 3,
    orbital_lance: 1,
    aftershock: 2,
    bulwark_shell: 2,
    deadfall: 1,
    helix_shell: 2,
    arc_mine: 2,
    volt_net: 2,
    geyser: 2,
    fault_line: 2,
    supernova_mirv: 1,
    apocalypse_mirv: 1,
    solar_mirv: 1,
    void_bomb: 1,
    singularity_echo: 1,
    prism_lance: 1,
    chaos_crown: 1,
    eclipse_shell: 1,
    aurora_helix: 2,
    storm_net: 1,
    shield_small: 1,
    shield_medium: 1,
    shield_large: 1
};

export const WEAPON_EFFECT_COUNTS: Record<WeaponType, number> = {
    cannon: 1,
    mortar: 1,
    needle: 1,
    nova: 1,
    omega_blast: 1,
    merv: 3,
    merv_mk2: 5,
    chaos: 3,
    chaos_mirv: 9,
    driller: 8,
    blast_bomb: 1,
    autocannon: 5,
    wall: 1,
    large_wall: 1,
    bunker_buster: 1,
    homing_missile: 1,
    missile_mk2: 1,
    missile_mk3: 1,
    nuclear_missile_mk1: 1,
    nuclear_missile_mk2: 1,
    nuclear_missile_mk3: 1,
    bridge: 1,
    relocator: 1,
    leech: 1,
    blossom: 7,
    sinker: 7,
    crossfire: 9,
    roller: 1,
    flux_bomb: 2,
    command_mirv: 3,
    seeder: 6,
    nuclear_seeder: 6,
    echo_shell: 2,
    shrapnel_cone: 6,
    phase_round: 1,
    gravity_well: 1,
    magnet_shell: 1,
    large_cannon: 1,
    large_mortar: 1,
    large_needle: 1,
    large_nova: 1,
    large_merv: 3,
    large_chaos: 5,
    large_chaos_mirv: 15,
    large_driller: 10,
    large_blast_bomb: 1,
    large_autocannon: 7,
    emp_bomb: 1,
    emp_missile: 1,
    emp_shell: 1,
    minigun: 15,
    grapeshot: 7,
    orbital_lance: 3,
    aftershock: 7,
    bulwark_shell: 2,
    deadfall: 6,
    helix_shell: 7,
    arc_mine: 1,
    volt_net: 5,
    geyser: 6,
    fault_line: 6,
    supernova_mirv: 3,
    apocalypse_mirv: 5,
    solar_mirv: 3,
    void_bomb: 1,
    singularity_echo: 2,
    prism_lance: 5,
    chaos_crown: 7,
    eclipse_shell: 7,
    aurora_helix: 7,
    storm_net: 9,
    shield_small: 1,
    shield_medium: 1,
    shield_large: 1
};

export const WEAPON_CATEGORIES: Record<WeaponType, WeaponCategory> = {
    cannon: 'attack',
    mortar: 'attack',
    needle: 'attack',
    nova: 'attack',
    omega_blast: 'attack',
    merv: 'attack',
    merv_mk2: 'attack',
    chaos: 'attack',
    chaos_mirv: 'attack',
    driller: 'utility',
    blast_bomb: 'utility',
    autocannon: 'attack',
    wall: 'utility',
    large_wall: 'utility',
    bunker_buster: 'attack',
    homing_missile: 'attack',
    missile_mk2: 'attack',
    missile_mk3: 'attack',
    nuclear_missile_mk1: 'attack',
    nuclear_missile_mk2: 'attack',
    nuclear_missile_mk3: 'attack',
    bridge: 'utility',
    relocator: 'utility',
    leech: 'hybrid',
    blossom: 'attack',
    sinker: 'utility',
    crossfire: 'attack',
    roller: 'hybrid',
    flux_bomb: 'attack',
    command_mirv: 'attack',
    seeder: 'attack',
    nuclear_seeder: 'attack',
    echo_shell: 'attack',
    shrapnel_cone: 'attack',
    phase_round: 'hybrid',
    gravity_well: 'utility',
    magnet_shell: 'hybrid',
    large_cannon: 'attack',
    large_mortar: 'attack',
    large_needle: 'attack',
    large_nova: 'attack',
    large_merv: 'attack',
    large_chaos: 'attack',
    large_chaos_mirv: 'attack',
    large_driller: 'utility',
    large_blast_bomb: 'utility',
    large_autocannon: 'attack',
    grapeshot: 'attack',
    orbital_lance: 'attack',
    aftershock: 'hybrid',
    bulwark_shell: 'hybrid',
    deadfall: 'attack',
    helix_shell: 'attack',
    arc_mine: 'attack',
    volt_net: 'hybrid',
    geyser: 'utility',
    fault_line: 'utility',
    supernova_mirv: 'attack',
    apocalypse_mirv: 'attack',
    solar_mirv: 'hybrid',
    void_bomb: 'attack',
    singularity_echo: 'attack',
    prism_lance: 'attack',
    chaos_crown: 'attack',
    eclipse_shell: 'attack',
    aurora_helix: 'attack',
    storm_net: 'hybrid',
    shield_small: 'defense',
    shield_medium: 'defense',
    emp_bomb: 'hybrid',
    emp_missile: 'hybrid',
    emp_shell: 'hybrid',
    minigun: 'attack',
    shield_large: 'defense'
};

export const WEAPON_SPECIAL_EFFECTS: Record<WeaponType, string[]> = {
    cannon: ['Reliable'],
    mortar: ['Arc shot', 'Splash'],
    needle: ['Direct hit', 'Low blast'],
    nova: ['Nova bloom', 'Heavy finisher'],
    omega_blast: ['Omega fireball', 'Expanding rings', 'Lingering blast'],
    merv: ['Apex split x3'],
    merv_mk2: ['Apex split x5'],
    chaos: ['Chain x3'],
    chaos_mirv: ['Split x3', 'Chaos chain'],
    driller: ['Line bore', 'Terrain cut'],
    blast_bomb: ['Huge crater', 'Shock push'],
    autocannon: ['Burst x5', 'Scatter'],
    wall: ['Build cover'],
    large_wall: ['Build massive cover'],
    bunker_buster: ['Burrow', 'Shaped charge'],
    homing_missile: ['Late lock'],
    missile_mk2: ['Improved lock'],
    missile_mk3: ['Strong lock'],
    nuclear_missile_mk1: ['Late lock', 'Nuclear'],
    nuclear_missile_mk2: ['Improved lock', 'Nuclear'],
    nuclear_missile_mk3: ['Strong lock', 'Nuclear'],
    bridge: ['Gap filler'],
    relocator: ['Teleport'],
    leech: ['Shield siphon'],
    blossom: ['Bloom wave', 'Petal strikes'],
    sinker: ['Vertical bore'],
    crossfire: ['Prism cross', 'Staggered fire'],
    roller: ['Ground roll'],
    flux_bomb: ['Elastic payload', 'Dual pressure'],
    command_mirv: ['Power tunes spread'],
    seeder: ['Flight bomblets'],
    nuclear_seeder: ['Flight bomblets', 'Nuclear drops'],
    echo_shell: ['Implosion', 'Delayed blast'],
    shrapnel_cone: ['Underground cone', 'Buried bursts'],
    phase_round: ['Phase first layer'],
    gravity_well: ['Pull inward'],
    magnet_shell: ['Short drag'],
    large_cannon: ['Heavy direct'],
    large_mortar: ['Deep crater'],
    large_needle: ['EMP drain', 'Heavy direct'],
    large_nova: ['Massive finisher'],
    large_merv: ['Split x3'],
    large_chaos: ['Chain x5'],
    large_chaos_mirv: ['Split x3', 'Chaos x5'],
    large_driller: ['Long line bore'],
    large_blast_bomb: ['Massive clear'],
    large_autocannon: ['Burst x5'],
    grapeshot: ['Spread x7'],
    orbital_lance: ['Sky strike x3'],
    aftershock: ['Ground ripple'],
    bulwark_shell: ['Blast + cover'],
    deadfall: ['Rain x5'],
    helix_shell: ['Corkscrew bursts'],
    arc_mine: ['Delayed detonation'],
    volt_net: ['Prism grid', 'Pull'],
    geyser: ['Upward eruption'],
    fault_line: ['Surface crawl'],
    supernova_mirv: ['Split x3', 'Nova bloom'],
    apocalypse_mirv: ['Split x5', 'Nuclear bloom'],
    solar_mirv: ['Split x3', 'Solar bloom'],
    void_bomb: ['Void bloom', 'Dark core'],
    singularity_echo: ['Implosion', 'Void echo'],
    prism_lance: ['Prism strike x5'],
    chaos_crown: ['Nova ring', 'Crown bursts'],
    eclipse_shell: ['Implode', 'Halo bloom'],
    aurora_helix: ['Helix nova'],
    storm_net: ['Storm grid', 'Heavy drag'],
    shield_small: ['Shield top-up'],
    shield_medium: ['Shield top-up'],
    emp_bomb: ['EMP 50', 'Wide disruption'],
    emp_missile: ['EMP 50', 'Mk II homing'],
    emp_shell: ['EMP 75', 'Tight finisher'],
    minigun: ['Burst x15', 'Suppressive fire'],
    shield_large: ['Shield top-up']
};

export const WEAPON_SOUND_STYLES: Record<WeaponType, WeaponSoundStyle> = {
    cannon: 'cannon', mortar: 'mortar', needle: 'needle', nova: 'heavy', omega_blast: 'omega', merv: 'mortar', merv_mk2: 'mortar', chaos: 'chaos', chaos_mirv: 'chaos', driller: 'drill', blast_bomb: 'heavy', autocannon: 'burst', wall: 'terrain', large_wall: 'terrain', bunker_buster: 'drill', homing_missile: 'tech', missile_mk2: 'tech', missile_mk3: 'tech', nuclear_missile_mk1: 'omega', nuclear_missile_mk2: 'omega', nuclear_missile_mk3: 'omega', emp_missile: 'shield', bridge: 'terrain', relocator: 'tech', leech: 'tech', blossom: 'mortar', sinker: 'drill', crossfire: 'tech', roller: 'roller', flux_bomb: 'tech', emp_bomb: 'shield', emp_shell: 'shield', minigun: 'burst', command_mirv: 'mortar', seeder: 'burst', nuclear_seeder: 'omega', echo_shell: 'gravity', shrapnel_cone: 'burst', phase_round: 'tech', gravity_well: 'gravity', magnet_shell: 'gravity', large_cannon: 'cannon', large_mortar: 'heavy', large_needle: 'shield', large_nova: 'heavy', large_merv: 'heavy', large_chaos: 'chaos', large_chaos_mirv: 'chaos', large_driller: 'drill', large_blast_bomb: 'heavy', large_autocannon: 'burst', grapeshot: 'burst', orbital_lance: 'tech', aftershock: 'gravity', bulwark_shell: 'terrain', deadfall: 'heavy', helix_shell: 'tech', arc_mine: 'tech', volt_net: 'tech', geyser: 'drill', fault_line: 'drill', supernova_mirv: 'heavy', apocalypse_mirv: 'omega', solar_mirv: 'heavy', void_bomb: 'gravity', singularity_echo: 'gravity', prism_lance: 'tech', chaos_crown: 'heavy', eclipse_shell: 'gravity', aurora_helix: 'tech', storm_net: 'tech', shield_small: 'shield', shield_medium: 'shield', shield_large: 'shield'
};

export const WEAPON_EXPLOSION_STYLES: Record<WeaponType, WeaponExplosionStyle> = {
    cannon: 'standard', mortar: 'standard', needle: 'precision', nova: 'nova_blast', omega_blast: 'nuclear', merv: 'nuclear', merv_mk2: 'nuclear', chaos: 'chaos', chaos_mirv: 'chaos', driller: 'drill', blast_bomb: 'solar', autocannon: 'shrapnel', wall: 'terrain', large_wall: 'terrain', bunker_buster: 'drill', homing_missile: 'tech', missile_mk2: 'tech', missile_mk3: 'tech', nuclear_missile_mk1: 'nuclear', nuclear_missile_mk2: 'nuclear', nuclear_missile_mk3: 'nuclear', emp_missile: 'shield', bridge: 'terrain', relocator: 'tech', leech: 'tech', blossom: 'ember', sinker: 'drill', crossfire: 'prism', roller: 'roller', flux_bomb: 'tech', emp_bomb: 'shield', emp_shell: 'shield', minigun: 'shrapnel', command_mirv: 'nuclear', seeder: 'ember', nuclear_seeder: 'nuclear', echo_shell: 'gravity', shrapnel_cone: 'shrapnel', phase_round: 'tech', gravity_well: 'gravity', magnet_shell: 'gravity', large_cannon: 'heavy', large_mortar: 'heavy', large_needle: 'shield', large_nova: 'nova_blast', large_merv: 'nuclear', large_chaos: 'chaos', large_chaos_mirv: 'chaos', large_driller: 'drill', large_blast_bomb: 'solar', large_autocannon: 'shrapnel', grapeshot: 'shrapnel', orbital_lance: 'tech', aftershock: 'gravity', bulwark_shell: 'terrain', deadfall: 'heavy', helix_shell: 'ember', arc_mine: 'tech', volt_net: 'prism', geyser: 'drill', fault_line: 'drill', supernova_mirv: 'nova_blast', apocalypse_mirv: 'nuclear', solar_mirv: 'solar', void_bomb: 'void', singularity_echo: 'void', prism_lance: 'prism', chaos_crown: 'nova_blast', eclipse_shell: 'void', aurora_helix: 'nova_blast', storm_net: 'prism', shield_small: 'shield', shield_medium: 'shield', shield_large: 'shield'
};

export const WEAPON_SHOP_CATEGORIES = Object.fromEntries(
    Object.entries(WEAPON_CATEGORIES).map(([type, category]) => [type, category === 'utility' ? 'utility' : 'basic-attack'])
) as Record<WeaponType, WeaponShopCategory>;

for (const entry of ACTIVE_WEAPON_BALANCE) {
    WEAPON_DEFINITIONS[entry.type] = {
        type: entry.type,
        name: entry.name,
        glyph: entry.glyph,
        flavor: entry.flavor,
        ammoLabel: entry.ammoLabel,
        speedMultiplier: entry.speedMultiplier,
        blastRadius: entry.blastRadius,
        damage: entry.damage,
        projectileColor: entry.projectileColor,
        trailColor: entry.trailColor
    };
    WEAPON_SHOP_PRICES[entry.type] = entry.shopPrice;
    WEAPON_SHOP_BUNDLES[entry.type] = entry.bundleCount;
    WEAPON_EFFECT_COUNTS[entry.type] = entry.effectCount;
    WEAPON_CATEGORIES[entry.type] = entry.category;
    WEAPON_SHOP_CATEGORIES[entry.type] = entry.shopCategory;
    WEAPON_SPECIAL_EFFECTS[entry.type] = [...entry.specialEffects];
    WEAPON_SOUND_STYLES[entry.type] = entry.soundStyle;
    WEAPON_EXPLOSION_STYLES[entry.type] = entry.explosionStyle;
}

export const LOADOUTS: Record<LoadoutId, { name: string; description: string; weapons: WeaponState[] }> = {
    balanced: {
        name: 'Balanced',
        description: 'Stable mix of splash, precision, and one heavy finisher.',
        weapons: [
            { type: 'cannon', ammo: -1 },
            { type: 'mortar', ammo: 4 },
            { type: 'needle', ammo: 4 },
            { type: 'nova', ammo: 1 }
        ]
    },
    siege: {
        name: 'Siege',
        description: 'Leans into terrain carving and area denial.',
        weapons: [
            { type: 'cannon', ammo: -1 },
            { type: 'mortar', ammo: 6 },
            { type: 'needle', ammo: 2 },
            { type: 'nova', ammo: 1 }
        ]
    },
    duelist: {
        name: 'Duelist',
        description: 'More precision shots for direct hits and clean finishes.',
        weapons: [
            { type: 'cannon', ammo: -1 },
            { type: 'mortar', ammo: 2 },
            { type: 'needle', ammo: 6 },
            { type: 'nova', ammo: 1 }
        ]
    }
};

export function isShieldType(type: WeaponType): type is 'shield_small' | 'shield_medium' | 'shield_large' {
    return type === 'shield_small' || type === 'shield_medium' || type === 'shield_large';
}

export function isCombatWeapon(type: WeaponType) {
    return !isShieldType(type);
}

export function getShieldValue(type: WeaponType) {
    if (type === 'shield_small') return SHIELD_VALUES.shield_small;
    if (type === 'shield_medium') return SHIELD_VALUES.shield_medium;
    if (type === 'shield_large') return SHIELD_VALUES.shield_large;
    return 0;
}

export function getWeaponCategory(type: WeaponType) {
    return WEAPON_CATEGORIES[type];
}

export function getWeaponShopCategory(type: WeaponType) {
    return WEAPON_SHOP_CATEGORIES[type];
}

export function getWeaponBundleCount(type: WeaponType) {
    return WEAPON_SHOP_BUNDLES[type] ?? 1;
}

export function getWeaponEffectCount(type: WeaponType) {
    return WEAPON_EFFECT_COUNTS[type] ?? 1;
}

export function getWeaponSpecialEffects(type: WeaponType) {
    return WEAPON_SPECIAL_EFFECTS[type] ?? ['Standard'];
}

export function getWeaponSoundStyle(type: WeaponType) {
    return WEAPON_SOUND_STYLES[type] ?? 'cannon';
}

export function getWeaponExplosionStyle(type: WeaponType) {
    return WEAPON_EXPLOSION_STYLES[type] ?? 'standard';
}

export function createWeaponsForLoadout(loadoutId: LoadoutId): WeaponState[] {
    return LOADOUTS[loadoutId].weapons.map((weapon) => ({ ...weapon }));
}

export function createDebugWeapons(): WeaponState[] {
    const hiddenWeapons = new Set<WeaponType>(['bridge', 'blossom', 'orbital_lance', 'deadfall', 'arc_mine', 'geyser', 'fault_line', 'prism_lance', 'volt_net', 'shrapnel_cone']);
    return ACTIVE_WEAPON_TYPES
        .filter((type) => isCombatWeapon(type) && !hiddenWeapons.has(type) && getWeaponShopCategory(type) !== 'retired')
        .map((type) => ({ type, ammo: -1 }));
}

export function cloneWeapons(weapons: WeaponState[]): WeaponState[] {
    return weapons.map((weapon) => ({ ...weapon }));
}

export function addWeaponAmmo(weapons: WeaponState[], type: WeaponType, amount = 1): WeaponState[] {
    const next = cloneWeapons(weapons);
    const target = next.find((weapon) => weapon.type === type);
    if (target) {
        if (target.ammo >= 0) {
            target.ammo += amount;
        }
        return next;
    }
    next.push({ type, ammo: amount });
    return next;
}

export function removeWeaponAmmo(weapons: WeaponState[], type: WeaponType, amount = 1): WeaponState[] {
    return cloneWeapons(weapons)
        .map((weapon) => {
            if (weapon.type !== type || weapon.ammo < 0) return weapon;
            return { ...weapon, ammo: Math.max(0, weapon.ammo - amount) };
        })
        .filter((weapon) => weapon.ammo !== 0 || weapon.type === 'cannon');
}

export function getWeaponShopPrice(type: WeaponType, multiplier = 1): number | null {
    const basePrice = WEAPON_SHOP_PRICES[type];
    if (basePrice === null) return null;
    return Math.max(1, Math.round(basePrice * multiplier));
}

export function getWeaponAmmoUnitPrice(type: WeaponType, multiplier = 1) {
    const buyPrice = getWeaponShopPrice(type, multiplier);
    if (buyPrice === null) return null;
    return Math.max(1, Math.round(buyPrice / Math.max(1, getWeaponBundleCount(type))));
}

export function getWeaponSellPrice(type: WeaponType, multiplier = 1): number | null {
    const unitPrice = getWeaponAmmoUnitPrice(type, multiplier);
    if (unitPrice === null) return null;
    return Math.max(1, Math.round(unitPrice * WEAPON_SELLBACK_RATIO));
}

export function getMaxPowerForHealth(health: number, powerRule: PowerRule): number {
    if (powerRule === 'health_linked') {
        return Math.max(MIN_POWER, Math.round(clamp(health, 0, MAX_HEALTH) * HEALTH_LINKED_POWER_FACTOR));
    }
    return STATIC_MAX_POWER;
}

export function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
}

export function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

export function normalizeAngle(angle: number): number {
    return clamp(angle, -Math.PI - 1.18, 1.18);
}





