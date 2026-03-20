// multiplayer_fixed.js - standalone online multiplayer overlay for Gnome Invasion
// Drop-in replacement for multiplayer.js

(function () {
    'use strict';

    const MP = {
        version: '4.2.0',
        isHost: false,
        isClient: false,
        isOffline: false,
        peer: null,
        conn: null,
        clients: [],
        roomId: null,
        hostPeerId: null,
        myPlayerId: null,
        gnomeOwners: {},
        hooksInstalled: {
            renderAll: false,
            renderAllNoBoard: false,
            toggleSetupGnome: false,
            startButton: false,
            clickCapture: false,
            poller: false
        },
        uiBuilt: false,
        pollerId: null,
        syncIntervalId: null,
        suppressNetwork: false,
        suppressStartClick: false,
        lastDeniedAlertAt: 0,
        maxPlayers: 4,
        oneGnomePerPlayer: true,
        snapshotSeq: 0,
        lastReplaySeq: 0,
        debug: false,
        applyingSetupClaims: false
    };

    window.__gnomeMP = MP;

    function log(...args) {
        if (MP.debug) console.log('[mp]', ...args);
    }

    function whenReady(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn, { once: true });
        } else {
            fn();
        }
    }

    function loadPeerJs() {
        if (window.Peer) {
            whenReady(initMultiplayer);
            return;
        }

        const existing = document.querySelector('script[data-mp-peerjs="1"]');
        if (existing) {
            existing.addEventListener('load', () => whenReady(initMultiplayer), { once: true });
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';
        script.async = true;
        script.dataset.mpPeerjs = '1';
        script.onload = () => whenReady(initMultiplayer);
        script.onerror = () => {
            whenReady(() => {
                buildUi();
                setStatus('Status: Could not load networking library.');
            });
        };
        document.head.appendChild(script);
    }

    function initMultiplayer() {
        buildUi();
        installGlobalHooks();
        startHookPoller();
        startHostSnapshotLoop();
        syncMultiplayerPanelVisibility();
        refreshUi();
    }

    function buildUi() {
        if (MP.uiBuilt || document.getElementById('mp-lobby')) return;

        const wrapper = document.createElement('div');
        wrapper.id = 'mp-lobby';
        wrapper.innerHTML = `
            <div style="position:fixed; top:15px; right:15px; background:rgba(26,18,13,0.96); padding:15px; color:#f4e6c8; z-index:9999; border-radius:10px; border:2px solid #d6a652; font-family:'Nunito', sans-serif; box-shadow:0 4px 15px rgba(0,0,0,0.5); width:240px; line-height:1.35;">
                <h3 style="margin-top:0; margin-bottom:12px; font-family:'Fredoka One', sans-serif; color:#f2c06b; text-align:center;">Gnome Invasion</h3>

                <div id="mp-controls">
                    <button id="mp-local-btn" style="background:#5a3f2b; color:white; border:1px solid #d6a652; padding:8px 12px; border-radius:5px; cursor:pointer; font-weight:bold; margin-bottom:15px; width:100%;">Play Local (Hotseat)</button>

                    <h4 style="margin:0 0 10px 0; color:#e7c17c; border-bottom:1px solid #7a5737; padding-bottom:5px; text-align:center;">Online Multiplayer</h4>

                    <button id="mp-host-btn" style="background:#31734f; color:white; border:none; padding:8px 12px; border-radius:5px; cursor:pointer; font-weight:bold; margin-bottom:10px; width:100%;">Host Game</button>

                    <div id="mp-host-info" style="display:none; margin-bottom:10px; font-weight:bold; color:#e7c17c; text-align:center;">
                        Room PIN:<br>
                        <span id="mp-room-id" style="user-select:all; background:#000; padding:4px 8px; border-radius:5px; font-size:1.5em; letter-spacing:3px; display:inline-block; margin-top:5px;">....</span>
                    </div>

                    <div style="display:flex; gap:5px; margin-bottom:10px;">
                        <input type="text" id="mp-join-id" placeholder="PIN" maxlength="4" inputmode="numeric" style="padding:5px; border-radius:5px; border:1px solid #7a5737; background:#2b1e16; color:white; width:78px; text-align:center; font-size:1.1em; font-weight:bold;">
                        <button id="mp-join-btn" style="background:#6a4a32; color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer; font-weight:bold; flex-grow:1;">Join</button>
                    </div>
                </div>

                <div id="mp-info" style="font-size:0.85rem; color:#cdbb94; border-top:1px solid #7a5737; padding-top:8px;">
                    <div id="mp-role" style="margin-bottom:4px;">Role: Waiting...</div>
                    <div id="mp-turn" style="margin-bottom:4px;">Turn: --</div>
                    <div id="mp-claims" style="margin-bottom:4px;">Claims: none</div>
                    <div id="mp-status">Status: Waiting...</div>
                </div>
            </div>
        `;
        document.body.appendChild(wrapper);

        const localBtn = document.getElementById('mp-local-btn');
        const hostBtn = document.getElementById('mp-host-btn');
        const joinBtn = document.getElementById('mp-join-btn');
        const joinInput = document.getElementById('mp-join-id');

        localBtn.addEventListener('click', () => {
            MP.isOffline = true;
            setStatus('Status: Local hotseat mode.');
            document.getElementById('mp-controls').style.display = 'none';
            refreshUi();
        });

        hostBtn.addEventListener('click', () => {
            buildUi();
            document.getElementById('mp-host-info').style.display = 'block';
            document.getElementById('mp-local-btn').style.display = 'none';
            document.getElementById('mp-host-btn').disabled = true;
            document.getElementById('mp-join-btn').disabled = true;
            document.getElementById('mp-join-id').disabled = true;
            setStatus('Status: Generating PIN...');
            attemptHost(0);
        });

        joinInput.addEventListener('input', () => {
            joinInput.value = joinInput.value.replace(/\D+/g, '').slice(0, 4);
        });

        joinBtn.addEventListener('click', () => {
            const roomId = (joinInput.value || '').trim();
            if (!/^\d{4}$/.test(roomId)) {
                alert('Please enter a 4-digit PIN.');
                return;
            }

            document.getElementById('mp-local-btn').style.display = 'none';
            document.getElementById('mp-host-btn').disabled = true;
            document.getElementById('mp-join-btn').disabled = true;
            document.getElementById('mp-join-id').disabled = true;
            setStatus('Status: Connecting...');
            connectToHost(roomId);
        });

        MP.uiBuilt = true;
    }

    function setStatus(text) {
        const el = document.getElementById('mp-status');
        if (el) el.textContent = text;
    }

    function refreshUi() {
        const roleEl = document.getElementById('mp-role');
        const turnEl = document.getElementById('mp-turn');
        const claimsEl = document.getElementById('mp-claims');

        if (roleEl) {
            if (MP.isOffline) roleEl.textContent = 'Role: Local only';
            else if (MP.isHost) roleEl.textContent = 'Role: Host';
            else if (MP.isClient) roleEl.textContent = 'Role: Client';
            else roleEl.textContent = 'Role: Waiting...';
        }

        if (turnEl) {
            const controller = getCurrentControllerId();
            let label = '--';
            if (controller) {
                if (controller === MP.hostPeerId) label = 'Host';
                else if (controller === MP.myPlayerId) label = 'You';
                else label = 'Another player';
            }
            turnEl.textContent = `Turn: ${label}`;
        }

        if (claimsEl) {
            const claims = Object.keys(MP.gnomeOwners)
                .sort((a, b) => Number(a) - Number(b))
                .map(id => `G${Number(id) + 1}:${labelForPlayer(MP.gnomeOwners[id])}`);
            claimsEl.textContent = `Claims: ${claims.length ? claims.join('  ') : 'none'}`;
        }
    }

    function labelForPlayer(playerId) {
        if (!playerId) return '--';
        if (playerId === MP.myPlayerId) return 'You';
        if (playerId === MP.hostPeerId) return 'Host';
        return 'P';
    }

    function disableLobbyEntryUi() {
        const localBtn = document.getElementById('mp-local-btn');
        const hostBtn = document.getElementById('mp-host-btn');
        const joinBtn = document.getElementById('mp-join-btn');
        const joinInput = document.getElementById('mp-join-id');
        if (localBtn) localBtn.style.display = 'none';
        if (hostBtn) hostBtn.disabled = true;
        if (joinBtn) joinBtn.disabled = true;
        if (joinInput) joinInput.disabled = true;
    }

    function attemptHost(retryCount) {
        if (!window.Peer) {
            setStatus('Status: Networking library unavailable.');
            return;
        }

        const pin = String(Math.floor(1000 + Math.random() * 9000));
        const peer = new window.Peer(pin);

        peer.on('open', (id) => {
            MP.peer = peer;
            MP.isHost = true;
            MP.isClient = false;
            MP.roomId = id;
            MP.hostPeerId = id;
            MP.myPlayerId = id;
            const roomEl = document.getElementById('mp-room-id');
            if (roomEl) roomEl.textContent = id;
            setStatus('Status: Hosting (waiting for players...)');
            disableLobbyEntryUi();
            clearDefaultSetupSelectionForOnlineLobby();
            syncSetupSelectionsFromClaims();
            refreshUi();
            installPeerErrorHandler(peer);
        });

        peer.on('connection', (connection) => {
            if (MP.clients.length >= MP.maxPlayers - 1) {
                connection.on('open', () => {
                    safeSend(connection, { type: 'server_full' });
                    connection.close();
                });
                return;
            }
            registerHostConnection(connection);
        });

        peer.on('error', (err) => {
            if (err && err.type === 'unavailable-id' && retryCount < 25) {
                try { peer.destroy(); } catch (e) {}
                attemptHost(retryCount + 1);
                return;
            }
            setStatus(`Status: ${err && err.message ? err.message : 'Host error.'}`);
            log('host error', err);
        });
    }

    function installPeerErrorHandler(peer) {
        if (!peer) return;
        peer.on('disconnected', () => {
            setStatus('Status: Peer disconnected.');
        });
    }

    function connectToHost(roomId) {
        if (!window.Peer) {
            setStatus('Status: Networking library unavailable.');
            return;
        }

        const peer = new window.Peer();
        MP.peer = peer;
        MP.roomId = roomId;
        MP.hostPeerId = roomId;

        peer.on('open', (id) => {
            MP.myPlayerId = id;
            const conn = peer.connect(roomId, { reliable: true });
            MP.conn = conn;

            conn.on('open', () => {
                MP.isClient = true;
                MP.isHost = false;
                disableLobbyEntryUi();
                setStatus('Status: Connected!');
                clearDefaultSetupSelectionForOnlineLobby();
                syncSetupSelectionsFromClaims();
                refreshUi();
                safeSend(conn, { type: 'hello' });
            });

            conn.on('data', handleHostMessage);
            conn.on('close', () => {
                setStatus('Status: Host connection closed.');
            });
            conn.on('error', () => {
                setStatus('Status: Connection failed.');
            });
        });

        peer.on('error', (err) => {
            setStatus(`Status: ${err && err.message ? err.message : 'Connection failed.'}`);
            log('client error', err);
        });
    }

    function registerHostConnection(connection) {
        connection.on('open', () => {
            MP.clients.push(connection);
            setStatus(`Status: Hosting (${MP.clients.length} connected)`);
            refreshUi();

            connection.on('data', (data) => handleClientMessage(data, connection));
            connection.on('close', () => handleClientDisconnect(connection));
            connection.on('error', () => handleClientDisconnect(connection));

            safeSend(connection, {
                type: 'welcome',
                roomId: MP.roomId,
                hostPeerId: MP.hostPeerId,
                gnomeOwners: clonePlainObject(MP.gnomeOwners),
                setupSelectedGnomes: cloneArray(window.setupSelectedGnomes),
                setupPlayerCount: window.setupPlayerCount,
                gameStarted: isGameStarted()
            });

            broadcastLobbyState();
            if (isGameStarted()) scheduleHostSnapshot(80);
        });
    }

    function handleClientDisconnect(connection) {
        MP.clients = MP.clients.filter(c => c !== connection);
        releaseClaimsForPlayer(connection.peer);
        setStatus(`Status: Hosting (${MP.clients.length} connected)`);
        broadcastLobbyState();
        scheduleHostSnapshot(80);
        refreshUi();
    }

    function safeSend(connection, payload) {
        if (!connection || !connection.open) return;
        try {
            connection.send(payload);
        } catch (err) {
            log('send failed', err);
        }
    }

    function broadcast(payload) {
        if (!MP.isHost) return;
        MP.clients.forEach((connection) => safeSend(connection, payload));
    }

    function handleClientMessage(data, connection) {
        if (!data || !data.type) return;

        switch (data.type) {
            case 'hello':
                broadcastLobbyState();
                if (isGameStarted()) scheduleHostSnapshot(50);
                break;

            case 'claim_request':
                handleClaimRequest(connection.peer, data.gnomeId);
                break;

            case 'click_request':
                handleRemoteClickRequest(connection.peer, data.descriptor);
                break;

            default:
                break;
        }
    }

    function handleHostMessage(data) {
        if (!data || !data.type) return;

        switch (data.type) {
            case 'server_full':
                setStatus('Status: Room is full.');
                break;

            case 'welcome':
                if (data.hostPeerId) MP.hostPeerId = data.hostPeerId;
                if (data.roomId) MP.roomId = data.roomId;
                if (data.gnomeOwners) {
                    MP.gnomeOwners = clonePlainObject(data.gnomeOwners);
                    syncSetupSelectionsFromClaims();
                } else {
                    if (Array.isArray(data.setupSelectedGnomes)) window.setupSelectedGnomes = data.setupSelectedGnomes.slice();
                    if (typeof data.setupPlayerCount !== 'undefined') window.setupPlayerCount = data.setupPlayerCount;
                    refreshSetupUi();
                }
                syncMultiplayerPanelVisibility();
                refreshUi();
                break;

            case 'lobby_state':
                applyLobbyState(data);
                break;

            case 'start_signal':
                triggerStartFromHost();
                break;

            case 'replay_click':
                replayRemoteClick(data.descriptor);
                break;

            case 'state_snapshot':
                applyHostSnapshot(data);
                break;

            case 'status':
                if (data.message) setStatus(`Status: ${data.message}`);
                if (data.alert && data.message) alert(data.message);
                break;

            default:
                break;
        }
    }

    function applyLobbyState(data) {
        if (data.gnomeOwners) {
            MP.gnomeOwners = clonePlainObject(data.gnomeOwners);
            syncSetupSelectionsFromClaims();
        } else {
            if (Array.isArray(data.setupSelectedGnomes)) window.setupSelectedGnomes = data.setupSelectedGnomes.slice();
            if (typeof data.setupPlayerCount !== 'undefined') window.setupPlayerCount = data.setupPlayerCount;
            refreshSetupUi();
        }
        syncMultiplayerPanelVisibility();
        refreshUi();
    }

    function broadcastLobbyState() {
        if (!MP.isHost || MP.isOffline) return;
        syncSetupSelectionsFromClaims();
        const payload = {
            type: 'lobby_state',
            gnomeOwners: clonePlainObject(MP.gnomeOwners),
            setupSelectedGnomes: cloneArray(window.setupSelectedGnomes),
            setupPlayerCount: window.setupPlayerCount
        };
        broadcast(payload);
        refreshUi();
    }

    function handleClaimRequest(playerId, rawGnomeId) {
        const gnomeId = normalizeGnomeId(rawGnomeId);
        if (gnomeId === null) return;

        const changed = setClaimForPlayer(playerId, gnomeId);
        if (!changed) {
            safeSend(findClientConnection(playerId), {
                type: 'status',
                message: 'That gnome is already taken.',
                alert: true
            });
            safeSend(findClientConnection(playerId), {
                type: 'lobby_state',
                gnomeOwners: clonePlainObject(MP.gnomeOwners),
                setupSelectedGnomes: cloneArray(window.setupSelectedGnomes),
                setupPlayerCount: window.setupPlayerCount
            });
            return;
        }

        broadcastLobbyState();
        refreshUi();
    }

    function findClientConnection(playerId) {
        return MP.clients.find(c => c.peer === playerId) || null;
    }

    function setClaimForPlayer(playerId, gnomeId) {
        const key = String(gnomeId);
        const currentOwner = MP.gnomeOwners[key];
        const existingClaimKey = findClaimedGnomeForPlayer(playerId);

        if (currentOwner && currentOwner !== playerId) {
            return false;
        }

        if (existingClaimKey === key) {
            delete MP.gnomeOwners[key];
            syncSetupSelectionsFromClaims();
            return true;
        }

        if (MP.oneGnomePerPlayer && existingClaimKey !== null) {
            delete MP.gnomeOwners[existingClaimKey];
        }

        MP.gnomeOwners[key] = playerId;
        syncSetupSelectionsFromClaims();
        return true;
    }

    function releaseClaimsForPlayer(playerId) {
        let changed = false;
        Object.keys(MP.gnomeOwners).forEach((gnomeId) => {
            if (MP.gnomeOwners[gnomeId] === playerId) {
                delete MP.gnomeOwners[gnomeId];
                changed = true;
            }
        });
        if (changed) syncSetupSelectionsFromClaims();
        return changed;
    }

    function findClaimedGnomeForPlayer(playerId) {
        const found = Object.keys(MP.gnomeOwners).find((gnomeId) => MP.gnomeOwners[gnomeId] === playerId);
        return typeof found === 'undefined' ? null : found;
    }

    function getMyClaimedGnomeIds() {
        return Object.keys(MP.gnomeOwners)
            .filter((gnomeId) => MP.gnomeOwners[gnomeId] === MP.myPlayerId)
            .map((gnomeId) => Number(gnomeId));
    }

    function getClaimSelectionList() {
        return Object.keys(MP.gnomeOwners)
            .map((gnomeId) => Number(gnomeId))
            .filter((gnomeId) => Number.isFinite(gnomeId))
            .sort((a, b) => a - b);
    }

    function getCurrentSetupSelectionList() {
        return cloneArray(window.setupSelectedGnomes)
            .map((gnomeId) => Number(gnomeId))
            .filter((gnomeId) => Number.isFinite(gnomeId))
            .sort((a, b) => a - b);
    }

    function getBaseToggleSetupGnome() {
        if (typeof window.orig_toggleSetupGnome === 'function') return window.orig_toggleSetupGnome;
        if (!MP.hooksInstalled.toggleSetupGnome && typeof window.toggleSetupGnome === 'function') return window.toggleSetupGnome;
        return null;
    }

    function listsEqual(a, b) {
        if (a === b) return true;
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        for (let i = 0; i < a.length; i += 1) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }

    function uniqueSortedGnomeIds(selected) {
        return Array.from(new Set(
            cloneArray(selected)
                .map((gnomeId) => Number(gnomeId))
                .filter((gnomeId) => Number.isFinite(gnomeId))
        )).sort((a, b) => a - b);
    }

    function applyDesiredSetupSelection(selected) {
        const desired = uniqueSortedGnomeIds(selected);

        // In multiplayer, treat claims as authoritative and write the roster directly.
        // The base setup toggle has its own local-game assumptions (including Bill being preselected),
        // which is what caused the lobby roster to drift away from the claim map.
        window.setupSelectedGnomes = desired.slice();
        window.setupPlayerCount = desired.length;
        updateSetupClaimStyles();
    }

    function syncSetupSelectionsFromClaims() {
        applyDesiredSetupSelection(getClaimSelectionList());
        refreshSetupUi();
    }

    function ensureSetupClaimStyleTag() {
        if (document.getElementById('mp-setup-claim-style')) return;
        const style = document.createElement('style');
        style.id = 'mp-setup-claim-style';
        style.textContent = `
            #screen-setup .mp-claimed-gnome {
                outline: 4px solid #f2c06b !important;
                outline-offset: 2px !important;
                box-shadow: 0 0 0 4px rgba(0,0,0,0.28) !important;
                position: relative !important;
            }
            #screen-setup .mp-claimed-gnome.mp-claimed-by-me {
                outline-color: #63d47a !important;
            }
            #screen-setup .mp-claimed-gnome.mp-claimed-by-other {
                outline-color: #f2c06b !important;
                filter: saturate(0.92);
            }
            #screen-setup .mp-claimed-gnome::after {
                content: attr(data-mp-owner-label);
                position: absolute;
                top: 6px;
                right: 6px;
                font: 700 11px/1 sans-serif;
                padding: 4px 6px;
                border-radius: 999px;
                background: rgba(0,0,0,0.85);
                color: #fff;
                z-index: 2;
                pointer-events: none;
            }
        `;
        document.head.appendChild(style);
    }

    function inferGnomeIdxFromElement(el) {
        if (!(el instanceof Element)) return null;

        const attrCandidates = [
            el.getAttribute('data-gnome-idx'),
            el.getAttribute('data-gnome-id'),
            el.getAttribute('data-idx'),
            el.getAttribute('data-id'),
            el.getAttribute('onclick')
        ].filter(Boolean);

        for (const raw of attrCandidates) {
            const match = String(raw).match(/toggleSetupGnome\s*\(\s*(\d+)\s*\)|^(\d+)$/);
            if (match) return Number(match[1] || match[2]);
        }

        return null;
    }

    function findSetupGnomeElements() {
        const root = document.getElementById('screen-setup') || document.body;
        const map = new Map();

        const explicit = Array.from(root.querySelectorAll('[onclick*="toggleSetupGnome"], [data-gnome-idx], [data-gnome-id], [data-idx]'));
        explicit.forEach((el) => {
            const idx = inferGnomeIdxFromElement(el);
            if (idx === null) return;
            if (!map.has(idx)) map.set(idx, []);
            map.get(idx).push(el);
        });

        // Fallback: if the setup cards are not annotated, use the first few visible setup click targets.
        if (map.size === 0) {
            const fallback = Array.from(root.querySelectorAll('button, [role="button"], .gnome-card, .setup-gnome, .setup-option, .character-card, .card'))
                .filter((el) => el.id !== 'start-game-btn' && isProbablyVisible(el))
                .slice(0, 4);
            fallback.forEach((el, idx) => map.set(idx, [el]));
        }

        return map;
    }

    function updateSetupClaimStyles() {
        if (isGameStarted()) return;
        ensureSetupClaimStyleTag();

        const elementsByIdx = findSetupGnomeElements();
        const selected = new Set(getClaimSelectionList());

        Array.from((document.getElementById('screen-setup') || document).querySelectorAll('.mp-claimed-gnome')).forEach((el) => {
            el.classList.remove('mp-claimed-gnome', 'mp-claimed-by-me', 'mp-claimed-by-other');
            el.removeAttribute('data-mp-owner-label');
        });

        elementsByIdx.forEach((els, idx) => {
            const owner = MP.gnomeOwners[String(idx)] || null;
            const claimed = selected.has(Number(idx));
            els.forEach((el) => {
                if (!claimed || !owner) return;
                el.classList.add('mp-claimed-gnome');
                el.classList.add(owner === MP.myPlayerId ? 'mp-claimed-by-me' : 'mp-claimed-by-other');
                el.setAttribute('data-mp-owner-label', owner === MP.myPlayerId ? 'YOU' : (owner === MP.hostPeerId ? 'HOST' : 'TAKEN'));
                el.title = owner === MP.myPlayerId ? 'Claimed by you' : 'Claimed by another player';
            });
        });
    }

    function syncMultiplayerPanelVisibility() {
        const panel = document.getElementById('mp-lobby');
        if (!panel) return;
        panel.style.display = isGameStarted() ? 'none' : '';
    }

    function clearDefaultSetupSelectionForOnlineLobby() {
        if (isGameStarted()) return;
        if (Object.keys(MP.gnomeOwners).length > 0) return;
        window.setupSelectedGnomes = [];
        window.setupPlayerCount = 0;
        window.setTimeout(() => {
            if (Object.keys(MP.gnomeOwners).length > 0) return;
            window.setupSelectedGnomes = [];
            window.setupPlayerCount = 0;
            updateSetupClaimStyles();
        }, 0);
    }

    function refreshSetupUi() {
        if (typeof window.renderGnomeNameInputs === 'function') {
            try { window.renderGnomeNameInputs(); } catch (e) { log('renderGnomeNameInputs failed', e); }
        }

        if (!isGameStarted()) {
            if (typeof window.renderAllNoBoard === 'function') {
                try { window.renderAllNoBoard(); } catch (e) { log('renderAllNoBoard failed', e); }
            } else if (typeof window.renderAll === 'function') {
                try { window.renderAll(); } catch (e) { log('renderAll failed', e); }
            }
        }

        updateSetupClaimStyles();
        syncMultiplayerPanelVisibility();
        refreshUi();
    }

    function isGameStarted() {
        return !!(window.G && window.G.grid && Array.isArray(window.G.grid) && window.G.grid.length > 0);
    }

    function startHostSnapshotLoop() {
        if (MP.syncIntervalId) return;
        MP.syncIntervalId = window.setInterval(() => {
            if (MP.isHost && !MP.isOffline && (MP.clients.length > 0)) {
                broadcastHostSnapshot();
            }
        }, 1500);
    }

    function scheduleHostSnapshot(delay) {
        if (!MP.isHost || MP.isOffline) return;
        window.setTimeout(() => {
            if (MP.isHost && !MP.isOffline) broadcastHostSnapshot();
        }, typeof delay === 'number' ? delay : 80);
    }

    function broadcastHostSnapshot() {
        if (!MP.isHost || MP.isOffline) return;

        const payload = {
            type: 'state_snapshot',
            seq: ++MP.snapshotSeq,
            G: prepStateForNetwork(window.G),
            setupSelectedGnomes: cloneArray(window.setupSelectedGnomes),
            setupPlayerCount: window.setupPlayerCount,
            gnomeOwners: clonePlainObject(MP.gnomeOwners),
            gameStarted: isGameStarted()
        };

        broadcast(payload);
        refreshUi();
    }

    function applyHostSnapshot(data) {
        const wasStarted = isGameStarted();

        if (typeof data.G !== 'undefined') {
            window.G = restoreStateFromNetwork(data.G);
        }
        if (data.gnomeOwners) {
            MP.gnomeOwners = clonePlainObject(data.gnomeOwners);
        }
        if (!data.gnomeOwners) {
            if (Array.isArray(data.setupSelectedGnomes)) window.setupSelectedGnomes = data.setupSelectedGnomes.slice();
            if (typeof data.setupPlayerCount !== 'undefined') window.setupPlayerCount = data.setupPlayerCount;
        }

        const nowStarted = !!data.gameStarted || isGameStarted();

        MP.suppressNetwork = true;
        try {
            if (!wasStarted && nowStarted) wakeGameUiAfterStart();
            if (nowStarted) {
                if (typeof window.renderAll === 'function') window.renderAll();
            } else if (data.gnomeOwners) {
                syncSetupSelectionsFromClaims();
            } else {
                refreshSetupUi();
            }
        } catch (err) {
            log('apply snapshot failed', err);
        } finally {
            MP.suppressNetwork = false;
        }

        syncMultiplayerPanelVisibility();
        refreshUi();
    }

    function wakeGameUiAfterStart() {
        const setupScreen = document.getElementById('screen-setup');
        if (setupScreen) setupScreen.classList.remove('show');
        if (typeof window.applyThemeArchitectureShells === 'function') {
            try { window.applyThemeArchitectureShells(); } catch (e) { log('applyThemeArchitectureShells failed', e); }
        }
        if (typeof window.mountUnifiedTurnDock === 'function') {
            try { window.mountUnifiedTurnDock(); } catch (e) { log('mountUnifiedTurnDock failed', e); }
        }
        syncMultiplayerPanelVisibility();
    }

    function triggerStartFromHost() {
        if (isGameStarted()) return;
        const btn = document.getElementById('start-game-btn');
        if (!btn) return;

        MP.suppressStartClick = true;
        MP.suppressNetwork = true;
        try {
            btn.click();
        } catch (err) {
            log('remote start failed', err);
        } finally {
            window.setTimeout(() => {
                MP.suppressStartClick = false;
                MP.suppressNetwork = false;
            }, 0);
        }
    }

    function installGlobalHooks() {
        if (!MP.hooksInstalled.clickCapture) {
            document.addEventListener('click', handleDocumentClickCapture, true);
            MP.hooksInstalled.clickCapture = true;
        }
    }

    function startHookPoller() {
        if (MP.hooksInstalled.poller) return;
        MP.pollerId = window.setInterval(installDelayedHooks, 400);
        MP.hooksInstalled.poller = true;
        installDelayedHooks();
    }

    function installDelayedHooks() {
        wrapRendererIfReady('renderAll');
        wrapRendererIfReady('renderAllNoBoard');
        wrapToggleSetupIfReady();
        hookStartButtonIfReady();
    }

    function wrapRendererIfReady(name) {
        if (MP.hooksInstalled[name]) return;
        if (typeof window[name] !== 'function') return;

        const original = window[name];
        if (!window[`orig_${name}`]) window[`orig_${name}`] = original;

        window[name] = function wrappedRenderer(...args) {
            const result = original.apply(this, args);
            if (MP.isHost && !MP.isOffline && !MP.suppressNetwork) {
                scheduleHostSnapshot(100);
            }
            updateSetupClaimStyles();
            syncMultiplayerPanelVisibility();
            refreshUi();
            return result;
        };

        MP.hooksInstalled[name] = true;
    }

    function wrapToggleSetupIfReady() {
        if (MP.hooksInstalled.toggleSetupGnome) return;
        if (typeof window.toggleSetupGnome !== 'function') return;

        const original = window.toggleSetupGnome;
        window.orig_toggleSetupGnome = window.orig_toggleSetupGnome || original;

        window.toggleSetupGnome = function wrappedToggleSetupGnome(idx, ...rest) {
            const gnomeId = normalizeGnomeId(idx);
            if (gnomeId === null) return;

            if (MP.suppressNetwork || MP.isOffline || (!MP.isHost && !MP.isClient)) {
                return original.apply(this, [idx, ...rest]);
            }

            if (MP.isHost) {
                const changed = setClaimForPlayer(MP.myPlayerId, gnomeId);
                if (!changed) {
                    alert('Another player has already claimed this gnome!');
                    return;
                }
                syncSetupSelectionsFromClaims();
                broadcastLobbyState();
                return;
            }

            if (MP.isClient) {
                const owner = MP.gnomeOwners[String(gnomeId)];
                if (owner && owner !== MP.myPlayerId) {
                    alert('Another player has already claimed this gnome!');
                    return;
                }
                sendToHost({ type: 'claim_request', gnomeId });
                return;
            }
        };

        MP.hooksInstalled.toggleSetupGnome = true;

        if (!isGameStarted() && (MP.isHost || MP.isClient)) {
            syncSetupSelectionsFromClaims();
        }
    }

    function hookStartButtonIfReady() {
        if (MP.hooksInstalled.startButton) return;
        const btn = document.getElementById('start-game-btn');
        if (!btn) return;

        btn.addEventListener('click', handleStartButtonClick, true);
        MP.hooksInstalled.startButton = true;
    }

    function handleStartButtonClick(event) {
        if (MP.suppressStartClick || MP.suppressNetwork || MP.isOffline) return;
        if (!MP.isHost && !MP.isClient) return;

        if (MP.isClient) {
            event.preventDefault();
            event.stopImmediatePropagation();
            alert('Only the host can start the online game.');
            return;
        }

        syncSetupSelectionsFromClaims();
        syncMultiplayerPanelVisibility();

        window.setTimeout(() => {
            wakeGameUiAfterStart();
            broadcast({ type: 'start_signal' });
            scheduleHostSnapshot(80);
            scheduleHostSnapshot(700);
        }, 0);
    }

    function sendToHost(payload) {
        if (!MP.isClient || !MP.conn) return;
        safeSend(MP.conn, payload);
    }

    function handleDocumentClickCapture(event) {
        if (MP.suppressNetwork || MP.isOffline) return;
        if (!MP.isHost && !MP.isClient) return;
        if (!(event.target instanceof Element)) return;
        if (event.target.closest('#mp-lobby')) return;

        const actionEl = getReplicableElement(event.target);
        if (!actionEl) return;
        if (actionEl.id === 'start-game-btn') return;
        if (isSetupScreenVisible()) return;

        if (!localPlayerMayAct()) {
            event.preventDefault();
            event.stopImmediatePropagation();
            maybeShowTurnAlert();
            return;
        }

        const descriptor = buildElementDescriptor(actionEl);
        if (!descriptor) return;

        if (MP.isClient) {
            event.preventDefault();
            event.stopImmediatePropagation();
            sendToHost({ type: 'click_request', descriptor });
            return;
        }

        if (MP.isHost) {
            window.setTimeout(() => {
                if (!MP.isHost || MP.suppressNetwork || MP.isOffline) return;
                broadcast({ type: 'replay_click', descriptor, seq: ++MP.lastReplaySeq });
                scheduleHostSnapshot(80);
                scheduleHostSnapshot(650);
            }, 0);
        }
    }

    function getReplicableElement(target) {
        if (!(target instanceof Element)) return null;

        const selector = [
            '.action-btn',
            '.cell',
            '.card-ok',
            '[data-command]',
            'button',
            '[role="button"]'
        ].join(',');

        const el = target.closest(selector);
        if (!el) return null;
        if (el.closest('#mp-lobby')) return null;
        if (el.matches('input, textarea, select')) return null;
        return el;
    }

    function localPlayerMayAct() {
        const controller = getCurrentControllerId();
        if (!controller) return true;
        return controller === MP.myPlayerId;
    }

    function getCurrentControllerId() {
        if (MP.isOffline) return null;
        if (isSetupScreenVisible()) return null;
        if (isWeaverScreenVisible()) return MP.hostPeerId;
        if (!window.G || !window.G.gnomes || !Array.isArray(window.G.gnomes)) return MP.hostPeerId;

        const currentIdx = typeof window.G.currentGnomeIdx === 'number' ? window.G.currentGnomeIdx : -1;
        const hasCurrentGnome = currentIdx >= 0 && window.G.gnomes[currentIdx];
        const blockingPromptVisible = !!document.querySelector('.card-ok');

        if ((window.G.phase === 'gnome' || blockingPromptVisible) && hasCurrentGnome) {
            let owner = null;
            const current = window.G.gnomes[currentIdx];

            // First try the live gnome id directly.
            if (current && typeof current.id !== 'undefined') {
                owner = MP.gnomeOwners[String(current.id)] || null;
            }

            // Fallback: in this game the turn order appears to track the selected lobby roster order
            // more reliably than the runtime gnome id, especially once the roster has been rebuilt.
            if (!owner) {
                const setupOrder = getCurrentSetupSelectionList();
                const fallbackGnomeId = setupOrder[currentIdx];
                if (typeof fallbackGnomeId !== 'undefined') owner = MP.gnomeOwners[String(fallbackGnomeId)] || null;
            }

            if (!owner) {
                const claimOrder = getClaimSelectionList();
                const fallbackGnomeId = claimOrder[currentIdx];
                if (typeof fallbackGnomeId !== 'undefined') owner = MP.gnomeOwners[String(fallbackGnomeId)] || null;
            }

            return owner || MP.hostPeerId;
        }

        return MP.hostPeerId;
    }

    function maybeShowTurnAlert() {
        const now = Date.now();
        if (now - MP.lastDeniedAlertAt < 1200) return;
        MP.lastDeniedAlertAt = now;
        alert('It is not your turn!');
    }

    function handleRemoteClickRequest(playerId, descriptor) {
        if (!MP.isHost) return;
        if (!descriptor) return;
        if (getCurrentControllerId() !== playerId) {
            safeSend(findClientConnection(playerId), {
                type: 'status',
                message: 'It is not your turn!',
                alert: true
            });
            scheduleHostSnapshot(80);
            return;
        }

        const ok = replayRemoteClick(descriptor);
        if (!ok) {
            scheduleHostSnapshot(80);
            return;
        }

        broadcast({ type: 'replay_click', descriptor, seq: ++MP.lastReplaySeq });
        scheduleHostSnapshot(80);
        scheduleHostSnapshot(650);
    }

    function replayRemoteClick(descriptor) {
        const el = resolveDescriptorToElement(descriptor);
        if (!el) {
            log('could not resolve click target', descriptor);
            return false;
        }

        MP.suppressNetwork = true;
        try {
            const ev = new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                view: window
            });
            el.dispatchEvent(ev);
        } catch (err) {
            log('replay failed', err);
            return false;
        } finally {
            window.setTimeout(() => {
                MP.suppressNetwork = false;
            }, 0);
        }

        return true;
    }

    function buildElementDescriptor(el) {
        if (!(el instanceof Element)) return null;
        return {
            id: el.id || null,
            dataCommand: el.getAttribute('data-command') || null,
            tag: el.tagName,
            text: normalizeText(el.textContent || ''),
            classes: Array.from(el.classList || []).slice(0, 8),
            path: buildDomPath(el)
        };
    }

    function resolveDescriptorToElement(descriptor) {
        if (!descriptor) return null;

        if (descriptor.id) {
            const byId = document.getElementById(descriptor.id);
            if (byId) return byId;
        }

        if (descriptor.dataCommand) {
            const selector = `[data-command="${escapeAttr(descriptor.dataCommand)}"]`;
            const byCommand = document.querySelector(selector);
            if (byCommand) return byCommand;
        }

        if (Array.isArray(descriptor.path)) {
            const byPath = resolveDomPath(descriptor.path);
            if (byPath) return byPath;
        }

        if (descriptor.tag) {
            const candidates = Array.from(document.querySelectorAll(descriptor.tag)).filter(isProbablyVisible);
            const wantedText = normalizeText(descriptor.text || '');
            const match = candidates.find((node) => {
                const textMatches = wantedText ? normalizeText(node.textContent || '') === wantedText : true;
                const classMatches = Array.isArray(descriptor.classes) && descriptor.classes.length
                    ? descriptor.classes.every((cls) => node.classList.contains(cls))
                    : true;
                return textMatches && classMatches;
            });
            if (match) return match;
        }

        return null;
    }

    function buildDomPath(el) {
        const path = [];
        let node = el;
        while (node && node !== document.body) {
            const parent = node.parentElement;
            if (!parent) break;
            const index = Array.prototype.indexOf.call(parent.children, node);
            path.unshift(index);
            node = parent;
        }
        return path;
    }

    function resolveDomPath(path) {
        let node = document.body;
        for (const index of path) {
            if (!node || !node.children || !node.children[index]) return null;
            node = node.children[index];
        }
        return node;
    }

    function isProbablyVisible(node) {
        if (!(node instanceof Element)) return false;
        if (node.closest('#mp-lobby')) return false;
        const style = window.getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden';
    }

    function isSetupScreenVisible() {
        const setup = document.getElementById('screen-setup');
        if (!setup) return !isGameStarted();
        return setup.classList.contains('show') && !isGameStarted();
    }

    function isWeaverScreenVisible() {
        const weaver = document.getElementById('screen-weaver');
        return !!(weaver && weaver.classList.contains('show'));
    }

    function normalizeGnomeId(value) {
        const num = Number(value);
        return Number.isFinite(num) ? num : null;
    }

    function normalizeText(text) {
        return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    }

    function escapeAttr(text) {
        if (window.CSS && typeof window.CSS.escape === 'function') {
            return window.CSS.escape(String(text));
        }
        return String(text).replace(/(["\\])/g, '\\$1');
    }

    function cloneArray(value) {
        return Array.isArray(value) ? value.slice() : [];
    }

    function clonePlainObject(value) {
        if (!value || typeof value !== 'object') return {};
        return Object.assign({}, value);
    }

    function prepStateForNetwork(state) {
        return deepSerialize(state);
    }

    function restoreStateFromNetwork(state) {
        return deepDeserialize(state);
    }

    function deepSerialize(value, seen) {
        if (!seen) seen = new WeakMap();
        if (value === null || typeof value === 'undefined') return value;
        if (typeof value === 'function') return undefined;
        if (typeof Element !== 'undefined' && value instanceof Element) return undefined;
        if (typeof Node !== 'undefined' && value instanceof Node) return undefined;
        if (typeof value !== 'object') return value;
        if (seen.has(value)) return seen.get(value);

        if (value instanceof Set) {
            const out = { __mpType: 'Set', values: [] };
            seen.set(value, out);
            out.values = Array.from(value).map((item) => deepSerialize(item, seen));
            return out;
        }

        if (value instanceof Map) {
            const out = { __mpType: 'Map', entries: [] };
            seen.set(value, out);
            out.entries = Array.from(value.entries()).map(([k, v]) => [deepSerialize(k, seen), deepSerialize(v, seen)]);
            return out;
        }

        if (Array.isArray(value)) {
            const out = [];
            seen.set(value, out);
            value.forEach((item) => out.push(deepSerialize(item, seen)));
            return out;
        }

        const out = {};
        seen.set(value, out);
        Object.keys(value).forEach((key) => {
            const serialized = deepSerialize(value[key], seen);
            if (typeof serialized !== 'undefined') out[key] = serialized;
        });
        return out;
    }

    function deepDeserialize(value, seen) {
        if (!seen) seen = new WeakMap();
        if (value === null || typeof value !== 'object') return value;
        if (seen.has(value)) return seen.get(value);

        if (value.__mpType === 'Set') {
            const out = new Set();
            seen.set(value, out);
            (value.values || []).forEach((item) => out.add(deepDeserialize(item, seen)));
            return out;
        }

        if (value.__mpType === 'Map') {
            const out = new Map();
            seen.set(value, out);
            (value.entries || []).forEach((entry) => {
                if (Array.isArray(entry) && entry.length === 2) {
                    out.set(deepDeserialize(entry[0], seen), deepDeserialize(entry[1], seen));
                }
            });
            return out;
        }

        if (Array.isArray(value)) {
            const out = [];
            seen.set(value, out);
            value.forEach((item) => out.push(deepDeserialize(item, seen)));
            return out;
        }

        const out = {};
        seen.set(value, out);
        Object.keys(value).forEach((key) => {
            out[key] = deepDeserialize(value[key], seen);
        });
        return out;
    }

    loadPeerJs();
})();
