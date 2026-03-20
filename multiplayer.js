// multiplayer.js - Online Sync Mod for Gnome Invasion (v4 - Input Replication)

// 1. Dynamically load PeerJS for networking
const script = document.createElement('script');
script.src = "https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js";
script.onload = initMultiplayer;
document.head.appendChild(script);

let isHost = false;
let isClient = false;
let isOffline = false; // Tracks if we bypassed multiplayer for local testing
let peer = null;
let conn = null;
let clients =[];
let myGnomeIds = [0]; // The Host claims Gnome 0 (Bill) by default
let isExecutingRemoteClick = false;

function initMultiplayer() {
    // 2. Build the Multiplayer Lobby UI Overlay
    const lobbyDiv = document.createElement('div');
    lobbyDiv.id = 'mp-lobby';
    lobbyDiv.innerHTML = `
        <div style="position:fixed; top:15px; right:15px; background:rgba(26,18,13,0.95); padding:15px; color:#f4e6c8; z-index:9999; border-radius:10px; border: 2px solid #d6a652; font-family: 'Nunito', sans-serif; box-shadow: 0 4px 15px rgba(0,0,0,0.5); width: 220px;">
           <h3 style="margin-top:0; margin-bottom:15px; font-family:'Fredoka One'; color:#f2c06b; text-align:center;">Gnome Invasion</h3>
           
           <button id="mp-local-btn" style="background:#5a3f2b; color:white; border:1px solid #d6a652; padding:8px 12px; border-radius:5px; cursor:pointer; font-weight:bold; margin-bottom:15px; width:100%;">Play Local (Hotseat)</button>
           
           <h4 style="margin:0 0 10px 0; color:#e7c17c; border-bottom: 1px solid #7a5737; padding-bottom: 5px; text-align:center;">Online Multiplayer</h4>
           
           <button id="mp-host-btn" style="background:#31734f; color:white; border:none; padding:8px 12px; border-radius:5px; cursor:pointer; font-weight:bold; margin-bottom:10px; width:100%;">Host Game</button>
           <div id="mp-host-info" style="display:none; margin-bottom:10px; font-weight:bold; color:#e7c17c; text-align:center;">
                Room PIN:<br>
                <span id="mp-room-id" style="user-select:all; background:#000; padding:4px 8px; border-radius:5px; font-size: 1.5em; letter-spacing: 3px; display:inline-block; margin-top:5px;">....</span>
           </div>
           
           <div style="display:flex; gap:5px; margin-bottom: 5px;">
               <input type="text" id="mp-join-id" placeholder="PIN" maxlength="4" style="padding:5px; border-radius:5px; border:1px solid #7a5737; background:#2b1e16; color:white; width:70px; text-align: center; font-size: 1.1em; font-weight:bold;">
               <button id="mp-join-btn" style="background:#6a4a32; color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer; font-weight:bold; flex-grow: 1;">Join</button>
           </div>
           
           <div id="mp-status" style="margin-top:10px; font-size:0.85rem; color:#cdbb94; text-align:center;">Status: Waiting...</div>
        </div>
    `;
    document.body.appendChild(lobbyDiv);

    // Bypass Multiplayer
    document.getElementById('mp-local-btn').addEventListener('click', () => {
        isOffline = true;
        document.getElementById('mp-lobby').style.display = 'none';
    });

    // Host Logic
    document.getElementById('mp-host-btn').addEventListener('click', () => {
        document.getElementById('mp-host-info').style.display = 'block';
        document.getElementById('mp-status').innerText = "Status: Generating PIN...";
        document.getElementById('mp-join-btn').disabled = true;
        document.getElementById('mp-join-id').disabled = true;
        document.getElementById('mp-local-btn').style.display = 'none';
        attemptHost();
    });

    // Join Logic
    document.getElementById('mp-join-btn').addEventListener('click', () => {
        const roomId = document.getElementById('mp-join-id').value.trim();
        if (!roomId || roomId.length !== 4) { alert("Please enter a 4-digit PIN."); return; }
        
        document.getElementById('mp-status').innerText = "Status: Connecting...";
        document.getElementById('mp-host-btn').disabled = true;
        document.getElementById('mp-local-btn').style.display = 'none';
        
        myGnomeIds =[]; // Client drops default ownership, builds it by clicking
        peer = new Peer();
        peer.on('open', () => {
            conn = peer.connect(roomId);
            conn.on('open', () => {
                isClient = true;
                document.getElementById('mp-status').innerText = "Status: Connected!";
                document.getElementById('mp-host-btn').style.display = 'none';
                conn.on('data', data => handleNetworkMessage(data, conn));
            });
            conn.on('error', () => { document.getElementById('mp-status').innerText = "Status: Connection failed."; });
        });
    });
}

function attemptHost() {
    const pin = Math.floor(1000 + Math.random() * 9000).toString();
    peer = new Peer(pin);
    
    peer.on('open', id => {
        document.getElementById('mp-room-id').innerText = id;
        document.getElementById('mp-status').innerText = "Status: Hosting (Waiting for players...)";
        isHost = true;
    });

    peer.on('connection', connection => {
        connection.on('open', () => {
            clients.push(connection);
            document.getElementById('mp-status').innerText = `Status: Hosting (${clients.length} connected)`;
            connection.on('data', data => handleNetworkMessage(data, connection));
            
            connection.on('close', () => {
                clients = clients.filter(c => c !== connection);
                document.getElementById('mp-status').innerText = `Status: Hosting (${clients.length} connected)`;
            });
        });
    });

    peer.on('error', err => {
        if (err.type === 'unavailable-id') attemptHost(); // PIN collision, try again
        else document.getElementById('mp-status').innerText = "Error: " + err.message;
    });
}

// --- NETWORK MESSAGE ROUTER ---
function handleNetworkMessage(data, senderConn = null) {
    if (data.type === 'remoteClick') {
        // If Host receives a click from a client, bounce it to all OTHER clients so everyone is synced
        if (isHost && senderConn) {
            clients.forEach(c => { if (c !== senderConn) c.send(data); });
        }
        // Execute the click locally!
        const el = document.querySelector(data.selector);
        if (el) {
            isExecutingRemoteClick = true;
            el.click();
            isExecutingRemoteClick = false;
        }
    } else if (data.type === 'syncState' && isClient) {
        // Quietly absorb the Host's game state if our game is sitting perfectly still
        if (window.GnomeInvasionDev && typeof SEQ !== 'undefined' && SEQ.queuedCount === 0) {
            window.GnomeInvasionDev.restoreGameState(restoreStateFromNetwork(data.G));
        }
    }
}

// --- BACKGROUND STATE CORRECTOR ---
setInterval(() => {
    if (isHost && !isOffline && window.GnomeInvasionDev) {
        const G = window.GnomeInvasionDev.getCurrentState();
        // Only send alignment states when the board is totally idle and animations are done
        if (typeof SEQ !== 'undefined' && SEQ.queuedCount === 0 && !document.body.classList.contains('card-showing') && G.phase === 'gnome') {
            const stateStr = JSON.stringify(prepStateForNetwork(G));
            if (stateStr !== window.lastSyncedHash) {
                window.lastSyncedHash = stateStr;
                const payload = { type: 'syncState', G: prepStateForNetwork(G) };
                clients.forEach(c => c.send(payload));
            }
        }
    }
}, 1500);

// --- THE INPUT REPLICATOR ---
document.addEventListener('click', (e) => {
    if (isOffline) return; 
    if (!isClient && !isHost) return; 
    if (isExecutingRemoteClick) return; // Allow our "ghost clicks" to pass through!

    // Find what element the player actually tried to click
    const target = e.target.closest('button, .cell, .door, .room-item, .ui-icon-host, .setup-gnome-card, .weaver-token-shell, .weaver-card');
    if (!target) return;

    // 1. Gnome Ownership in Setup Lobby
    if (target.classList.contains('setup-gnome-card')) {
        const cards = Array.from(document.querySelectorAll('.setup-gnome-card'));
        const idx = cards.indexOf(target);
        
        if (target.classList.contains('is-active') && !myGnomeIds.includes(idx)) {
            e.preventDefault(); e.stopPropagation();
            alert("Another player controls this gnome.");
            return;
        }
        // Toggle personal ownership
        if (myGnomeIds.includes(idx)) myGnomeIds = myGnomeIds.filter(id => id !== idx);
        else myGnomeIds.push(idx);
    }

    // 2. Hide Menu when start is clicked
    if (target.id === 'start-game-btn') document.getElementById('mp-lobby').style.display = 'none';

    // 3. Turn Enforcement (Is it my turn?)
    if (window.GnomeInvasionDev) {
        const G = window.GnomeInvasionDev.getCurrentState();
        if (G && G.grid && G.grid[7][7]) { // Game has started
            let canClick = false;
            const isWeaver = document.getElementById('screen-weaver').classList.contains('show');
            
            if (isWeaver) {
                if (isHost) canClick = true;
                else if (G.weaverModal && G.weaverModal.mode === 'room') {
                    canClick = myGnomeIds.includes(G.gnomes[G.currentGnomeIdx].id);
                }
            } else if (G.phase === 'gnome') {
                canClick = myGnomeIds.includes(G.gnomes[G.currentGnomeIdx].id);
            } else if (G.phase === 'panic' && G.panicState && G.panicState.panicQueue.length > 0) {
                canClick = myGnomeIds.includes(G.gnomes[G.panicState.panicQueue[0]].id);
            } else if (G.gameEnded || document.getElementById('screen-victory').classList.contains('show')) {
                canClick = isHost;
            } else if (document.getElementById('card-overlay').classList.contains('show')) {
                if (G.phase === 'gnome') canClick = myGnomeIds.includes(G.gnomes[G.currentGnomeIdx].id);
                else canClick = isHost;
            }

            // Exclude Debug & UI tools from locking
            if (target.id === 'btn-audio-mute' || target.closest('#debug-panel') || target.id === 'debug-toggle') return;

            if (!canClick) {
                e.stopPropagation(); e.preventDefault();
                if (window.showGameTooltip) window.showGameTooltip("It is not your turn!", target);
                else alert("It is not your turn!");
                return;
            }
        }
    }

    // 4. We are allowed to click! We let the click happen normally, AND we send it to our peers.
    const selector = getElementIdentifier(target);
    const payload = { type: 'remoteClick', selector };
    
    if (isHost) clients.forEach(c => c.send(payload));
    else if (isClient) conn.send(payload);

}, true); // We capture the click immediately as it hits the document!

// --- SELECTOR GENERATOR ---
// Generates a robust CSS path so the receiving browser knows exactly what element to click
function getElementIdentifier(el) {
   if (el.id) return `#${el.id}`;
   if (el.dataset && el.dataset.command) {
       let sel = `[data-command="${el.dataset.command}"]`;
       if (el.dataset.commandArg) sel += `[data-command-arg="${el.dataset.commandArg}"]`;
       return sel;
   }
   if (el.classList.contains('cell') && el.dataset.r) {
       return `.cell[data-r="${el.dataset.r}"][data-c="${el.dataset.c}"]`;
   }
   if (el.classList.contains('door')) {
       const cell = el.closest('.cell');
       if (cell) {
           const dir = ['N','E','S','W'].find(d => el.classList.contains(d));
           return `.cell[data-r="${cell.dataset.r}"][data-c="${cell.dataset.c}"] .door.${dir}`;
       }
   }
   if (el.classList.contains('setup-gnome-card')) {
       const cards = Array.from(document.querySelectorAll('.setup-gnome-card'));
       return `.setup-roster > button:nth-child(${cards.indexOf(el) + 1})`;
   }
   const path =
