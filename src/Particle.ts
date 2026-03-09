export type ParticleKind = 'spark' | 'dust' | 'smoke' | 'ring';

export class Particle {
    public life: number;
    private readonly maxLife: number;

    constructor(
        public x: number,
        public y: number,
        public vx: number,
        public vy: number,
        public size: number,
        public color: string,
        public kind: ParticleKind,
        lifetime: number
    ) {
        this.life = lifetime;
        this.maxLife = lifetime;
    }

    public step(wind: number) {
        this.life -= 1;
        if (this.kind === 'ring') {
            this.vx *= 0.985;
            this.vy *= 0.985;
            this.size += 0.72;
        } else if (this.kind !== 'smoke') {
            this.vy += 0.02;
        } else {
            this.vx += wind * 0.01;
            this.vy -= 0.01;
            this.size += 0.01;
        }

        this.x += this.vx;
        this.y += this.vy;
    }

    public draw(ctx: CanvasRenderingContext2D) {
        if (this.life <= 0) return;
        ctx.save();
        const alpha = Math.max(0, this.life / this.maxLife);
        ctx.globalAlpha = alpha;
        if (this.kind === 'ring') {
            ctx.strokeStyle = this.color;
            ctx.lineWidth = Math.max(1, Math.round(this.size * 0.14));
            ctx.beginPath();
            ctx.arc(this.x, this.y, Math.max(2, this.size), 0, Math.PI * 2);
            ctx.stroke();
        } else {
            ctx.fillStyle = this.color;
            ctx.fillRect(Math.round(this.x), Math.round(this.y), Math.max(1, Math.round(this.size)), Math.max(1, Math.round(this.size)));
        }
        ctx.restore();
    }
}
