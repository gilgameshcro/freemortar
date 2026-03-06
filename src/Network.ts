import Peer, { DataConnection } from 'peerjs';
import type { GameMessage, LobbyPlayer, MatchStartPayload } from './types';

type EditableLobbyFields = Pick<LobbyPlayer, 'name' | 'color' | 'loadout'>;

type ClientEnvelope =
    | { kind: 'JOIN'; player: EditableLobbyFields }
    | { kind: 'PLAYER_UPDATE'; patch: EditableLobbyFields }
    | { kind: 'READY_STATE'; ready: boolean }
    | { kind: 'GAME_MESSAGE'; message: GameMessage };

type HostEnvelope =
    | { kind: 'LOBBY_STATE'; roomCode: string; players: LobbyPlayer[] }
    | { kind: 'START_GAME'; payload: MatchStartPayload }
    | { kind: 'GAME_MESSAGE'; message: GameMessage };

export type NetworkRole = 'host' | 'client' | 'offline';

const JOIN_TIMEOUT_MS = 12000;

export class Network {
    private peer: Peer | null = null;
    private readonly connections = new Map<string, DataConnection>();
    private hostPlayers: LobbyPlayer[] = [];

    public role: NetworkRole = 'offline';
    public myId = '';
    public roomCode = '';

    public onLobbyState: ((players: LobbyPlayer[], roomCode: string) => void) | null = null;
    public onGameStart: ((payload: MatchStartPayload) => void) | null = null;
    public onGameMessage: ((message: GameMessage, senderId: string) => void) | null = null;
    public onStatus: ((message: string) => void) | null = null;

    public async hostGame(player: EditableLobbyFields): Promise<string> {
        this.destroy();
        this.role = 'host';
        this.myId = 'host';
        this.roomCode = this.generateRoomCode();
        this.hostPlayers = [{ id: this.myId, ...player, ready: false, isHost: true }];

        return new Promise((resolve, reject) => {
            this.peer = new Peer(`freemortar-${this.roomCode}`, buildPeerOptions());
            this.peer.on('open', () => {
                this.emitLobbyState();
                this.emitStatus(`Room ${this.roomCode} is online.`);
                resolve(this.roomCode);
            });

            this.peer.on('connection', (connection) => {
                connection.on('open', () => {
                    this.connections.set(connection.peer, connection);
                    this.emitStatus(`Peer connected: ${connection.peer}`);
                });

                connection.on('data', (payload) => {
                    this.handleHostEnvelope(connection.peer, payload as ClientEnvelope);
                });

                connection.on('close', () => {
                    this.connections.delete(connection.peer);
                    this.hostPlayers = this.hostPlayers.filter((playerEntry) => playerEntry.id !== connection.peer);
                    this.emitLobbyState();
                    this.emitStatus('A pilot disconnected from the lobby.');
                });

                connection.on('error', (error) => {
                    this.emitStatus(`Connection error: ${readErrorMessage(error)}`);
                });
            });

            this.peer.on('error', (error) => {
                reject(error);
            });
        });
    }

    public async joinGame(roomCode: string, player: EditableLobbyFields): Promise<void> {
        this.destroy();
        this.role = 'client';
        this.roomCode = roomCode.trim().toUpperCase();

        return new Promise((resolve, reject) => {
            let settled = false;
            let timeoutId: number | null = null;

            const finalize = (callback: () => void) => {
                if (settled) return;
                settled = true;
                if (timeoutId !== null) {
                    window.clearTimeout(timeoutId);
                }
                callback();
            };

            this.peer = new Peer(buildPeerOptions());
            this.peer.on('open', (id) => {
                this.myId = id;
                this.emitStatus(`Connecting to room ${this.roomCode}...`);
                const connection = this.peer?.connect(`freemortar-${this.roomCode}`, { reliable: true });
                if (!connection) {
                    finalize(() => reject(new Error('Unable to create connection.')));
                    return;
                }

                timeoutId = window.setTimeout(() => {
                    connection.close();
                    this.destroy();
                    finalize(() => reject(new Error('Timed out reaching the host. This usually means NAT/firewall traversal failed or the room code is wrong.')));
                }, JOIN_TIMEOUT_MS);

                connection.on('open', () => {
                    this.connections.set(connection.peer, connection);
                    const joinEnvelope: ClientEnvelope = { kind: 'JOIN', player };
                    connection.send(joinEnvelope);
                    this.emitStatus(`Connected to room ${this.roomCode}.`);
                    finalize(() => resolve());
                });

                connection.on('data', (payload) => {
                    this.handleClientEnvelope(payload as HostEnvelope);
                });

                connection.on('close', () => {
                    this.emitStatus('Disconnected from host.');
                    if (!settled) {
                        this.destroy();
                        finalize(() => reject(new Error('The host connection closed before the lobby opened.')));
                    }
                });

                connection.on('error', (error) => {
                    this.destroy();
                    finalize(() => reject(new Error(readErrorMessage(error))));
                });
            });

            this.peer.on('error', (error) => {
                this.destroy();
                finalize(() => reject(new Error(readErrorMessage(error))));
            });
        });
    }

    public updateLocalPlayer(patch: EditableLobbyFields) {
        if (this.role === 'host') {
            const local = this.hostPlayers.find((playerEntry) => playerEntry.id === this.myId);
            if (local) {
                local.name = patch.name;
                local.color = patch.color;
                local.loadout = patch.loadout;
                local.ready = false;
                this.emitLobbyState();
            }
            return;
        }

        this.sendToHost({ kind: 'PLAYER_UPDATE', patch });
    }

    public setReady(ready: boolean) {
        if (this.role === 'host') {
            const local = this.hostPlayers.find((playerEntry) => playerEntry.id === this.myId);
            if (local) {
                local.ready = ready;
                this.emitLobbyState();
            }
            return;
        }

        this.sendToHost({ kind: 'READY_STATE', ready });
    }

    public broadcastStart(payload: MatchStartPayload) {
        if (this.role !== 'host') return;
        const envelope: HostEnvelope = { kind: 'START_GAME', payload };
        this.broadcast(envelope);
    }

    public sendGameMessage(message: GameMessage) {
        if (this.role === 'host') {
            const envelope: HostEnvelope = { kind: 'GAME_MESSAGE', message };
            this.broadcast(envelope);
            return;
        }

        this.sendToHost({ kind: 'GAME_MESSAGE', message });
    }

    public destroy() {
        this.connections.forEach((connection) => connection.close());
        this.connections.clear();
        if (this.peer) {
            this.peer.destroy();
            this.peer = null;
        }
        this.hostPlayers = [];
        this.role = 'offline';
        this.myId = '';
        this.roomCode = '';
    }

    private handleHostEnvelope(senderId: string, envelope: ClientEnvelope) {
        switch (envelope.kind) {
            case 'JOIN': {
                const existing = this.hostPlayers.find((playerEntry) => playerEntry.id === senderId);
                if (existing) {
                    existing.name = envelope.player.name;
                    existing.color = envelope.player.color;
                    existing.loadout = envelope.player.loadout;
                    existing.ready = false;
                } else {
                    this.hostPlayers.push({
                        id: senderId,
                        name: envelope.player.name,
                        color: envelope.player.color,
                        loadout: envelope.player.loadout,
                        ready: false,
                        isHost: false
                    });
                }
                this.emitLobbyState();
                break;
            }
            case 'PLAYER_UPDATE': {
                const playerEntry = this.hostPlayers.find((entry) => entry.id === senderId);
                if (!playerEntry) return;
                playerEntry.name = envelope.patch.name;
                playerEntry.color = envelope.patch.color;
                playerEntry.loadout = envelope.patch.loadout;
                playerEntry.ready = false;
                this.emitLobbyState();
                break;
            }
            case 'READY_STATE': {
                const playerEntry = this.hostPlayers.find((entry) => entry.id === senderId);
                if (!playerEntry) return;
                playerEntry.ready = envelope.ready;
                this.emitLobbyState();
                break;
            }
            case 'GAME_MESSAGE': {
                this.onGameMessage?.(envelope.message, senderId);
                break;
            }
        }
    }

    private handleClientEnvelope(envelope: HostEnvelope) {
        switch (envelope.kind) {
            case 'LOBBY_STATE':
                this.roomCode = envelope.roomCode;
                this.onLobbyState?.(envelope.players, envelope.roomCode);
                break;
            case 'START_GAME':
                this.onGameStart?.(envelope.payload);
                break;
            case 'GAME_MESSAGE':
                this.onGameMessage?.(envelope.message, 'host');
                break;
        }
    }

    private emitLobbyState() {
        if (this.role !== 'host') return;
        const players = this.hostPlayers.map((playerEntry) => ({ ...playerEntry }));
        this.onLobbyState?.(players, this.roomCode);
        const envelope: HostEnvelope = { kind: 'LOBBY_STATE', roomCode: this.roomCode, players };
        this.broadcast(envelope);
    }

    private emitStatus(message: string) {
        this.onStatus?.(message);
    }

    private sendToHost(envelope: ClientEnvelope) {
        const connection = [...this.connections.values()][0];
        if (connection?.open) {
            connection.send(envelope);
        }
    }

    private broadcast(envelope: HostEnvelope) {
        this.connections.forEach((connection) => {
            if (connection.open) {
                connection.send(envelope);
            }
        });
    }

    private generateRoomCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let index = 0; index < 4; index += 1) {
            code += chars[Math.floor(Math.random() * chars.length)];
        }
        return code;
    }
}

type IceServerConfig = {
    urls: string | string[];
    username?: string;
    credential?: string;
};

function buildPeerOptions() {
    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
    const host = env.VITE_PEER_HOST?.trim();
    const port = env.VITE_PEER_PORT ? Number(env.VITE_PEER_PORT) : undefined;
    const path = env.VITE_PEER_PATH?.trim();
    const secure = env.VITE_PEER_SECURE ? env.VITE_PEER_SECURE === 'true' : undefined;
    const key = env.VITE_PEER_KEY?.trim();
    const debug = env.VITE_PEER_DEBUG ? Number(env.VITE_PEER_DEBUG) : 1;

    const options: Record<string, unknown> = {
        debug,
        config: buildRtcConfig(env.VITE_ICE_SERVERS_JSON)
    };

    if (host) options.host = host;
    if (Number.isFinite(port)) options.port = port;
    if (path) options.path = path;
    if (typeof secure === 'boolean') options.secure = secure;
    if (key) options.key = key;

    return options;
}

function buildRtcConfig(rawIceServers?: string) {
    if (rawIceServers) {
        try {
            const parsed = JSON.parse(rawIceServers) as IceServerConfig[];
            if (Array.isArray(parsed) && parsed.length > 0) {
                return { iceServers: parsed, sdpSemantics: 'unified-plan' };
            }
        } catch {
            // Fall back to a simple public STUN config.
        }
    }

    return {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ],
        sdpSemantics: 'unified-plan'
    };
}

function readErrorMessage(error: unknown) {
    if (error instanceof Error) {
        return error.message;
    }
    if (typeof error === 'object' && error && 'type' in error) {
        return String((error as { type: unknown }).type);
    }
    return 'Unknown connection failure.';
}


