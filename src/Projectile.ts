import { WEAPON_DEFINITIONS, clamp } from './config';
import { Tank } from './Tank';
import { Terrain } from './Terrain';
import type { WeaponType } from './types';

export interface ProjectileImpact {
    x: number;
    y: number;
}

const BASE_SPEED = 0.35;
const POWER_SPEED_FACTOR = 6.9;

export class Projectile {
    public x: number;
    public y: number;
    public vx: number;
    public vy: number;
    public bounceCount = 0;
    public readonly trail: Array<{ x: number; y: number }> = [];
    public readonly history: Array<{ x: number; y: number }> = [];
    public readonly color: string;
    public readonly trailColor: string;
    public readonly radius: number;
    public readonly splitArmed: boolean;
    public readonly launchPower: number;
    public readonly chaosDepth: number;
    private readonly maxBounces = 7;

    constructor(
        x: number,
        y: number,
        angle: number,
        power: number,
        public readonly ownerId: string,
        public readonly weaponType: WeaponType,
        initialVelocity?: { vx: number; vy: number },
        splitArmed = weaponType === 'merv',
        launchPower = power,
        chaosDepth = 0
    ) {
        const definition = WEAPON_DEFINITIONS[weaponType];
        const speed = (BASE_SPEED + (power / 160) * POWER_SPEED_FACTOR) * definition.speedMultiplier;

        this.x = x;
        this.y = y;
        this.vx = initialVelocity?.vx ?? Math.cos(angle) * speed;
        this.vy = initialVelocity?.vy ?? Math.sin(angle) * speed;
        this.color = definition.projectileColor;
        this.trailColor = definition.trailColor;
        this.radius = weaponType === 'nova' || weaponType === 'merv' || weaponType === 'chaos' ? 2 : 1;
        this.splitArmed = splitArmed;
        this.launchPower = launchPower;
        this.chaosDepth = chaosDepth;
        this.history.push({ x, y });
    }

    public step(terrain: Terrain, players: Tank[], gravity: number, wind: number): ProjectileImpact | null {
        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > 18) {
            this.trail.shift();
        }

        this.vx += wind * 0.0022;
        this.vy += gravity;
        this.x += this.vx;
        this.y += this.vy;
        this.history.push({ x: this.x, y: this.y });

        if (this.handleWallBounce(terrain)) {
            const speed = Math.abs(this.vx) + Math.abs(this.vy);
            if (this.bounceCount > this.maxBounces || speed < 0.8) {
                return {
                    x: clamp(Math.round(this.x), 0, terrain.width - 1),
                    y: clamp(Math.round(this.y), 0, terrain.height - 1)
                };
            }
            return null;
        }

        if (this.y > terrain.height + 8) {
            return { x: clamp(this.x, 0, terrain.width - 1), y: terrain.height - 1 };
        }

        if (terrain.isSolid(Math.round(this.x), Math.round(this.y))) {
            return { x: Math.round(this.x), y: Math.round(this.y) };
        }

        for (const tank of players) {
            if (!tank.alive) continue;
            if (
                this.x >= tank.x - tank.bodyWidth / 2 &&
                this.x <= tank.x + tank.bodyWidth / 2 &&
                this.y >= tank.y - tank.bodyHeight &&
                this.y <= tank.y
            ) {
                return { x: Math.round(this.x), y: Math.round(this.y) };
            }
        }

        return null;
    }

    public shouldSplit(terrain: Terrain): boolean {
        if (this.weaponType !== 'merv' || !this.splitArmed || this.history.length < 14) {
            return false;
        }

        const descending = this.vy > -0.04;
        const lookAheadX = clamp(Math.round(this.x + this.vx * 4), 0, terrain.width - 1);
        for (let offset = 10; offset <= 38; offset += 2) {
            if (terrain.isSolid(lookAheadX, Math.round(this.y + offset))) {
                return true;
            }
        }

        return descending;
    }

    public split(): Projectile[] {
        if (this.weaponType !== 'merv' || !this.splitArmed) {
            return [];
        }

        const spreadAngles = [-0.26, 0, 0.26];
        return spreadAngles.map((offset, index) => {
            const cos = Math.cos(offset);
            const sin = Math.sin(offset);
            const vx = this.vx * cos - this.vy * sin + (index - 1) * 0.18;
            const vy = this.vx * sin + this.vy * cos - 0.1 - Math.abs(offset) * 0.05;
            return new Projectile(
                this.x,
                this.y,
                0,
                0,
                this.ownerId,
                'merv',
                { vx, vy },
                false,
                this.launchPower,
                this.chaosDepth
            );
        });
    }

    public createChaosFollowup(x: number, y: number, angle: number) {
        return new Projectile(
            x,
            y,
            angle,
            this.launchPower,
            this.ownerId,
            'chaos',
            undefined,
            false,
            this.launchPower,
            this.chaosDepth + 1
        );
    }

    public draw(ctx: CanvasRenderingContext2D) {
        for (let index = 0; index < this.trail.length; index += 1) {
            const point = this.trail[index];
            const alpha = (index + 1) / this.trail.length;
            ctx.save();
            ctx.globalAlpha = alpha * 0.65;
            ctx.fillStyle = this.trailColor;
            ctx.fillRect(Math.round(point.x), Math.round(point.y), 1, 1);
            ctx.restore();
        }

        ctx.fillStyle = this.color;
        ctx.fillRect(Math.round(this.x), Math.round(this.y), this.radius + 1, this.radius + 1);
    }

    private handleWallBounce(terrain: Terrain) {
        let bounced = false;

        if (this.x <= 1) {
            this.x = 1;
            this.vx = Math.abs(this.vx) * 0.84;
            bounced = true;
        } else if (this.x >= terrain.width - 2) {
            this.x = terrain.width - 2;
            this.vx = -Math.abs(this.vx) * 0.84;
            bounced = true;
        }

        if (this.y <= 1) {
            this.y = 1;
            this.vy = Math.abs(this.vy) * 0.84;
            bounced = true;
        }

        if (bounced) {
            this.bounceCount += 1;
            this.history.push({ x: this.x, y: this.y });
        }

        return bounced;
    }
}
