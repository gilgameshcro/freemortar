import type { BotDifficulty, LoadoutId, PowerRule, WeaponState, WeaponType } from './types';

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

export const SHIELD_VALUES: Record<'shield_small' | 'shield_medium' | 'shield_large', number> = {
    shield_small: 25,
    shield_medium: 50,
    shield_large: 100
};

export const WEAPON_DEFINITIONS: Record<WeaponType, WeaponDefinition> = {
    cannon: { type: 'cannon', name: 'Cannon', glyph: '==>', flavor: 'Baseline iron shell.', ammoLabel: 'INF', speedMultiplier: 1, blastRadius: 10, damage: 28, projectileColor: '#ffe08a', trailColor: '#fff4c2' },
    mortar: { type: 'mortar', name: 'Mortar', glyph: '{*}', flavor: 'Wide crater and good splash.', ammoLabel: '4', speedMultiplier: 1, blastRadius: 17, damage: 42, projectileColor: '#ff9966', trailColor: '#ffd0b0' },
    needle: { type: 'needle', name: 'Needle', glyph: '-->', flavor: 'Sharp direct-hit punisher.', ammoLabel: '4', speedMultiplier: 1, blastRadius: 6, damage: 56, projectileColor: '#8ce99a', trailColor: '#d3f9d8' },
    nova: { type: 'nova', name: 'Nova', glyph: '<*>', flavor: 'Heavy blast finisher.', ammoLabel: '1', speedMultiplier: 1, blastRadius: 28, damage: 76, projectileColor: '#f783ff', trailColor: '#f8c0ff' },
    merv: { type: 'merv', name: 'MIRV', glyph: '}|{', flavor: 'Splits into three falling warheads.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 11, damage: 24, projectileColor: '#74c0fc', trailColor: '#d0ebff' },
    chaos: { type: 'chaos', name: 'Chaos', glyph: '?!>', flavor: 'Chains three explosions through the sky.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 13, damage: 30, projectileColor: '#ffd43b', trailColor: '#fff3bf' },
    chaos_mirv: { type: 'chaos_mirv', name: 'Chaos MIRV', glyph: '?!{|}', flavor: 'A MIRV whose bomblets keep chaining chaos blasts.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 10, damage: 22, projectileColor: '#ffb74d', trailColor: '#ffe8a3' },
    driller: { type: 'driller', name: 'Driller', glyph: '>>>', flavor: 'Punches forward with a line of detonations.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 8, damage: 18, projectileColor: '#c0a7ff', trailColor: '#e0d5ff' },
    blast_bomb: { type: 'blast_bomb', name: 'Blast Bomb', glyph: 'OOO', flavor: 'Huge terrain clear, weak direct damage.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 34, damage: 10, projectileColor: '#ff9f68', trailColor: '#ffd4b4' },
    autocannon: { type: 'autocannon', name: 'Auto Cannon', glyph: '::::', flavor: 'Bursts five jittered shells downrange.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 5, damage: 10, projectileColor: '#f1f3f5', trailColor: '#ffffff' },
    wall: { type: 'wall', name: 'Wall', glyph: '|||', flavor: 'Raises a dirt wall at the impact point.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 0, damage: 0, projectileColor: '#b08968', trailColor: '#ddc2a1' },
    large_wall: { type: 'large_wall', name: 'Large Wall', glyph: '|||||', flavor: 'Raises a taller, wider dirt barrier.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 0, damage: 0, projectileColor: '#9c7c58', trailColor: '#ecd0b1' },
    bunker_buster: { type: 'bunker_buster', name: 'Bunker Buster', glyph: 'v>>', flavor: 'Burrows through terrain, then detonates on exit or wall contact.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 15, damage: 36, projectileColor: '#ffd29d', trailColor: '#fff0d0' },
    homing_missile: { type: 'homing_missile', name: 'Homing Missile', glyph: '~>>', flavor: 'Locks late and bends gently toward a live target.', ammoLabel: '0', speedMultiplier: 0.96, blastRadius: 12, damage: 32, projectileColor: '#9bf6ff', trailColor: '#dffcff' },
    bridge: { type: 'bridge', name: 'Bridge Seed', glyph: '===', flavor: 'Projects a dirt bridge across a gap.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 0, damage: 0, projectileColor: '#d4a373', trailColor: '#ecd8c4' },
    relocator: { type: 'relocator', name: 'Relocator', glyph: '<!>', flavor: 'Teleports the firing tank to the impact zone.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 0, damage: 0, projectileColor: '#7dd3fc', trailColor: '#d9f5ff' },
    leech: { type: 'leech', name: 'Leech Shell', glyph: '<~>', flavor: 'Steals a shield charge from dealt damage.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 12, damage: 26, projectileColor: '#f38ba8', trailColor: '#ffd6df' },
    blossom: { type: 'blossom', name: 'Blossom', glyph: '{o}', flavor: 'Detonates into a ring of petal blasts.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 8, damage: 18, projectileColor: '#ff8fab', trailColor: '#ffd6e0' },
    sinker: { type: 'sinker', name: 'Sinker', glyph: 'V|', flavor: 'Bores straight downward into the earth.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 7, damage: 16, projectileColor: '#b197fc', trailColor: '#e5dbff' },
    crossfire: { type: 'crossfire', name: 'Crossfire', glyph: '+', flavor: 'Bursts into a plus-shaped blast pattern.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 7, damage: 17, projectileColor: '#ffd166', trailColor: '#fff1bf' },
    large_cannon: { type: 'large_cannon', name: 'Large Cannon', glyph: '==>>', flavor: 'Bigger shell with extra punch.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 14, damage: 36, projectileColor: '#ffe7a6', trailColor: '#fff7dc' },
    large_mortar: { type: 'large_mortar', name: 'Large Mortar', glyph: '{**}', flavor: 'Wider blast and deeper crater.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 23, damage: 52, projectileColor: '#ffb27d', trailColor: '#ffe0ca' },
    large_needle: { type: 'large_needle', name: 'Large Needle', glyph: '--=>', flavor: 'Sharper hit with more punch.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 9, damage: 68, projectileColor: '#b2f2bb', trailColor: '#e6f9e9' },
    large_nova: { type: 'large_nova', name: 'Large Nova', glyph: '<**>', flavor: 'Even heavier endgame detonation.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 34, damage: 92, projectileColor: '#f3a6ff', trailColor: '#fbe0ff' },
    large_merv: { type: 'large_merv', name: 'Large MIRV', glyph: '}||{', flavor: 'Three heavier split warheads.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 15, damage: 30, projectileColor: '#90d5ff', trailColor: '#dff4ff' },
    large_chaos: { type: 'large_chaos', name: 'Large Chaos', glyph: '?!>>', flavor: 'Five chained detonations through the sky.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 18, damage: 38, projectileColor: '#ffe066', trailColor: '#fff8c5' },
    large_chaos_mirv: { type: 'large_chaos_mirv', name: 'Large Chaos MIRV', glyph: '?!{||}', flavor: 'Heavy MIRV bomblets that each spiral into chaos.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 14, damage: 28, projectileColor: '#ffc078', trailColor: '#ffe7c2' },
    large_driller: { type: 'large_driller', name: 'Large Driller', glyph: '>>>>', flavor: 'Longer line-bore demolition strike.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 10, damage: 24, projectileColor: '#d0bfff', trailColor: '#eee5ff' },
    large_blast_bomb: { type: 'large_blast_bomb', name: 'Large Blast Bomb', glyph: 'OOOO', flavor: 'Massive terrain eraser with light damage.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 46, damage: 12, projectileColor: '#ffb385', trailColor: '#ffe3cc' },
    large_autocannon: { type: 'large_autocannon', name: 'Large Auto Cannon', glyph: ':::::', flavor: 'Five heavier jittered shells.', ammoLabel: '0', speedMultiplier: 1, blastRadius: 8, damage: 16, projectileColor: '#ffffff', trailColor: '#f8f9fa' },
    shield_small: { type: 'shield_small', name: 'Small Shield', glyph: '[+]', flavor: 'Raises shield up to 25 next round.', ammoLabel: '0', speedMultiplier: 0, blastRadius: 0, damage: 0, projectileColor: '#62e7ff', trailColor: '#b5f6ff' },
    shield_medium: { type: 'shield_medium', name: 'Medium Shield', glyph: '[++]', flavor: 'Raises shield up to 50 next round.', ammoLabel: '0', speedMultiplier: 0, blastRadius: 0, damage: 0, projectileColor: '#51cfde', trailColor: '#c5f6fa' },
    shield_large: { type: 'shield_large', name: 'Large Shield', glyph: '[+++]', flavor: 'Raises shield up to 100 next round.', ammoLabel: '0', speedMultiplier: 0, blastRadius: 0, damage: 0, projectileColor: '#38d9a9', trailColor: '#c3fae8' }
};

export const WEAPON_SHOP_PRICES: Record<WeaponType, number | null> = {
    cannon: null,
    mortar: 90,
    needle: 120,
    nova: 260,
    merv: 320,
    chaos: 420,
    chaos_mirv: 520,
    driller: 280,
    blast_bomb: 170,
    autocannon: 220,
    wall: 140,
    large_wall: 260,
    bunker_buster: 340,
    homing_missile: 360,
    bridge: null,
    relocator: 210,
    leech: 190,
    blossom: 240,
    sinker: 230,
    crossfire: 250,
    large_cannon: 180,
    large_mortar: 240,
    large_needle: 260,
    large_nova: 420,
    large_merv: 460,
    large_chaos: 620,
    large_chaos_mirv: 760,
    large_driller: 420,
    large_blast_bomb: 300,
    large_autocannon: 360,
    shield_small: 80,
    shield_medium: 140,
    shield_large: 220
};

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

export function createWeaponsForLoadout(loadoutId: LoadoutId): WeaponState[] {
    return LOADOUTS[loadoutId].weapons.map((weapon) => ({ ...weapon }));
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

export function getWeaponSellPrice(type: WeaponType, multiplier = 1): number | null {
    const buyPrice = getWeaponShopPrice(type, multiplier);
    if (buyPrice === null) return null;
    return Math.max(1, Math.round(buyPrice * WEAPON_SELLBACK_RATIO));
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



