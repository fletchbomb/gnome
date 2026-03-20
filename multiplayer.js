// multiplayer.js - Online Sync Mod for Gnome Invasion

// 1. Dynamically load PeerJS for networking
const script = document.createElement('script');
script.src = "https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js";
script.onload = initMultiplayer;
document.head.appendChild(script);

let isHost = false;
let isClient = false;
let peer = null;
let conn = null;
let clients = [];
let myGnomeIds = [0]; // The person who loads the page claims Gnome 0 by default

function initMultiplayer() {
    // 2. Build the Multiplayer Lobby UI Overlay
    const lobbyDiv = document.createElement('div');
    lobbyDiv.innerHTML = `
        <div style="position:fixed; top:15px; right:15px; background:rgba(26,18,13,0.95); padding:15px; color:#f4e6c8; z-index:9999; border-radius:10px; border: 2px solid #d6a652; font-family: 'Nunito', sans-serif; box-shadow: 0 4px 15px rgba(0,0,0,0.5);">
           <h3 style="margin-top:0; font-family:'Fredoka One'; color:#f2c06b;">Online Multiplayer</h3>
           <button id="mp-host-btn" style="background:#31734f; color:white; border:none; padding:8px 12px; border-radius:5px; cursor:pointer; font-weight:bold; margin-bottom:10px; width:100%;">Host Game</button>
           <div id="mp-host-info" style="display:none; margin-bottom:10px; font-weight:bold; color:#e7c17c;">Room ID: <span id="mp-room-id" style="user-select:all; background:#000; padding:2px 5px; border-radius:3px;">Generating...</span></div>
           <hr style="border-color:#7a5737; margin: 10px 0;">
           <div style="display:flex; gap:5px;">
               <input type="text" id="mp-join-id" placeholder="Paste Room ID" style="padding:5px; border-radius:5px; border:1px solid #7a5737; background:#2b1e16; color:white; width:120px;">
               <button id="mp-join-btn" style="background:#6a4a32; color:white; border:none; padding:5px 10px; border-radius:5px; cursor:pointer; font-weight:bold;">Join</button>
           </div>
           <div id="mp-status" style="margin-top:10px; font-size:0.85rem; color:#cdbb94;">Status: Offline</div>
        </div>
    `;
    document.body.appendChild(lobbyDiv);

    // Host Button Logic
    document.getElementById('mp-host-btn').addEventListener('click', () => {
        peer = new Peer();
        document.getElementById('mp-host-info').style.display = 'block';
        document.getElementById('mp-status').innerText = "Status: Generating ID...";
        peer.on('open', id => {
            document.getElementById('mp-room-id').innerText = id;
            document.getElementById('mp-status').innerText = "Status: Hosting (Waiting for players...)";
            isHost = true;
        });
        peer.on('connection', connection => {
            clients.push(connection);
            document.getElementById('mp-status').innerText = `Status: Hosting (${clients.length} connected)`;
            connection.on('data', handleClientData);
            broadcastState(); // Send current lobby state to new player
        });
    });

    // Join Button Logic
    document.getElementById('mp-join-btn').addEventListener('click', () => {
        const roomId = document.getElementById('mp-join-id').value.trim();
        if (!roomId) return;
        document.getElementById('mp-status').innerText = "Status: Connecting...";
        myGnomeIds =[]; // Clear default claim when joining someone else's game
        peer = new Peer();
        peer.on('open', () => {
            conn = peer.connect(roomId);
            conn.on('open', () => {
                isClient = true;
                document.getElementById('mp-status').innerText = "Status: Connected!";
                document.getElementById('mp-host-btn').style.display = 'none';
                conn.on('data', handleHostData);
            });
        });
    });

    hijackSyncFunctions();
}

// 3. State Synchronization Logic
function broadcastState() {
    if (!isHost) return;
    const payload = {
        type: 'state',
        G: window.G,
        setupSelectedGnomes: window.setupSelectedGnomes,
        setupPlayerCount: window.setupPlayerCount
    };
    clients.forEach(c => c.send(payload));
}

function handleClientData(data) {
    // When Host receives a state update from a client, accept it and forward to all other clients
    if (data.type === 'clientStateUpdate') {
        window.G = data.G;
        window.setupSelectedGnomes = data.setupSelectedGnomes;
        window.setupPlayerCount = data.setupPlayerCount;
        
        if (window.G && window.G.grid && window.G.grid.length > 0) {
            document.getElementById('screen-setup').classList.remove('show');
            window.orig_renderAll();
        } else {
            if (window.renderGnomeNameInputs) window.renderGnomeNameInputs();
        }
        broadcastState(); 
    }
}

function handleHostData(data) {
    // When Client receives the master state from the Host, apply it
    if (data.type === 'state') {
        window.G = data.G;
        window.setupSelectedGnomes = data.setupSelectedGnomes;
        window.setupPlayerCount = data.setupPlayerCount;

        if (window.G && window.G.grid && window.G.grid.length > 0) {
            document.getElementById('screen-setup').classList.remove('show');
            window.orig_renderAll();
        } else {
            if (window.renderGnomeNameInputs) window.renderGnomeNameInputs();
        }
    }
}

// 4. Hooking into the game's UI and Render flow
function hijackSyncFunctions() {
    // Whenever the UI re-renders, the game state has changed. Send the new state!
    if (typeof window.renderAll === 'function') {
        window.orig_renderAll = window.renderAll;
        window.renderAll = function(...args) {
            window.orig_renderAll.apply(this, args);
            if (isHost) broadcastState();
            else if (isClient) conn.send({ type: 'clientStateUpdate', G: window.G, setupSelectedGnomes: window.setupSelectedGnomes, setupPlayerCount: window.setupPlayerCount });
        }
    }

    if (typeof window.renderAllNoBoard === 'function') {
        window.orig_renderAllNoBoard = window.renderAllNoBoard;
        window.renderAllNoBoard = function(...args) {
            window.orig_renderAllNoBoard.apply(this, args);
            if (isHost) broadcastState();
            else if (isClient) conn.send({ type: 'clientStateUpdate', G: window.G, setupSelectedGnomes: window.setupSelectedGnomes, setupPlayerCount: window.setupPlayerCount });
        }
    }

    // Handle Gnome Selection in the Lobby
    if (typeof window.toggleSetupGnome === 'function') {
        window.orig_toggleSetupGnome = window.toggleSetupGnome;
        window.toggleSetupGnome = function(idx) {
            const numIdx = Number(idx);
            
            // Prevent picking gnomes already claimed by someone else over the network
            if (window.setupSelectedGnomes.includes(numIdx) && !myGnomeIds.includes(numIdx)) {
                alert("Another player has already claimed this gnome!");
                return;
            }

            // Claim or unclaim locally
            if (myGnomeIds.includes(numIdx)) {
                myGnomeIds = myGnomeIds.filter(id => id !== numIdx);
            } else {
                myGnomeIds.push(numIdx);
            }

            window.orig_toggleSetupGnome.apply(this, [idx]);
            
            if (isHost) broadcastState();
            else if (isClient) conn.send({ type: 'clientStateUpdate', G: window.G, setupSelectedGnomes: window.setupSelectedGnomes, setupPlayerCount: window.setupPlayerCount });
        }
    }
    
    // 5. Turn Enforcement Logic
    document.addEventListener('click', (e) => {
        if (!isClient && !isHost) return; // Only enforce if multiplayer is active
        if (!window.G || !window.G.gnomes) return; // Game hasn't started

        // Enforce: Player 1 controls the Weaver Screen
        const isWeaver = document.getElementById('screen-weaver').classList.contains('show');
        if (isWeaver && isClient) {
            e.stopPropagation();
            e.preventDefault();
            alert("Player 1 (Host) controls the Weaver shopping screen.");
            return;
        }

        // Identify if they clicked a game button, room, or popup
        const isGameAction = e.target.closest('.action-btn') || e.target.closest('.cell') || e.target.closest('.card-ok') || e.target.closest('[data-command]');
        
        // Enforce: You can only click during Gnome Phase, and only if it's YOUR gnome
        if (isGameAction && window.G.phase === 'gnome') {
            const currentGnomeId = window.G.gnomes[window.G.currentGnomeIdx].id;
            if (!myGnomeIds.includes(currentGnomeId)) {
                e.stopPropagation();
                e.preventDefault();
                console.log("Ignored click - It is not your turn!");
            }
        }
    }, true); // 'true' runs this before any of the game's actual click logic!
}