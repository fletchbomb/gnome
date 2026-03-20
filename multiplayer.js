// multiplayer.js - Online Sync Mod for Gnome Invasion (v2 with PINs & Local Play)

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
let myGnomeIds = [0]; // The person who loads the page claims Gnome 0 by default

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

    // Bypass Multiplayer - Play Locally
    document.getElementById('mp-local-btn').addEventListener('click', () => {
        isOffline = true;
        document.getElementById('mp-lobby').style.display = 'none';
    });

    // Host Button Logic
    document.getElementById('mp-host-btn').addEventListener('click', () => {
        document.getElementById('mp-host-info').style.display = 'block';
        document.getElementById('mp-status').innerText = "Status: Generating PIN...";
        document.getElementById('mp-join-btn').disabled = true;
        document.getElementById('mp-join-id').disabled = true;
        document.getElementById('mp-local-btn').style.display = 'none';
        
        attemptHost();
    });

    // Join Button Logic
    document.getElementById('mp-join-btn').addEventListener('click', () => {
        const roomId = document.getElementById('mp-join-id').value.trim();
        if (!roomId || roomId.length !== 4) {
            alert("Please enter a 4-digit PIN.");
            return;
        }
        document.getElementById('mp-status').innerText = "Status: Connecting...";
        document.getElementById('mp-host-btn').disabled = true;
        document.getElementById('mp-local-btn').style.display = 'none';
        
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
            conn.on('error', () => {
                document.getElementById('mp-status').innerText = "Status: Connection failed.";
            });
        });
    });

    hijackSyncFunctions();
}

// Attempts to create a room with a random 4-digit PIN
function attemptHost() {
    const pin = Math.floor(1000 + Math.random() * 9000).toString(); // Generate '1000' to '9999'
    peer = new Peer(pin);
    
    peer.on('open', id => {
        document.getElementById('mp-room-id').innerText = id;
        document.getElementById('mp-status').innerText = "Status: Hosting (Waiting for players...)";
        isHost = true;
    });

    peer.on('connection', connection => {
        clients.push(connection);
        document.getElementById('mp-status').innerText = `Status: Hosting (${clients.length} connected)`;
        connection.on('data', handleClientData);
        
        connection.on('close', () => {
            clients = clients.filter(c => c !== connection);
            document.getElementById('mp-status').innerText = `Status: Hosting (${clients.length} connected)`;
        });

        broadcastState(); // Send current lobby state to new player
    });

    peer.on('error', err => {
        if (err.type === 'unavailable-id') {
            // PIN collision! Someone else is using this 4-digit PIN. Try again instantly.
            attemptHost();
        } else {
            document.getElementById('mp-status').innerText = "Error: " + err.message;
        }
    });
}

// 3. State Synchronization Logic
function broadcastState() {
    if (!isHost || isOffline) return;
    const payload = {
        type: 'state',
        G: window.G,
        setupSelectedGnomes: window.setupSelectedGnomes,
        setupPlayerCount: window.setupPlayerCount
    };
    clients.forEach(c => c.send(payload));
}

function handleClientData(data) {
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
    if (typeof window.renderAll === 'function') {
        window.orig_renderAll = window.renderAll;
        window.renderAll = function(...args) {
            window.orig_renderAll.apply(this, args);
            if (isOffline) return;
            if (isHost) broadcastState();
            else if (isClient) conn.send({ type: 'clientStateUpdate', G: window.G, setupSelectedGnomes: window.setupSelectedGnomes, setupPlayerCount: window.setupPlayerCount });
        }
    }

    if (typeof window.renderAllNoBoard === 'function') {
        window.orig_renderAllNoBoard = window.renderAllNoBoard;
        window.renderAllNoBoard = function(...args) {
            window.orig_renderAllNoBoard.apply(this, args);
            if (isOffline) return;
            if (isHost) broadcastState();
            else if (isClient) conn.send({ type: 'clientStateUpdate', G: window.G, setupSelectedGnomes: window.setupSelectedGnomes, setupPlayerCount: window.setupPlayerCount });
        }
    }

    if (typeof window.toggleSetupGnome === 'function') {
        window.orig_toggleSetupGnome = window.toggleSetupGnome;
        window.toggleSetupGnome = function(idx) {
            const numIdx = Number(idx);
            
            if (!isOffline && window.setupSelectedGnomes.includes(numIdx) && !myGnomeIds.includes(numIdx)) {
                alert("Another player has already claimed this gnome!");
                return;
            }

            if (myGnomeIds.includes(numIdx)) {
                myGnomeIds = myGnomeIds.filter(id => id !== numIdx);
            } else {
                myGnomeIds.push(numIdx);
            }

            window.orig_toggleSetupGnome.apply(this,[idx]);
            
            if (isOffline) return;
            if (isHost) broadcastState();
            else if (isClient) conn.send({ type: 'clientStateUpdate', G: window.G, setupSelectedGnomes: window.setupSelectedGnomes, setupPlayerCount: window.setupPlayerCount });
        }
    }
    
    // 5. Turn Enforcement Logic
    document.addEventListener('click', (e) => {
        if (isOffline) return; // Completely bypass networking rules
        if (!isClient && !isHost) return; 
        if (!window.G || !window.G.gnomes) return; 

        const isWeaver = document.getElementById('screen-weaver').classList.contains('show');
        if (isWeaver && isClient) {
            e.stopPropagation();
            e.preventDefault();
            alert("Player 1 (Host) controls the Weaver shopping screen.");
            return;
        }

        const isGameAction = e.target.closest('.action-btn') || e.target.closest('.cell') || e.target.closest('.card-ok') || e.target.closest('[data-command]');
        
        if (isGameAction && window.G.phase === 'gnome') {
            const currentGnomeId = window.G.gnomes[window.G.currentGnomeIdx].id;
            if (!myGnomeIds.includes(currentGnomeId)) {
                e.stopPropagation();
                e.preventDefault();
                console.log("Ignored click - It is not your turn!");
            }
        }
    }, true); 
}
