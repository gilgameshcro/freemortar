import { getWeaponExplosionStyle, getWeaponSoundStyle, WEAPON_DEFINITIONS } from './config';
import type { WeaponType } from './types';

type AudioChannel = 'music' | 'sfx';

export class AudioManager {
    private context: AudioContext | null = null;
    private masterGain: GainNode | null = null;
    private musicGain: GainNode | null = null;
    private sfxGain: GainNode | null = null;
    private musicTimer: number | null = null;
    private isMuted = false;
    private musicMuted = false;
    private volume = 0.72;

    public async unlock() {
        if (this.isMuted) return;
        const context = this.getContext();
        if (context.state === 'suspended') {
            await context.resume();
        }
    }

    public setMuted(nextMuted: boolean) {
        this.isMuted = nextMuted;
        this.applyVolumes();
        if (nextMuted) {
            this.stopMusic();
        } else if (!this.musicMuted) {
            this.startMusic();
        }
    }

    public setMusicMuted(nextMuted: boolean) {
        this.musicMuted = nextMuted;
        this.applyVolumes();
        if (this.musicMuted) {
            this.stopMusic();
        } else if (!this.isMuted) {
            this.startMusic();
        }
    }

    public setVolume(nextVolume: number) {
        this.volume = Math.max(0, Math.min(1, nextVolume));
        this.applyVolumes();
    }

    public get muted() {
        return this.isMuted;
    }

    public get musicOnlyMuted() {
        return this.musicMuted;
    }

    public get currentVolume() {
        return this.volume;
    }

    public startMusic() {
        if (this.isMuted || this.musicMuted || this.musicTimer !== null) return;
        const pattern = [82.41, 98, 123.47, 110, 146.83, 123.47, 98, 92.5];
        this.scheduleMusicPattern(pattern);
        this.musicTimer = window.setInterval(() => {
            this.scheduleMusicPattern(pattern);
        }, 3600);
    }

    public stopMusic() {
        if (this.musicTimer !== null) {
            window.clearInterval(this.musicTimer);
            this.musicTimer = null;
        }
    }

    public playReady() {
        this.playTone(523.25, 0.07, 'square', 0.07, 0, 'sfx');
        this.playTone(659.25, 0.09, 'square', 0.055, 0.06, 'sfx');
    }

    public playAimTick() {
        this.playTone(320, 0.03, 'square', 0.026, 0, 'sfx');
    }

    public playRollerTick() {
        this.playTone(112, 0.035, 'square', 0.03, 0, 'sfx');
        this.playNoise(0.02, 0.012, 620);
    }

    public playFire(weaponType: WeaponType) {
        const weapon = WEAPON_DEFINITIONS[weaponType];
        switch (getWeaponSoundStyle(weaponType)) {
            case 'needle':
                this.playTone(176, 0.06, 'square', 0.06, 0, 'sfx');
                this.playTone(244, 0.04, 'triangle', 0.04, 0.02, 'sfx');
                break;
            case 'mortar':
                this.playTone(118, 0.08, 'triangle', 0.07, 0, 'sfx');
                this.playNoise(0.05, 0.025, 1100);
                break;
            case 'heavy':
                this.playTone(72, 0.12, 'sawtooth', 0.08, 0, 'sfx');
                this.playTone(41, 0.16, 'triangle', 0.06, 0.03, 'sfx');
                this.playNoise(0.08, 0.04, 860);
                break;
            case 'chaos':
                this.playTone(148, 0.08, 'sawtooth', 0.06, 0, 'sfx');
                this.playTone(212, 0.05, 'square', 0.04, 0.03, 'sfx');
                this.playNoise(0.05, 0.03, 1500);
                break;
            case 'drill':
                this.playTone(102, 0.1, 'sawtooth', 0.05, 0, 'sfx');
                this.playTone(128, 0.08, 'square', 0.03, 0.02, 'sfx');
                break;
            case 'burst':
                this.playTone(138, 0.05, 'square', 0.05, 0, 'sfx');
                this.playTone(112, 0.05, 'square', 0.04, 0.03, 'sfx');
                break;
            case 'terrain':
                this.playTone(90, 0.05, 'triangle', 0.045, 0, 'sfx');
                break;
            case 'shield':
                this.playTone(420, 0.08, 'triangle', 0.04, 0, 'sfx');
                this.playTone(640, 0.12, 'sine', 0.02, 0.02, 'sfx');
                break;
            case 'tech':
                this.playTone(220, 0.08, 'triangle', 0.045, 0, 'sfx');
                this.playTone(330, 0.1, 'sine', 0.03, 0.01, 'sfx');
                break;
            case 'gravity':
                this.playTone(88, 0.12, 'sine', 0.05, 0, 'sfx');
                this.playTone(132, 0.14, 'triangle', 0.03, 0.02, 'sfx');
                break;
            case 'roller':
                this.playTone(96, 0.06, 'square', 0.05, 0, 'sfx');
                this.playNoise(0.035, 0.02, 700);
                break;
            case 'omega':
                this.playTone(58, 0.18, 'sawtooth', 0.08, 0, 'sfx');
                this.playTone(74, 0.26, 'triangle', 0.06, 0.03, 'sfx');
                this.playTone(112, 0.2, 'sine', 0.035, 0.08, 'sfx');
                this.playNoise(0.12, 0.045, 640);
                break;
            default:
                this.playTone(128, 0.08, 'sawtooth', 0.07, 0, 'sfx');
                this.playTone(64, 0.14, 'square', 0.05, 0.02, 'sfx');
                break;
        }
        if (weapon.blastRadius >= 14) {
            this.playNoise(0.08, 0.03, 900);
        }
    }

    public playExplosion(radius: number, weaponType: WeaponType) {
        const style = getWeaponExplosionStyle(weaponType);
        const noiseVolume = Math.min(0.18, 0.04 + radius * 0.0035);
        switch (style) {
            case 'precision':
                this.playNoise(0.1, noiseVolume * 0.6, 1800);
                this.playTone(180 + radius * 2.2, 0.11, 'triangle', 0.05, 0, 'sfx');
                break;
            case 'chaos':
                this.playNoise(0.18, noiseVolume, 1400);
                this.playTone(92 + radius * 1.8, 0.16, 'square', 0.06, 0, 'sfx');
                this.playTone(132 + radius, 0.12, 'triangle', 0.03, 0.03, 'sfx');
                break;
            case 'drill':
                this.playNoise(0.16, noiseVolume * 0.8, 900);
                this.playTone(66 + radius, 0.18, 'sawtooth', 0.05, 0, 'sfx');
                break;
            case 'terrain':
                this.playNoise(0.22, noiseVolume, 700);
                this.playTone(52 + radius, 0.18, 'triangle', 0.06, 0, 'sfx');
                break;
            case 'shield':
                this.playTone(360, 0.12, 'sine', 0.045, 0, 'sfx');
                this.playTone(540, 0.16, 'triangle', 0.025, 0.03, 'sfx');
                break;
            case 'tech':
                this.playNoise(0.14, noiseVolume * 0.7, 1500);
                this.playTone(180 + radius, 0.15, 'sine', 0.05, 0, 'sfx');
                break;
            case 'gravity':
                this.playNoise(0.16, noiseVolume * 0.8, 500);
                this.playTone(44 + radius, 0.24, 'sine', 0.07, 0, 'sfx');
                break;
            case 'shrapnel':
                this.playNoise(0.12, noiseVolume * 0.75, 1700);
                this.playTone(120 + radius, 0.08, 'square', 0.04, 0, 'sfx');
                break;
            case 'roller':
                this.playNoise(0.18, noiseVolume * 0.85, 820);
                this.playTone(78 + radius, 0.14, 'triangle', 0.055, 0, 'sfx');
                break;
            case 'nuclear':
            case 'nova_blast':
            case 'solar':
                this.playNoise(0.34, Math.min(0.24, noiseVolume * 1.2), 520);
                this.playTone(34 + radius * 0.9, 0.34, 'triangle', 0.1, 0, 'sfx');
                this.playTone(62 + radius * 0.6, 0.42, 'sine', 0.055, 0.06, 'sfx');
                this.playTone(128 + radius * 0.4, 0.3, 'sawtooth', 0.03, 0.12, 'sfx');
                break;
            case 'heavy':
                this.playNoise(0.24, noiseVolume, 1000);
                this.playTone(42 + radius * 1.4, 0.24, 'triangle', 0.09, 0, 'sfx');
                break;
            default:
                this.playNoise(0.22, noiseVolume, 1300 - radius * 20);
                this.playTone(48 + radius * 1.6, 0.2, 'triangle', 0.08, 0, 'sfx');
                break;
        }
    }

    public dispose() {
        this.stopMusic();
        if (this.context) {
            void this.context.close();
            this.context = null;
            this.masterGain = null;
            this.musicGain = null;
            this.sfxGain = null;
        }
    }

    private scheduleMusicPattern(pattern: number[]) {
        if (this.isMuted || this.musicMuted) return;
        pattern.forEach((frequency, index) => {
            this.playTone(frequency, 0.22, 'triangle', 0.028, index * 0.32, 'music');
            this.playTone(frequency * 2, 0.12, 'square', 0.014, index * 0.32 + 0.08, 'music');
            if (index % 2 === 0) {
                this.playTone(frequency * 0.5, 0.18, 'sine', 0.01, index * 0.32, 'music');
            }
        });
    }

    private playTone(
        frequency: number,
        duration: number,
        type: OscillatorType,
        volume: number,
        delay = 0,
        channel: AudioChannel = 'sfx'
    ) {
        if (this.isMuted) return;
        if (channel === 'music' && this.musicMuted) return;
        const context = this.getContext();
        const gain = context.createGain();
        const oscillator = context.createOscillator();
        const startAt = context.currentTime + delay;

        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, startAt);
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

        oscillator.connect(gain);
        gain.connect(channel === 'music' ? this.musicBus() : this.sfxBus());
        oscillator.start(startAt);
        oscillator.stop(startAt + duration + 0.02);
    }

    private playNoise(duration: number, volume: number, filterFrequency: number) {
        if (this.isMuted) return;
        const context = this.getContext();
        const buffer = context.createBuffer(1, context.sampleRate * duration, context.sampleRate);
        const data = buffer.getChannelData(0);

        for (let index = 0; index < data.length; index += 1) {
            data[index] = Math.random() * 2 - 1;
        }

        const source = context.createBufferSource();
        const filter = context.createBiquadFilter();
        const gain = context.createGain();

        source.buffer = buffer;
        filter.type = 'lowpass';
        filter.frequency.value = Math.max(120, filterFrequency);

        gain.gain.setValueAtTime(volume, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);

        source.connect(filter);
        filter.connect(gain);
        gain.connect(this.sfxBus());
        source.start();
        source.stop(context.currentTime + duration);
    }

    private getContext(): AudioContext {
        if (!this.context) {
            this.context = new AudioContext();
        }
        return this.context;
    }

    private master(): GainNode {
        if (!this.masterGain) {
            const context = this.getContext();
            this.masterGain = context.createGain();
            this.masterGain.connect(context.destination);
        }
        return this.masterGain;
    }

    private musicBus(): GainNode {
        if (!this.musicGain) {
            const context = this.getContext();
            this.musicGain = context.createGain();
            this.musicGain.connect(this.master());
            this.applyVolumes();
        }
        return this.musicGain;
    }

    private sfxBus(): GainNode {
        if (!this.sfxGain) {
            const context = this.getContext();
            this.sfxGain = context.createGain();
            this.sfxGain.connect(this.master());
            this.applyVolumes();
        }
        return this.sfxGain;
    }

    private applyVolumes() {
        if (this.masterGain) {
            this.masterGain.gain.value = this.isMuted ? 0 : 0.9 * this.volume;
        }
        if (this.musicGain) {
            this.musicGain.gain.value = this.musicMuted ? 0 : 0.55;
        }
        if (this.sfxGain) {
            this.sfxGain.gain.value = 0.9;
        }
    }
}
