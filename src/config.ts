import type { LoadoutId, PowerRule, WeaponState, WeaponType } from './types';

export const LOGICAL_WIDTH = 400;
export const LOGICAL_HEIGHT = 225;
export const MAX_PLAYERS = 4;
export const MAX_HEALTH = 100;
export const MIN_POWER = 6;
export const STATIC_MAX_POWER = 160;
export const HEALTH_LINKED_POWER_FACTOR = 2;
export const STARTING_POWER = 96;
export const ROUND_SHOP_BASE_CREDITS = 100;
export const WEAPON_SELLBACK_RATIO = 0.6;

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

export const WEAPON_DEFINITIONS: Record<WeaponType, WeaponDefinition> = {
    cannon: {
        type: 'cannon',
        name: 'Cannon',
        glyph: '==>',
        flavor: 'Baseline iron shell.',
        ammoLabel: 'INF',
        speedMultiplier: 1,
        blastRadius: 10,
        damage: 28,
        projectileColor: '#ffe08a',
        trailColor: '#fff4c2'
    },
    mortar: {
        type: 'mortar',
        name: 'Mortar',
        glyph: '{*}',
        flavor: 'Wide crater and good splash.',
        ammoLabel: '4',
        speedMultiplier: 1,
        blastRadius: 17,
        damage: 42,
        projectileColor: '#ff9966',
        trailColor: '#ffd0b0'
    },
    needle: {
        type: 'needle',
        name: 'Needle',
        glyph: '-->',
        flavor: 'Sharp direct-hit punisher.',
        ammoLabel: '4',
        speedMultiplier: 1,
        blastRadius: 6,
        damage: 56,
        projectileColor: '#8ce99a',
        trailColor: '#d3f9d8'
    },
    nova: {
        type: 'nova',
        name: 'Nova',
        glyph: '<*>',
        flavor: 'Heavy blast finisher.',
        ammoLabel: '1',
        speedMultiplier: 1,
        blastRadius: 28,
        damage: 76,
        projectileColor: '#f783ff',
        trailColor: '#f8c0ff'
    },
    merv: {
        type: 'merv',
        name: 'Merv',
        glyph: '}|{',
        flavor: 'Splits into three falling warheads.',
        ammoLabel: '0',
        speedMultiplier: 1,
        blastRadius: 11,
        damage: 24,
        projectileColor: '#74c0fc',
        trailColor: '#d0ebff'
    },
    chaos: {
        type: 'chaos',
        name: 'Chaos',
        glyph: '?!>',
        flavor: 'Chains three explosions through the sky.',
        ammoLabel: '0',
        speedMultiplier: 1,
        blastRadius: 13,
        damage: 30,
        projectileColor: '#ffd43b',
        trailColor: '#fff3bf'
    }
};

export const WEAPON_SHOP_PRICES: Record<WeaponType, number | null> = {
    cannon: null,
    mortar: 90,
    needle: 120,
    nova: 260,
    merv: 320,
    chaos: 420
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
    return clamp(angle, -Math.PI + 0.12, -0.12);
}
