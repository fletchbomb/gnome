// multiplayer.js - integrated online menu + host-authoritative click replication
(function () {
  'use strict';

  const MP = {
    version: '5.0.0',
    debug: false,
    peerLibLoading: false,
    peerLibReady: false,
    peer: null,
    hostConn: null,
    clients: new Map(),
    isHost: false,
    isClient: false,
    roomId: '',
    hostPeerId: '',
    myPlayerId: '',
    playerOrder: [],
    gnomeOwners: {},
    rosterOwners: [],
    statusText: '',
    syncingSnapshot: false,
    replayingClick: false,
    suppressStartWrap: false,
    lastDeniedAlertAt: 0,
    lastReplaySeq: 0,
    syncTimers: new Set(),
    wrapped: {
      startGame: false,
      resetGame: false,
      renderAll: false,
      renderAllNoBoard: false
    },
    originals: {
      startGame: null,
      resetGame: null,
      renderAll: null,
      renderAllNoBoard: null
    }
  };

  window.__gnomeMP = MP;

  function log(...args) {
    if (MP.debug) console.log('[gnome-mp]', ...args);
  }

  function ready(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function el(id) {
    return document.getElementById(id);
  }

  function normalizeText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
  }

  function isGameStarted() {
    return !!(window.G && Array.isArray(window.G.grid) && window.G.grid.length);
  }

  function isSetupVisible() {
    const setup = el('screen-setup');
    return !!(setup && setup.classList.contains('show'));
  }

  function isWeaverVisible() {
    const weaver = el('screen-weaver');
    return !!(weaver && weaver.classList.contains('show'));
  }

  function hasSession() {
    return !!(MP.isHost || MP.isClient);
  }

  function activeConnections() {
    return MP.playerOrder.filter(Boolean);
  }

  function playerHasClaim(playerId) {
    return Object.values(MP.gnomeOwners).some(ownerId => ownerId === playerId);
  }

  function getClaimedProfileForPlayer(playerId) {
    for (const [profileIdx, ownerId] of Object.entries(MP.gnomeOwners)) {
      if (ownerId === playerId) return Number(profileIdx);
    }
    return null;
  }

  function getSelectedProfiles() {
    return Object.keys(MP.gnomeOwners)
      .map(v => Number(v))
      .filter(v => Number.isInteger(v) && v >= 0 && v <= 3)
      .sort((a, b) => a - b);
  }

  function syncSetupSelectionsFromClaims(options = {}) {
    const selected = getSelectedProfiles();
    if (typeof window.setSetupSelectedGnomes === 'function') {
      window.setSetupSelectedGnomes(selected, { render: options.render !== false });
    } else {
      window.setupSelectedGnomes = selected.slice();
      window.setupPlayerCount = selected.length;
      if (options.render !== false && typeof window.renderSetupUi === 'function') window.renderSetupUi();
    }
  }

  function getPlayerSlot(playerId) {
    const idx = MP.playerOrder.indexOf(playerId);
    return idx >= 0 ? idx + 1 : null;
  }

  function getPlayerLabel(playerId) {
    const slot = getPlayerSlot(playerId);
    return slot ? `Player ${slot}` : 'Player';
  }

  function getOwnerBadgeLabel(ownerId) {
    if (!ownerId) return '';
    if (ownerId === MP.myPlayerId) return 'YOU';
    const slot = getPlayerSlot(ownerId);
    return slot ? `PLAYER ${slot}` : 'TAKEN';
  }

  function minimumPlayersMet() {
    return activeConnections().length >= 2;
  }

  function everyoneHasExactlyOneClaim() {
    const players = activeConnections();
    if (!players.length) return false;
    return players.every(playerId => playerHasClaim(playerId));
  }

  function canHostStart() {
    return !!(MP.isHost && minimumPlayersMet() && everyoneHasExactlyOneClaim());
  }

  function setStatus(text) {
    MP.statusText = String(text || '');
    refreshUi();
  }

  function leaveMenuToLanding() {
    if (hasSession()) disconnectSession({ keepOnlineMode: false });
    else refreshUi();
  }

  function prepareOnlineMode() {
    if (hasSession() && typeof window.setSetupOnlineView === 'function') {
      window.setSetupOnlineView('room');
      return;
    }
    refreshUi();
  }

  function afterGameReset() {
    syncSetupSelectionsFromClaims({ render: false });
    refreshUi();
  }

  function getOnlineUiState() {
    const connected = activeConnections();
    let statusText = MP.statusText || '';
    if (hasSession()) {
      if (MP.isHost) {
        if (!minimumPlayersMet()) statusText = 'Waiting for 2 players to connect';
        else if (!everyoneHasExactlyOneClaim()) statusText = 'Waiting for each player to pick a gnome';
        else statusText = 'Ready to start';
      } else if (MP.isClient) {
        const meLabel = getPlayerLabel(MP.myPlayerId);
        statusText = everyoneHasExactlyOneClaim() ? 'Waiting for host to start' : `Connected as ${meLabel}`;
      }
    }

    const players = [];
    for (let i = 0; i < 4; i += 1) {
      const playerId = MP.playerOrder[i] || null;
      players.push({
        slot: i + 1,
        label: `Player ${i + 1}`,
        connected: !!playerId,
        isSelf: playerId === MP.myPlayerId,
        claimProfile: playerId ? getClaimedProfileForPlayer(playerId) : null
      });
    }

    return {
      sessionActive: hasSession(),
      isHost: MP.isHost,
      isClient: MP.isClient,
      roomId: MP.roomId,
      connectedCount: connected.length,
      players,
      startReady: canHostStart(),
      statusText
    };
  }

  function renderPlayerPills(players) {
    const container = el('setup-online-players');
    if (!container) return;
    container.innerHTML = players.map(player => {
      const claimName = Number.isInteger(player.claimProfile) && Array.isArray(window.GNOME_NAMES_DEFAULT)
        ? window.GNOME_NAMES_DEFAULT[player.claimProfile]
        : '';
      const suffix = player.connected
        ? (claimName ? `· ${claimName}` : '· Connected')
        : '· Waiting';
      const classes = [
        'setup-player-pill',
        player.connected ? 'is-connected' : '',
        player.isSelf ? 'is-self' : ''
      ].filter(Boolean).join(' ');
      return `<span class="${classes}">${player.label} ${suffix}</span>`;
    }).join('');
  }

  function refreshUi() {
    const state = getOnlineUiState();

    const rolePill = el('setup-online-role');
    const roomCode = el('setup-room-code');
    const status = el('setup-online-status');

    if (rolePill) {
      if (state.sessionActive) {
        if (state.isHost) rolePill.textContent = 'You are Host';
        else if (state.isClient) rolePill.textContent = `Connected as ${getPlayerLabel(MP.myPlayerId)}`;
        else rolePill.textContent = 'Online';
      } else {
        rolePill.textContent = 'Not connected';
      }
    }

    if (roomCode) roomCode.textContent = state.roomId || '----';
    if (status) status.textContent = state.statusText || '';
    renderPlayerPills(state.players);

    if (typeof window.renderSetupUi === 'function') {
      window.renderSetupUi();
    }
  }

  function getSetupCardMeta(profileIdx) {
    const ownerId = MP.gnomeOwners[String(profileIdx)] || null;
    return {
      claimed: !!ownerId,
      ownerId,
      ownerSelf: ownerId === MP.myPlayerId,
      ownerLabel: getOwnerBadgeLabel(ownerId)
    };
  }

  function loadPeerJs() {
    if (window.Peer) {
      MP.peerLibReady = true;
      refreshUi();
      return;
    }
    if (MP.peerLibLoading) return;
    MP.peerLibLoading = true;
    const existing = document.querySelector('script[data-gnome-peerjs="1"]');
    if (existing) {
      existing.addEventListener('load', () => {
        MP.peerLibReady = !!window.Peer;
        refreshUi();
      }, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js';
    script.async = true;
    script.dataset.gnomePeerjs = '1';
    script.onload = () => {
      MP.peerLibReady = !!window.Peer;
      refreshUi();
    };
    script.onerror = () => {
      MP.peerLibReady = false;
      MP.peerLibLoading = false;
      setStatus('Could not load multiplayer library');
    };
    document.head.appendChild(script);
  }

  function destroyPeer() {
    try {
      if (MP.peer && !MP.peer.destroyed) MP.peer.destroy();
    } catch (err) {
      log('destroy peer failed', err);
    }
    MP.peer = null;
  }

  function clearSyncTimers() {
    for (const timer of MP.syncTimers) window.clearTimeout(timer);
    MP.syncTimers.clear();
  }

  function disconnectSession({ keepOnlineMode = true } = {}) {
    clearSyncTimers();
    try {
      if (MP.hostConn) MP.hostConn.close();
    } catch (err) {
      log('host conn close failed', err);
    }
    MP.hostConn = null;

    for (const connection of MP.clients.values()) {
      try { connection.close(); } catch (err) { log('client close failed', err); }
    }
    MP.clients.clear();

    destroyPeer();

    MP.isHost = false;
    MP.isClient = false;
    MP.roomId = '';
    MP.hostPeerId = '';
    MP.myPlayerId = '';
    MP.playerOrder = [];
    MP.gnomeOwners = {};
    MP.rosterOwners = [];
    MP.lastReplaySeq = 0;
    MP.statusText = keepOnlineMode ? 'Choose Host Game or Join Game' : '';
    syncSetupSelectionsFromClaims({ render: false });

    if (!keepOnlineMode && typeof window.setSetupOnlineView === 'function') {
      window.setSetupOnlineView('choice');
    }
    refreshUi();
  }

  function safeSend(connection, payload) {
    if (!connection || connection.open === false) return;
    try {
      connection.send(payload);
    } catch (err) {
      log('send failed', err);
    }
  }

  function broadcast(payload) {
    if (!MP.isHost) return;
    for (const connection of MP.clients.values()) {
      safeSend(connection, payload);
    }
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
      out.values = Array.from(value).map(item => deepSerialize(item, seen));
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
      value.forEach((item, idx) => {
        const serialized = deepSerialize(item, seen);
        if (typeof serialized !== 'undefined') out[idx] = serialized;
      });
      return out;
    }

    const out = {};
    seen.set(value, out);
    Object.keys(value).forEach(key => {
      const serialized = deepSerialize(value[key], seen);
      if (typeof serialized !== 'undefined') out[key] = serialized;
    });
    return out;
  }

  function deepDeserialize(value, seen) {
    if (!seen) seen = new WeakMap();
    if (value === null || typeof value === 'undefined' || typeof value !== 'object') return value;
    if (seen.has(value)) return seen.get(value);

    if (value.__mpType === 'Set') {
      const out = new Set();
      seen.set(value, out);
      (value.values || []).forEach(item => out.add(deepDeserialize(item, seen)));
      return out;
    }

    if (value.__mpType === 'Map') {
      const out = new Map();
      seen.set(value, out);
      (value.entries || []).forEach(entry => {
        out.set(deepDeserialize(entry[0], seen), deepDeserialize(entry[1], seen));
      });
      return out;
    }

    if (Array.isArray(value)) {
      const out = [];
      seen.set(value, out);
      value.forEach((item, idx) => {
        out[idx] = deepDeserialize(item, seen);
      });
      return out;
    }

    const out = {};
    seen.set(value, out);
    Object.keys(value).forEach(key => {
      out[key] = deepDeserialize(value[key], seen);
    });
    return out;
  }

  function makeSnapshotPayload() {
    return {
      type: 'snapshot',
      state: deepSerialize(window.G),
      selectedProfiles: getSelectedProfiles(),
      rosterOwners: MP.rosterOwners.slice(),
      gnomeOwners: Object.assign({}, MP.gnomeOwners),
      playerOrder: MP.playerOrder.slice()
    };
  }

  function scheduleHostSnapshot(delayMs = 80) {
    if (!MP.isHost || !isGameStarted()) return;
    const timer = window.setTimeout(() => {
      MP.syncTimers.delete(timer);
      broadcast(makeSnapshotPayload());
    }, delayMs);
    MP.syncTimers.add(timer);
  }

  function broadcastLobbyState() {
    if (!MP.isHost) return;
    syncSetupSelectionsFromClaims({ render: false });
    const payload = {
      type: 'lobby_state',
      hostPeerId: MP.hostPeerId,
      roomId: MP.roomId,
      playerOrder: MP.playerOrder.slice(),
      gnomeOwners: Object.assign({}, MP.gnomeOwners),
      selectedProfiles: getSelectedProfiles()
    };
    broadcast(payload);
    refreshUi();
  }

  function handleConnectionClose(playerId) {
    if (MP.isHost) {
      MP.clients.delete(playerId);
      MP.playerOrder = MP.playerOrder.filter(id => id !== playerId);
      Object.keys(MP.gnomeOwners).forEach(profileIdx => {
        if (MP.gnomeOwners[profileIdx] === playerId) delete MP.gnomeOwners[profileIdx];
      });
      syncSetupSelectionsFromClaims({ render: false });
      broadcastLobbyState();
      setStatus(MP.playerOrder.length >= 2 ? 'Waiting for each player to pick a gnome' : 'Waiting for 2 players to connect');
    } else {
      disconnectSession({ keepOnlineMode: true });
      if (typeof window.setSetupOnlineView === 'function') window.setSetupOnlineView('choice');
      setStatus('Connection closed');
    }
  }

  function handleIncomingConnection(connection) {
    connection.on('open', () => {
      const playerId = connection.peer;
      if (MP.playerOrder.length >= 4) {
        safeSend(connection, { type: 'status', message: 'Room is full.', alert: true });
        connection.close();
        return;
      }
      MP.clients.set(playerId, connection);
      if (!MP.playerOrder.includes(playerId)) MP.playerOrder.push(playerId);

      connection.on('data', data => handlePeerMessage(playerId, data));
      connection.on('close', () => handleConnectionClose(playerId));
      connection.on('error', err => log('client connection error', err));

      safeSend(connection, {
        type: 'welcome',
        hostPeerId: MP.hostPeerId,
        roomId: MP.roomId,
        playerOrder: MP.playerOrder.slice(),
        gnomeOwners: Object.assign({}, MP.gnomeOwners),
        selectedProfiles: getSelectedProfiles()
      });
      broadcastLobbyState();
    });
  }

  function hostGame() {
    if (!MP.peerLibReady || !window.Peer) {
      setStatus('Loading multiplayer library...');
      loadPeerJs();
      return;
    }

    disconnectSession({ keepOnlineMode: true });
    if (typeof window.setSetupOnlineView === 'function') window.setSetupOnlineView('room');
    setStatus('Generating room code...');

    const attempt = () => {
      const roomId = String(Math.floor(1000 + Math.random() * 9000));
      const peer = new window.Peer(roomId);

      peer.on('open', id => {
        MP.peer = peer;
        MP.isHost = true;
        MP.isClient = false;
        MP.roomId = id;
        MP.hostPeerId = id;
        MP.myPlayerId = id;
        MP.playerOrder = [id];
        MP.gnomeOwners = {};
        MP.rosterOwners = [];
        peer.on('connection', handleIncomingConnection);
        peer.on('error', err => {
          if (err && err.type === 'unavailable-id') {
            attempt();
            return;
          }
          log('host peer error', err);
          setStatus(err?.message || 'Host connection error');
        });
        setStatus('Waiting for 2 players to connect');
        refreshUi();
      });

      peer.on('error', err => {
        if (err && err.type === 'unavailable-id') {
          attempt();
          return;
        }
        setStatus(err?.message || 'Could not host game');
      });
    };

    attempt();
  }

  function joinGame(roomId) {
    if (!MP.peerLibReady || !window.Peer) {
      setStatus('Loading multiplayer library...');
      loadPeerJs();
      return;
    }

    const normalized = String(roomId || '').replace(/\D+/g, '').slice(0, 4);
    if (!/^\d{4}$/.test(normalized)) {
      alert('Please enter a 4-digit PIN.');
      return;
    }

    disconnectSession({ keepOnlineMode: true });
    setStatus('Connecting...');

    const peer = new window.Peer();
    MP.peer = peer;

    peer.on('open', id => {
      MP.myPlayerId = id;
      MP.hostPeerId = normalized;
      MP.roomId = normalized;
      const connection = peer.connect(normalized, { reliable: true });
      MP.hostConn = connection;

      connection.on('open', () => {
        MP.isClient = true;
        MP.isHost = false;
        if (typeof window.setSetupOnlineView === 'function') window.setSetupOnlineView('room');
        refreshUi();
      });

      connection.on('data', data => handlePeerMessage(normalized, data));
      connection.on('close', () => handleConnectionClose(normalized));
      connection.on('error', err => {
        log('join connection error', err);
        setStatus(err?.message || 'Join failed');
      });
    });

    peer.on('error', err => {
      log('join peer error', err);
      setStatus(err?.message || 'Join failed');
    });
  }

  function claimForPlayer(playerId, profileIdx) {
    if (!MP.isHost) return;
    const profile = Number(profileIdx);
    if (!Number.isInteger(profile) || profile < 0 || profile > 3) return;

    const currentOwner = MP.gnomeOwners[String(profile)] || null;
    const currentlyOwnedProfile = getClaimedProfileForPlayer(playerId);

    if (currentOwner && currentOwner !== playerId) {
      const connection = MP.clients.get(playerId);
      safeSend(connection, { type: 'status', message: 'That gnome is already taken.', alert: true });
      return;
    }

    if (currentOwner === playerId) {
      delete MP.gnomeOwners[String(profile)];
    } else {
      if (Number.isInteger(currentlyOwnedProfile)) delete MP.gnomeOwners[String(currentlyOwnedProfile)];
      MP.gnomeOwners[String(profile)] = playerId;
    }

    syncSetupSelectionsFromClaims({ render: false });
    broadcastLobbyState();
  }

  function requestClaim(profileIdx) {
    if (window.setupMode !== 'online') return;
    const profile = Number(profileIdx);
    if (!Number.isInteger(profile) || profile < 0 || profile > 3) return;

    if (!hasSession()) {
      alert('Host or join a room first.');
      return;
    }

    if (MP.isHost) {
      claimForPlayer(MP.myPlayerId, profile);
      return;
    }

    safeSend(MP.hostConn, { type: 'claim_request', profileIdx: profile });
  }

  function applyLobbyState(data) {
    MP.hostPeerId = data.hostPeerId || MP.hostPeerId;
    MP.roomId = data.roomId || MP.roomId;
    MP.playerOrder = Array.isArray(data.playerOrder) ? data.playerOrder.slice() : MP.playerOrder;
    MP.gnomeOwners = data.gnomeOwners && typeof data.gnomeOwners === 'object' ? Object.assign({}, data.gnomeOwners) : {};
    syncSetupSelectionsFromClaims({ render: false });
    refreshUi();
  }

  function handleStartSignal(data) {
    MP.rosterOwners = Array.isArray(data.rosterOwners) ? data.rosterOwners.slice() : [];
    if (Array.isArray(data.selectedProfiles) && typeof window.setSetupSelectedGnomes === 'function') {
      window.setSetupSelectedGnomes(data.selectedProfiles, { render: false });
    }

    if (MP.originals.startGame) {
      MP.suppressStartWrap = true;
      try {
        MP.originals.startGame();
      } finally {
        MP.suppressStartWrap = false;
      }
    }
  }

  function applySnapshot(data) {
    if (!data || typeof data !== 'object') return;
    if (Array.isArray(data.playerOrder)) MP.playerOrder = data.playerOrder.slice();
    if (data.gnomeOwners && typeof data.gnomeOwners === 'object') MP.gnomeOwners = Object.assign({}, data.gnomeOwners);
    if (Array.isArray(data.rosterOwners)) MP.rosterOwners = data.rosterOwners.slice();
    if (Array.isArray(data.selectedProfiles) && typeof window.setSetupSelectedGnomes === 'function') {
      window.setSetupSelectedGnomes(data.selectedProfiles, { render: false });
    }

    if (!data.state) {
      refreshUi();
      return;
    }

    MP.syncingSnapshot = true;
    try {
      window.G = deepDeserialize(data.state);
      if (isGameStarted()) {
        if (MP.originals.renderAll) MP.originals.renderAll();
        else if (typeof window.renderAll === 'function') window.renderAll();
      } else if (typeof window.renderSetupUi === 'function') {
        window.renderSetupUi();
      }
    } catch (err) {
      log('snapshot apply failed', err);
    } finally {
      MP.syncingSnapshot = false;
      refreshUi();
    }
  }

  function handlePeerMessage(fromId, data) {
    if (!data || typeof data !== 'object') return;

    switch (data.type) {
      case 'welcome':
        MP.isClient = true;
        MP.isHost = false;
        applyLobbyState(data);
        setStatus('Connected');
        break;
      case 'lobby_state':
        applyLobbyState(data);
        break;
      case 'claim_request':
        if (MP.isHost) claimForPlayer(fromId, data.profileIdx);
        break;
      case 'status':
        if (typeof data.message === 'string') setStatus(data.message);
        if (data.alert && data.message) alert(data.message);
        break;
      case 'start_signal':
        handleStartSignal(data);
        break;
      case 'click_request':
        if (MP.isHost) handleRemoteClickRequest(fromId, data.descriptor);
        break;
      case 'replay_click':
        if (MP.isClient) replayRemoteClick(data.descriptor);
        break;
      case 'snapshot':
        if (MP.isClient) applySnapshot(data);
        break;
      default:
        break;
    }
  }

  function getCurrentControllerId() {
    if (!hasSession()) return null;
    if (isSetupVisible()) return null;
    if (isWeaverVisible()) return MP.hostPeerId || MP.myPlayerId || null;
    if (!window.G || !Array.isArray(window.G.gnomes) || !window.G.gnomes.length) return MP.hostPeerId || MP.myPlayerId || null;

    const currentIdx = Number(window.G.currentGnomeIdx);
    const overlayVisible = !!document.querySelector('#card-overlay.show');
    if ((window.G.phase === 'gnome' || overlayVisible) && Number.isInteger(currentIdx)) {
      return MP.rosterOwners[currentIdx] || MP.hostPeerId || MP.myPlayerId || null;
    }
    return MP.hostPeerId || MP.myPlayerId || null;
  }

  function localPlayerMayAct() {
    const controller = getCurrentControllerId();
    if (!controller) return true;
    return controller === MP.myPlayerId;
  }

  function maybeTurnAlert() {
    const now = Date.now();
    if (now - MP.lastDeniedAlertAt < 1200) return;
    MP.lastDeniedAlertAt = now;
    alert('It is not your turn!');
  }

  function getReplicableElement(target) {
    if (!(target instanceof Element)) return null;
    if (target.closest('#screen-setup')) return null;
    if (target.closest('#debug-panel') || target.closest('#debug-toggle')) return null;
    const selector = '.action-btn, .cell, .card-ok, [data-command], button, [role="button"]';
    const found = target.closest(selector);
    if (!found) return null;
    if (found.matches('input, textarea, select, option')) return null;
    return found;
  }

  function buildDescriptor(elm) {
    if (!(elm instanceof Element)) return null;
    const dataset = {};
    ['command', 'commandArg', 'r', 'c', 'popupGnome', 'popupType', 'popupSlot'].forEach(key => {
      if (typeof elm.dataset[key] !== 'undefined') dataset[key] = elm.dataset[key];
    });
    return {
      id: elm.id || null,
      tag: elm.tagName,
      text: normalizeText(elm.textContent || ''),
      classes: Array.from(elm.classList || []).slice(0, 8),
      dataset,
      path: buildDomPath(elm)
    };
  }

  function buildDomPath(elm) {
    const path = [];
    let node = elm;
    while (node && node !== document.body) {
      const parent = node.parentElement;
      if (!parent) break;
      path.unshift(Array.prototype.indexOf.call(parent.children, node));
      node = parent;
    }
    return path;
  }

  function resolveDomPath(path) {
    let node = document.body;
    for (const idx of path || []) {
      if (!node || !node.children || !node.children[idx]) return null;
      node = node.children[idx];
    }
    return node;
  }

  function resolveDescriptor(descriptor) {
    if (!descriptor) return null;

    if (descriptor.id) {
      const byId = document.getElementById(descriptor.id);
      if (byId) return byId;
    }

    const ds = descriptor.dataset || {};
    if (typeof ds.r !== 'undefined' && typeof ds.c !== 'undefined') {
      const byCell = document.querySelector(`[data-r="${CSS.escape(String(ds.r))}"][data-c="${CSS.escape(String(ds.c))}"]`);
      if (byCell) return byCell;
    }

    if (typeof ds.command !== 'undefined') {
      let selector = `[data-command="${CSS.escape(String(ds.command))}"]`;
      if (typeof ds.commandArg !== 'undefined') selector += `[data-command-arg="${CSS.escape(String(ds.commandArg))}"]`;
      const byCommand = document.querySelector(selector);
      if (byCommand) return byCommand;
    }

    if (Array.isArray(descriptor.path)) {
      const byPath = resolveDomPath(descriptor.path);
      if (byPath) return byPath;
    }

    if (descriptor.tag) {
      const candidates = Array.from(document.querySelectorAll(descriptor.tag)).filter(node => {
        if (!(node instanceof Element)) return false;
        const style = window.getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
      const wantedText = normalizeText(descriptor.text || '');
      return candidates.find(node => {
        const classesOk = Array.isArray(descriptor.classes) && descriptor.classes.length
          ? descriptor.classes.every(cls => node.classList.contains(cls))
          : true;
        const textOk = wantedText ? normalizeText(node.textContent || '') === wantedText : true;
        return classesOk && textOk;
      }) || null;
    }

    return null;
  }

  function replayRemoteClick(descriptor) {
    const target = resolveDescriptor(descriptor);
    if (!target) {
      log('replay target not found', descriptor);
      return false;
    }

    MP.replayingClick = true;
    try {
      const event = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
      });
      target.dispatchEvent(event);
      return true;
    } catch (err) {
      log('replay click failed', err);
      return false;
    } finally {
      window.setTimeout(() => { MP.replayingClick = false; }, 0);
    }
  }

  function handleRemoteClickRequest(playerId, descriptor) {
    if (!MP.isHost) return;
    if (getCurrentControllerId() !== playerId) {
      safeSend(MP.clients.get(playerId), { type: 'status', message: 'It is not your turn!', alert: true });
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
    scheduleHostSnapshot(550);
  }

  function handleClickCapture(event) {
    if (!hasSession() || MP.syncingSnapshot || MP.replayingClick) return;
    if (isSetupVisible()) return;
    if (!(event.target instanceof Element)) return;

    const actionable = getReplicableElement(event.target);
    if (!actionable) return;
    if (actionable.id === 'start-game-btn') return;

    if (!localPlayerMayAct()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      maybeTurnAlert();
      return;
    }

    const descriptor = buildDescriptor(actionable);
    if (!descriptor) return;

    if (MP.isClient) {
      event.preventDefault();
      event.stopImmediatePropagation();
      safeSend(MP.hostConn, { type: 'click_request', descriptor });
      return;
    }

    if (MP.isHost) {
      window.setTimeout(() => {
        if (!MP.isHost || MP.replayingClick || MP.syncingSnapshot) return;
        broadcast({ type: 'replay_click', descriptor, seq: ++MP.lastReplaySeq });
        scheduleHostSnapshot(80);
        scheduleHostSnapshot(550);
      }, 0);
    }
  }

  function wrapGameFunctions() {
    if (!MP.wrapped.startGame && typeof window.startGame === 'function') {
      MP.originals.startGame = window.startGame;
      window.startGame = function wrappedStartGame(...args) {
        if (MP.suppressStartWrap || window.setupMode !== 'online' || !hasSession()) {
          return MP.originals.startGame.apply(this, args);
        }

        if (!MP.isHost) {
          alert('Only the host can start the online game.');
          return;
        }

        if (!canHostStart()) {
          if (!minimumPlayersMet()) alert('You need 2 connected players to start online play.');
          else alert('Each connected player must claim exactly 1 gnome.');
          return;
        }

        syncSetupSelectionsFromClaims({ render: false });
        MP.rosterOwners = getSelectedProfiles().map(profileIdx => MP.gnomeOwners[String(profileIdx)] || MP.hostPeerId);
        const result = MP.originals.startGame.apply(this, args);

        broadcast({
          type: 'start_signal',
          selectedProfiles: getSelectedProfiles(),
          rosterOwners: MP.rosterOwners.slice()
        });
        scheduleHostSnapshot(80);
        scheduleHostSnapshot(550);
        return result;
      };
      MP.wrapped.startGame = true;
    }

    if (!MP.wrapped.resetGame && typeof window.resetGame === 'function') {
      MP.originals.resetGame = window.resetGame;
      window.resetGame = function wrappedResetGame(...args) {
        const result = MP.originals.resetGame.apply(this, args);
        if (hasSession()) {
          syncSetupSelectionsFromClaims({ render: false });
          if (typeof window.setSetupOnlineView === 'function') window.setSetupOnlineView('room');
        }
        refreshUi();
        return result;
      };
      MP.wrapped.resetGame = true;
    }

    if (!MP.wrapped.renderAll && typeof window.renderAll === 'function') {
      MP.originals.renderAll = window.renderAll;
      window.renderAll = function wrappedRenderAll(...args) {
        const result = MP.originals.renderAll.apply(this, args);
        if (!MP.syncingSnapshot && MP.isHost && isGameStarted()) {
          scheduleHostSnapshot(90);
        }
        return result;
      };
      MP.wrapped.renderAll = true;
    }

    if (!MP.wrapped.renderAllNoBoard && typeof window.renderAllNoBoard === 'function') {
      MP.originals.renderAllNoBoard = window.renderAllNoBoard;
      window.renderAllNoBoard = function wrappedRenderAllNoBoard(...args) {
        const result = MP.originals.renderAllNoBoard.apply(this, args);
        if (!MP.syncingSnapshot && MP.isHost && isGameStarted()) {
          scheduleHostSnapshot(90);
        }
        return result;
      };
      MP.wrapped.renderAllNoBoard = true;
    }
  }

  function bindUi() {
    const hostBtn = el('setup-host-btn');
    const showJoinBtn = el('setup-show-join-btn');
    const joinBtn = el('setup-join-btn');
    const joinBackBtn = el('setup-join-back-btn');
    const leaveBtn = el('setup-online-leave-btn');
    const joinInput = el('setup-join-code-input');

    if (hostBtn && !hostBtn.dataset.mpBound) {
      hostBtn.dataset.mpBound = '1';
      hostBtn.addEventListener('click', () => hostGame());
    }

    if (showJoinBtn && !showJoinBtn.dataset.mpBound) {
      showJoinBtn.dataset.mpBound = '1';
      showJoinBtn.addEventListener('click', () => {
        if (typeof window.setSetupOnlineView === 'function') window.setSetupOnlineView('join');
      });
    }

    if (joinBtn && !joinBtn.dataset.mpBound) {
      joinBtn.dataset.mpBound = '1';
      joinBtn.addEventListener('click', () => joinGame(joinInput ? joinInput.value : ''));
    }

    if (joinBackBtn && !joinBackBtn.dataset.mpBound) {
      joinBackBtn.dataset.mpBound = '1';
      joinBackBtn.addEventListener('click', () => {
        if (typeof window.setSetupOnlineView === 'function') window.setSetupOnlineView('choice');
      });
    }

    if (leaveBtn && !leaveBtn.dataset.mpBound) {
      leaveBtn.dataset.mpBound = '1';
      leaveBtn.addEventListener('click', () => {
        disconnectSession({ keepOnlineMode: true });
        if (typeof window.setSetupOnlineView === 'function') window.setSetupOnlineView('choice');
      });
    }

    if (joinInput && !joinInput.dataset.mpBound) {
      joinInput.dataset.mpBound = '1';
      joinInput.addEventListener('input', () => {
        joinInput.value = joinInput.value.replace(/\D+/g, '').slice(0, 4);
      });
      joinInput.addEventListener('keydown', event => {
        if (event.key === 'Enter') joinGame(joinInput.value);
      });
    }
  }

  ready(() => {
    bindUi();
    wrapGameFunctions();
    document.addEventListener('click', handleClickCapture, true);
    loadPeerJs();
    refreshUi();
  });

  window.__gnomeMPApi = {
    prepareOnlineMode,
    leaveMenuToLanding,
    afterGameReset,
    hasSession,
    requestClaim,
    getOnlineUiState,
    getSetupCardMeta
  };
})();
