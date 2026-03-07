import {
    cloneWeapons,
    createWeaponsForLoadout,
    getMaxPowerForHealth,
    MAX_HEALTH,
    STARTING_POWER
} from './config';
import type { LoadoutId, PlayerSetup, PlayerSnapshot, PowerRule, WeaponState } from './types';

export class Tank {
    public readonly id: string;
    public readonly name: string;
    public readonly color: string;
    public readonly loadout: LoadoutId;

    public x = 0;
    public y = 0;
    public health = MAX_HEALTH;
    public angle = -Math.PI / 4;
    public power = STARTING_POWER;
    public selectedWeaponIndex = 0;
    public verticalVelocity = 0;
    public weapons: WeaponState[];

    public readonly bodyWidth = 8;
    public readonly bodyHeight = 4;
    public readonly barrelLength = 7;

    constructor(setup: PlayerSetup) {
        this.id = setup.id;
        this.name = setup.name;
        this.color = setup.color;
        this.loadout = setup.loadout;
        this.weapons = setup.weapons ? cloneWeapons(setup.weapons) : createWeaponsForLoadout(setup.loadout);
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
        this.angle = Math.max(-Math.PI + 0.12, Math.min(1.18, angle));
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
        this.ensureWeaponAvailable();
    }

    public cycleWeapon(direction: 1 | -1) {
        let nextIndex = this.selectedWeaponIndex;
        for (let attempts = 0; attempts < this.weapons.length; attempts += 1) {
            nextIndex = (nextIndex + direction + this.weapons.length) % this.weapons.length;
            const weapon = this.weapons[nextIndex];
            if (weapon.ammo !== 0) {
                this.selectedWeaponIndex = nextIndex;
                return;
            }
        }
    }

    public ensureWeaponAvailable() {
        if (this.weapons.length === 0) return;
        if (this.currentWeapon.ammo !== 0) return;
        this.cycleWeapon(1);
    }

    public consumeSelectedWeapon(): WeaponState | null {
        const weapon = this.currentWeapon;
        if (!weapon || weapon.ammo === 0) return null;
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
        this.angle = snapshot.angle;
        this.power = snapshot.power;
        this.selectedWeaponIndex = snapshot.selectedWeaponIndex;
        this.weapons = cloneWeapons(snapshot.weapons);
        this.ensureWeaponAvailable();
    }

    public draw(ctx: CanvasRenderingContext2D, isCurrentTurn: boolean) {
        const pivotY = -this.bodyHeight + 1;
        const tipX = Math.cos(this.angle) * this.barrelLength;
        const tipY = pivotY + Math.sin(this.angle) * this.barrelLength;
        const bodyTop = -this.bodyHeight;
        const treadColor = this.alive ? '#25191f' : '#3b2d34';
        const accent = this.alive ? '#fff5d6' : '#7a6b73';

        ctx.save();
        ctx.translate(Math.round(this.x), Math.round(this.y));

        if (isCurrentTurn && this.alive) {
            ctx.fillStyle = 'rgba(255, 245, 214, 0.16)';
            ctx.fillRect(-6, -1, 12, 2);
        }

        ctx.fillStyle = treadColor;
        ctx.fillRect(-5, -1, 10, 2);

        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.1;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(0, pivotY);
        ctx.lineTo(tipX, tipY);
        ctx.stroke();

        ctx.fillStyle = this.color;
        ctx.fillRect(-4, bodyTop, 8, 4);
        ctx.fillStyle = accent;
        ctx.fillRect(-2, bodyTop + 1, 2, 1);

        const hpBarWidth = 10;
        ctx.fillStyle = '#2f1820';
        ctx.fillRect(-5, bodyTop - 3, hpBarWidth, 1);
        ctx.fillStyle = this.health > 30 ? '#9de64e' : '#ffb000';
        ctx.fillRect(-5, bodyTop - 3, Math.round((Math.max(0, this.health) / MAX_HEALTH) * hpBarWidth), 1);

        ctx.restore();
    }
}


