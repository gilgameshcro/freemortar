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
            this.peer = new Peer(`freemortar-${this.roomCode}`);
            this.peer.on('open', () => {
                this.emitLobbyState();
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
            this.peer = new Peer();
            this.peer.on('open', (id) => {
                this.myId = id;
                const connection = this.peer?.connect(`freemortar-${this.roomCode}`);
                if (!connection) {
                    reject(new Error('Unable to create connection'));
                    return;
                }

                connection.on('open', () => {
                    this.connections.set(connection.peer, connection);
                    const joinEnvelope: ClientEnvelope = { kind: 'JOIN', player };
                    connection.send(joinEnvelope);
                    resolve();
                });

                connection.on('data', (payload) => {
                    this.handleClientEnvelope(payload as HostEnvelope);
                });

                connection.on('close', () => {
                    this.emitStatus('Disconnected from host.');
                });

                connection.on('error', (error) => {
                    reject(error);
                });
            });

            this.peer.on('error', (error) => {
                reject(error);
            });
        });
    }

    public updateLocalPlayer(patch: EditableLobbyFields) {
        if (this.role === 'host') {
            const local = this.hostPlayers.find((player) => player.id === this.myId);
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
            const local = this.hostPlayers.find((player) => player.id === this.myId);
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
                const existing = this.hostPlayers.find((player) => player.id === senderId);
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
                const player = this.hostPlayers.find((entry) => entry.id === senderId);
                if (!player) return;
                player.name = envelope.patch.name;
                player.color = envelope.patch.color;
                player.loadout = envelope.patch.loadout;
                player.ready = false;
                this.emitLobbyState();
                break;
            }
            case 'READY_STATE': {
                const player = this.hostPlayers.find((entry) => entry.id === senderId);
                if (!player) return;
                player.ready = envelope.ready;
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
        const players = this.hostPlayers.map((player) => ({ ...player }));
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
