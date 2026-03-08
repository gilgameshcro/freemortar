import {
    cloneWeapons,
    createWeaponsForLoadout,
    getMaxPowerForHealth,
    getShieldValue,
    isCombatWeapon,
    MAX_HEALTH,
    MAX_SHIELD,
    normalizeAngle,
    STARTING_POWER
} from './config';
import type { BotDifficulty, LoadoutId, PlayerSetup, PlayerSnapshot, PowerRule, WeaponState } from './types';

interface DrawOptions {
    showTurnPrompt: boolean;
    promptPulse: number;
    showShield: boolean;
}

export class Tank {
    public readonly id: string;
    public readonly name: string;
    public readonly color: string;
    public readonly loadout: LoadoutId;
    public readonly isBot: boolean;
    public readonly botDifficulty: BotDifficulty;

    public x = 0;
    public y = 0;
    public health = MAX_HEALTH;
    public shield = 0;
    public maxShield = 0;
    public angle = -Math.PI / 4;
    public power = STARTING_POWER;
    public selectedWeaponIndex = 0;
    public verticalVelocity = 0;
    public weapons: WeaponState[];

    public readonly bodyWidth = 8;
    public readonly bodyHeight = 4;
    public readonly barrelLength = 6;

    constructor(setup: PlayerSetup) {
        this.id = setup.id;
        this.name = setup.name;
        this.color = setup.color;
        this.loadout = setup.loadout;
        this.isBot = Boolean(setup.isBot);
        this.botDifficulty = setup.botDifficulty ?? 1;
        this.weapons = setup.weapons ? cloneWeapons(setup.weapons) : createWeaponsForLoadout(setup.loadout);
        this.shield = Math.max(0, Math.min(MAX_SHIELD, setup.shield ?? 0));
        this.maxShield = this.shield > 0 ? MAX_SHIELD : 0;
    }

    public get alive() {
        return this.health > 0;
    }

    public get currentWeapon() {
        return this.weapons[this.selectedWeaponIndex];
    }

    public get barrelTip() {
        const pivotY = this.y - this.bodyHeight + 1;
        return {
            x: this.x + Math.cos(this.angle) * this.barrelLength,
            y: pivotY + Math.sin(this.angle) * this.barrelLength
        };
    }

    public getMaxPower(powerRule: PowerRule) {
        return getMaxPowerForHealth(this.health, powerRule);
    }

    public setAim(angle: number, power: number, powerRule: PowerRule) {
        this.angle = normalizeAngle(angle);
        this.power = Math.max(6, Math.min(this.getMaxPower(powerRule), power));
    }

    public syncPowerCap(powerRule: PowerRule) {
        this.power = Math.min(this.power, this.getMaxPower(powerRule));
    }

    public prepareForBattle(powerRule: PowerRule) {
        this.health = MAX_HEALTH;
        this.angle = -Math.PI / 4;
        this.power = Math.min(this.getMaxPower(powerRule), STARTING_POWER);
        this.selectedWeaponIndex = 0;
        this.verticalVelocity = 0;
        this.consumeShieldInventory();
        this.ensureWeaponAvailable();
    }

    public applyShieldDamage(amount: number) {
        const absorbed = Math.min(this.shield, amount);
        this.shield -= absorbed;
        this.maxShield = this.shield > 0 ? MAX_SHIELD : 0;
        return absorbed;
    }

    public restoreShield(amount: number) {
        if (amount <= 0) return 0;
        const previous = this.shield;
        this.shield = Math.min(MAX_SHIELD, this.shield + amount);
        this.maxShield = this.shield > 0 ? MAX_SHIELD : 0;
        return this.shield - previous;
    }

    public cycleWeapon(direction: 1 | -1) {
        let nextIndex = this.selectedWeaponIndex;
        for (let attempts = 0; attempts < this.weapons.length; attempts += 1) {
            nextIndex = (nextIndex + direction + this.weapons.length) % this.weapons.length;
            const weapon = this.weapons[nextIndex];
            if (weapon.ammo !== 0 && isCombatWeapon(weapon.type)) {
                this.selectedWeaponIndex = nextIndex;
                return;
            }
        }
    }

    public ensureWeaponAvailable() {
        if (this.weapons.length === 0) return;
        const current = this.currentWeapon;
        if (current && current.ammo !== 0 && isCombatWeapon(current.type)) return;
        this.cycleWeapon(1);
    }

    public consumeSelectedWeapon(): WeaponState | null {
        const weapon = this.currentWeapon;
        if (!weapon || weapon.ammo === 0 || !isCombatWeapon(weapon.type)) return null;
        const firedWeapon = { ...weapon };
        if (weapon.ammo > 0) {
            weapon.ammo -= 1;
        }
        this.ensureWeaponAvailable();
        return firedWeapon;
    }

    public snapshot(): PlayerSnapshot {
        return {
            id: this.id,
            x: this.x,
            y: this.y,
            health: this.health,
            shield: this.shield,
            maxShield: this.maxShield,
            angle: this.angle,
            power: this.power,
            selectedWeaponIndex: this.selectedWeaponIndex,
            weapons: cloneWeapons(this.weapons)
        };
    }

    public applySnapshot(snapshot: PlayerSnapshot) {
        this.x = snapshot.x;
        this.y = snapshot.y;
        this.health = snapshot.health;
        this.shield = snapshot.shield;
        this.maxShield = snapshot.maxShield;
        this.angle = snapshot.angle;
        this.power = snapshot.power;
        this.selectedWeaponIndex = snapshot.selectedWeaponIndex;
        this.weapons = cloneWeapons(snapshot.weapons);
        this.ensureWeaponAvailable();
    }

    public draw(ctx: CanvasRenderingContext2D, options: DrawOptions) {
        const pivotY = -this.bodyHeight + 1;
        const tipX = Math.cos(this.angle) * this.barrelLength;
        const tipY = pivotY + Math.sin(this.angle) * this.barrelLength;
        const bodyTop = -this.bodyHeight;
        const treadColor = this.alive ? '#25191f' : '#3b2d34';
        const accent = this.alive ? '#fff5d6' : '#7a6b73';

        ctx.save();
        ctx.translate(Math.round(this.x), Math.round(this.y));

        if (options.showShield && this.shield > 0 && this.alive) {
            const shieldStrength = Math.max(0.08, this.shield / Math.max(1, this.maxShield || MAX_SHIELD));
            ctx.fillStyle = `rgba(98, 231, 255, ${0.03 + shieldStrength * 0.08})`;
            ctx.fillRect(-4, -this.bodyHeight, 8, this.bodyHeight + 2);
            ctx.strokeStyle = `rgba(98, 231, 255, ${0.06 + shieldStrength * 0.16})`;
            ctx.lineWidth = 1;
            ctx.strokeRect(-3.5, -this.bodyHeight + 0.5, 7, this.bodyHeight + 1);
        }
        if (options.showTurnPrompt && this.alive) {
            ctx.fillStyle = `rgba(255, 244, 167, ${0.18 + options.promptPulse * 0.42})`;
            ctx.fillRect(-1, -this.bodyHeight - 6, 2, 2);
        }

        ctx.fillStyle = treadColor;
        ctx.fillRect(-this.bodyWidth / 2, -1, this.bodyWidth, 2);

        ctx.fillStyle = this.color;
        ctx.fillRect(-this.bodyWidth / 2 + 1, bodyTop + 1, this.bodyWidth - 2, this.bodyHeight - 1);

        ctx.fillStyle = accent;
        ctx.fillRect(-this.bodyWidth / 2 + 2, bodyTop + 2, this.bodyWidth - 4, 1);
        ctx.fillRect(-1, bodyTop + 2, 2, 1);

        ctx.strokeStyle = this.color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, pivotY);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();

        ctx.fillStyle = accent;
        ctx.fillRect(Math.round(tipX) - 1, Math.round(tipY) - 1, 2, 2);

        ctx.restore();
    }

    private consumeShieldInventory() {
        let currentShield = Math.max(0, Math.min(MAX_SHIELD, this.shield));
        let bestUpgradeIndex = -1;
        let bestUpgradeTarget = currentShield;

        this.weapons.forEach((weapon, index) => {
            if ((weapon.type === 'shield_small' || weapon.type === 'shield_medium' || weapon.type === 'shield_large') && weapon.ammo > 0) {
                const target = getShieldValue(weapon.type);
                if (target > bestUpgradeTarget) {
                    bestUpgradeTarget = target;
                    bestUpgradeIndex = index;
                }
            }
        });

        if (bestUpgradeIndex >= 0) {
            const shieldItem = this.weapons[bestUpgradeIndex];
            currentShield = Math.max(currentShield, getShieldValue(shieldItem.type));
            shieldItem.ammo -= 1;
        }

        this.weapons = this.weapons.filter((weapon) => weapon.ammo !== 0 || weapon.type === 'cannon');
        this.shield = currentShield;
        this.maxShield = this.shield > 0 ? MAX_SHIELD : 0;
    }
}







