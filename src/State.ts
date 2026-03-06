export type MatchPhase = 'aiming' | 'projectile' | 'settling' | 'game_over';

export class MatchState {
    public phase: MatchPhase = 'aiming';
    public currentPlayerIndex = 0;
    public gravity = 0.045;
    public wind = 0;
    public turnNumber = 1;
    public winnerId: string | null = null;
}
