const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const nesFixture = require('./helpers/nes-fixture');

if (!process.versions.electron) {
  const executable = process.env.MONKY_GAMES_ELECTRON;
  if (!executable) throw new Error('Set MONKY_GAMES_ELECTRON to the Monky checkout Electron executable.');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  void (async () => {
    for (const game of ['doom', 'nes']) {
      const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'monky-games-browser-'));
      const code = await new Promise((resolve, reject) => {
        const child = spawn(executable, [__filename], { env: { ...env, MONKY_GAMES_TEST_PROFILE: temporary, MONKY_GAMES_TEST_GAME: game }, stdio: 'inherit' });
        child.once('error', reject);
        child.once('exit', resolve);
      });
      fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      if (code !== 0) { process.exitCode = code ?? 1; return; }
    }
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {
  const { app, BrowserWindow, ipcMain, protocol } = require('electron');
  const { GamesService } = require('../dist/games/service');
  const { gamesHtml } = require('../dist/commands/games');
  const temporary = process.env.MONKY_GAMES_TEST_PROFILE;
  protocol.registerSchemesAsPrivileged([{ scheme: 'monky-miniapp', privileges: {
    standard: true, secure: true, supportFetchAPI: true, corsEnabled: true,
  } }]);
  app.setPath('userData', path.join(temporary, 'profile'));
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  // Short closing timeouts let the test watch a frozen game resume after an "end" that did not happen.
  const service = new GamesService({ host: '127.0.0.1', port: 0, publicUrl: 'http://127.0.0.1', closingLeaveMs: 500 });
  const windows = [], errors = [], identities = new Map();
  let timeout, step = '';
  const began = Date.now();
  const waitFor = async (check, label, duration = 20000) => {
    step = label;
    if (process.env.MONKY_GAMES_TEST_TRACE) console.log(`[${((Date.now() - began) / 1000).toFixed(1)}s] ${label}`);
    const end = Date.now() + duration;
    while (Date.now() < end) {
      if (await check()) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out: ${label}\n${errors.join('\n')}`);
  };
  // A renderer stuck in a busy loop never answers: name it instead of waiting for the global timeout.
  const run = (window, code) => {
    let timer;
    return Promise.race([window.webContents.executeJavaScript(code, true), new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`Renderer ${identities.get(window.webContents.id)} did not answer: ${code.slice(0, 120)}`)), 15000);
    })]).finally(() => clearTimeout(timer));
  };
  // Optional visual review: MONKY_GAMES_TEST_SHOTS=<dir> keeps screenshots of the main screens.
  const shot = async (window, name) => {
    if (!process.env.MONKY_GAMES_TEST_SHOTS) return;
    // A hidden window returns its last painted frame; the first capture makes it paint the current one.
    await window.webContents.capturePage();
    await new Promise(resolve => setTimeout(resolve, 300));
    fs.writeFileSync(path.join(process.env.MONKY_GAMES_TEST_SHOTS, `${process.env.MONKY_GAMES_TEST_GAME}-${name}.png`),
      (await window.webContents.capturePage()).toPNG());
  };
  const finish = async code => {
    clearTimeout(timeout);
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    await service.close();
    app.exit(code);
  };
  app.whenReady().then(async () => {
    timeout = setTimeout(() => { console.error(`Games smoke timeout at: ${step}\n` + errors.join('\n')); void finish(1); }, 180000);
    const base = await service.start();
    const game = process.env.MONKY_GAMES_TEST_GAME;
    assert.ok(['doom', 'nes'].includes(game));
    let room = service.create(game, 'alice');
    const preload = path.join(temporary, 'preload.cjs');
    fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');
      contextBridge.exposeInMainWorld('gameTest',{authorize:key=>ipcRenderer.send('games-test:authorize',key)});`);
    ipcMain.on('games-test:authorize', (event, key) => {
      const identity = identities.get(event.sender.id);
      assert.ok(identity);
      assert.equal(event.senderFrame, event.sender.mainFrame);
      service.authorize(room, key, identity, identity);
    });
    for (const id of ['alice', 'bob', 'viewer']) {
      const window = new BrowserWindow({ show: false, width: 900, height: 800, webPreferences: {
        nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false,
        preload, partition: `games-smoke-${id}`,
      } });
      windows.push(window);
      window.webContents.setAudioMuted(true);
      identities.set(window.webContents.id, id);
      window.webContents.on('console-message', details => {
        if (details.level === 'warning' || details.level === 'error' || details.level >= 2 || details.message.includes('[DOOM]')) {
          errors.push(`${id}: ${details.message}`);
          if (errors.length > 200) errors.shift();
        }
      });
      const boot = `<script>window.testAudioEnergy=0;
        const originalProcessor=AudioContext.prototype.createScriptProcessor;
        AudioContext.prototype.createScriptProcessor=function(...args){
          const processor=originalProcessor.apply(this,args);
          queueMicrotask(()=>processor.addEventListener('audioprocess',event=>{
            const samples=event.outputBuffer.getChannelData(0);
            for(let i=0;i<samples.length;i++)window.testAudioEnergy+=Math.abs(samples[i]);
          }));
          return processor;
        };
        window.addEventListener('error',event=>console.error(event.error?.stack||event.message));
        window.addEventListener('unhandledrejection',event=>console.error(event.reason?.stack||event.reason));
        window.testHooks={beforeClose:[],close:[],visibility:[]};
        const testStore=new Map(),statusListeners=new Set();let storageStatus='unavailable';
        const denied=()=>Object.assign(new Error('Storage denied'),{name:'MonkyStorageError',reason:'denied'});
        window.testStorage={store:testStore,writes:[],setStatus(next){storageStatus=next;for(const listener of statusListeners)listener(next);}};
        window.monkyScreen={
        viewer:{id:${JSON.stringify(id)},nickname:${JSON.stringify(id)},locale:'en'},
        onState: callback=>{callback({},0);return ()=>{}},
        sendAction:(action,payload)=>{window.gameTest.authorize(payload.key);return true},
        onBeforeClose:handler=>{testHooks.beforeClose.push(handler);return ()=>{}},
        onClose:handler=>{testHooks.close.push(handler);return ()=>{}},
        onVisibilityChange:handler=>{testHooks.visibility.push(handler);handler(true);return ()=>{}},
        storage:{
          get status(){return storageStatus},
          onStatus(callback){statusListeners.add(callback);callback(storageStatus);return ()=>statusListeners.delete(callback)},
          async get(key){if(storageStatus!=='granted')throw denied();const value=testStore.get(key);return value?value.slice(0):null},
          async set(key,value,options){
            if(storageStatus!=='granted'){if(options?.autosave)return false;throw denied();}
            const bytes=value instanceof Blob?await value.arrayBuffer():ArrayBuffer.isView(value)
              ?value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength):value.slice(0);
            testStore.set(key,bytes);testStorage.writes.push([key,!!options?.autosave]);return true;
          },
          async delete(key){return testStore.delete(key)},
          async list({prefix=''}={}){if(storageStatus!=='granted')throw denied();
            return [...testStore.keys()].filter(key=>key.startsWith(prefix)).sort().map(key=>({key,size:testStore.get(key).byteLength,updatedAt:Date.now()}))},
          async usage(){return null},
        }
      };</script>`;
      window.webContents.session.protocol.handle('monky-miniapp', () => new Response(boot + gamesHtml(base, room), {
        headers: { 'Content-Type': 'text/html' },
      }));
      await window.loadURL(`monky-miniapp://${id}/index.html`);
    }
    const [host, guest, viewer] = windows;
    for (const window of windows) await waitFor(() => run(window, 'document.querySelector("#room-players")?.textContent.includes("bob")'), 'authenticated lobby');
    if (game === 'nes') {
      const selectRom = bytes => run(host, `(() => {
        const bytes=Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}),value=>value.charCodeAt(0));
        const transfer=new DataTransfer();transfer.items.add(new File([bytes],'homebrew-fixture.nes'));
        const input=document.querySelector('#rom');input.files=transfer.files;input.dispatchEvent(new Event('change'));
      })()`);
      for (const window of [guest, viewer]) {
        assert.equal(await run(window, 'document.querySelector("#rom-label").hidden && document.querySelector("#rom").disabled'), true, 'Only the host sees a usable ROM chooser');
        assert.equal(await run(window, '!document.querySelector("#join").hidden && !document.querySelector("#join").disabled'), true, 'Player 2 choice is available before a ROM exists');
        assert.match(await run(window, 'document.querySelector("#status").textContent'), /Waiting for the host/);
        assert.match(await run(window, 'document.querySelector("#help").textContent'), /X: A button.*Z: B button/);
      }
      await run(guest, 'document.querySelector("#join").click()');
      await waitFor(() => [...room.peers].some(peer => peer.slot === 1), 'claim player 2 while waiting for the host');
      await selectRom(Buffer.from('invalid NES data'));
      await waitFor(() => run(host, 'document.querySelector("#status").classList.contains("game-error")'), 'invalid local ROM is reported');
      assert.equal(room.rom, undefined, 'Invalid files are not uploaded');
      await selectRom(nesFixture());
      // Counts frames and loads of the viewer's live emulator; throwaway emulators (save checks) are ignored.
      const instrument = window => run(window, `(() => {
          const Original=window.jsnes.NES;
          window.ReferenceNes=Original;
          window.jsnes={...window.jsnes,NES:class extends Original {
            constructor(...args){super(...args);if(!args[0]?.onFrame)return;window.testNes=this;window.testFrames=0;
              const originalFrame=this.frame;this.frame=()=>{
                window.testFrames++;const result=originalFrame();
                if(window.testFrames===window.testRestoreAt)window.restoredState=JSON.stringify(this.cpu.toJSON());
                return result;};}
            fromJSON(state){super.fromJSON(state);if(this===window.testNes){
              window.testLoads=(window.testLoads||0)+1;window.testLoaded=JSON.stringify(this.cpu.toJSON());}}
          }};
        })()`);
      for (const window of windows) {
        await waitFor(() => run(window, 'document.querySelector("#ready").textContent === "Ready"'), 'automatic host ROM synchronization');
        await instrument(window);
      }
      assert.equal(await run(guest, 'document.querySelector("#rom").files.length'), 0, 'Guest never selects a local file');
      assert.equal(await run(viewer, 'document.querySelector("#rom").files.length'), 0, 'Spectator never selects a local file');
      await waitFor(() => run(host, '!document.querySelector("#start").disabled'), 'NES ready players');
      await shot(host, 'lobby-host');
      await shot(guest, 'lobby-guest');
      await run(host, 'document.querySelector("#start").click()');
      for (const window of windows) await waitFor(() => run(window, 'window.testFrames > 20'), 'players and waiting spectator start automatically');
      assert.equal(await run(host, `(() => {
        const r=document.querySelector('#canvas').getBoundingClientRect();
        return r.x===0 && r.y===0 && r.width===innerWidth && r.height===innerHeight;
      })()`), true, 'NES also fills the miniapp during play');
      await shot(host, 'playing');
      await run(guest, 'window.dispatchEvent(new KeyboardEvent("keydown",{code:"KeyX",bubbles:true}))');
      for (const window of [host, guest]) {
        await waitFor(() => run(window, 'testNes.cpu.mem[0x21] === 1 && testNes.cpu.mem[0x20] === 0'), 'independent player 2 input');
      }
      await waitFor(() => run(viewer, 'window.testFrames > 10 && testNes.cpu.mem[0x21] === 1'), 'late NES replay and live frames');
      await run(guest, 'window.dispatchEvent(new KeyboardEvent("keyup",{code:"KeyX",bubbles:true}))');
      for (const window of windows) await waitFor(() => run(window, 'testNes.cpu.mem[0x21] === 0'), 'synchronized input release');
      await run(host, 'window.dispatchEvent(new KeyboardEvent("keydown",{code:"KeyX",bubbles:true}))');
      for (const window of windows) await waitFor(() => run(window, 'testNes.cpu.mem[0x20] === 1 && testNes.cpu.mem[0x21] === 0'), 'independent player 1 input');
      await run(guest, 'window.dispatchEvent(new KeyboardEvent("keydown",{code:"Escape",bubbles:true}))');
      assert.equal(await run(guest, '!document.querySelector("#game-menu").hidden && document.querySelector("#host-actions").hidden'), true, 'Guest can see instructions but not host administration');
      await shot(guest, 'menu-guest');
      assert.match(await run(guest, 'document.querySelector("#game-help").textContent'), /Enter: Start.*Shift: Select/);
      const originalRound = room.round;
      await run(guest, 'document.querySelector("#restart").click(); document.querySelector("#confirm-yes").click(); window.dispatchEvent(new KeyboardEvent("keydown",{code:"KeyX",bubbles:true}))');
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(room.round, originalRound, 'Hidden administrative buttons are also guarded');
      assert.equal(await run(host, 'testNes.cpu.mem[0x21]'), 0, 'Menu keys do not control the game');
      await run(guest, 'window.monkyScreen.viewer.locale="pt-BR"; document.querySelector("#menu-toggle").click(); document.querySelector("#menu-toggle").click()');
      assert.equal(await run(guest, 'document.querySelector("#game-menu-title").textContent'), 'Controles do NES');
      assert.match(await run(guest, 'document.querySelector("#game-help").textContent'), /X: botão A/);
      await run(guest, 'window.monkyScreen.viewer.locale="en"; document.querySelector("#menu-toggle").click()');
      for (const window of windows) await run(window, 'window.previousNes=window.testNes; undefined');
      await run(host, 'document.querySelector("#menu-toggle").click(); document.querySelector("#restart").click(); document.querySelector("#confirm-no").click()');
      assert.equal(room.round, originalRound, 'Cancel preserves the running game');
      await run(host, 'document.querySelector("#restart").click(); document.querySelector("#confirm-yes").click()');
      await waitFor(() => room.round === originalRound + 1, 'host restart');
      for (const window of windows) {
        await waitFor(() => run(window, 'testNes !== previousNes && testFrames > 20 && testNes.cpu.mem[0x20] === 0 && testNes.cpu.mem[0x21] === 0'), 'restart reloads every emulator and releases controls');
      }
      await run(host, 'document.querySelector("#menu-toggle").click(); document.querySelector("#return-lobby").click(); document.querySelector("#confirm-yes").click()');
      for (const window of windows) await waitFor(() => run(window, '!document.querySelector("#game-root").classList.contains("playing")'), 'all viewers return to lobby');
      const idleFrames = await run(host, 'testFrames');
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.equal(await run(host, 'testFrames'), idleFrames, 'Returning to lobby stops emulation');
      const progress = room.frames.map(frame => [...frame]);
      assert.ok(progress.length > 20, 'Lobby retained committed progress');
      await waitFor(() => run(host, '!document.querySelector("#resume").hidden && !document.querySelector("#resume").disabled'), 'resume offered to the host');
      assert.equal(await run(guest, 'document.querySelector("#resume").hidden'), true, 'Only the host resumes');
      await run(host, 'document.querySelector("#start").click()');
      assert.equal(await run(host, '!document.querySelector("#confirm-action").hidden'), true, 'Starting over requires confirmation when progress exists');
      await run(host, 'document.querySelector("#confirm-no").click()');
      assert.equal(room.started, false);
      for (const window of windows) {
        await run(window, `(() => {
          window.testRestoreAt=${progress.length};window.restoredState=null;
          const reference=new window.ReferenceNes({sampleRate:48000});
          reference.loadROM(Uint8Array.from(atob(${JSON.stringify(nesFixture().toString('base64'))}),char=>char.charCodeAt(0)));
          for(const masks of ${JSON.stringify(progress)}){
            masks.forEach((mask,player)=>{for(let button=0;button<8;button++){
              if(mask&(1<<button))reference.buttonDown(player+1,button);else reference.buttonUp(player+1,button);
            }});reference.frame();
          }
          window.expectedRestoreState=JSON.stringify(reference.cpu.toJSON());
        })()`);
      }
      await selectRom(Buffer.from('invalid replacement'));
      await waitFor(() => run(host, 'document.querySelector("#status").classList.contains("game-error") && !document.querySelector("#resume").disabled'), 'invalid replacement does not lose the previous ROM or progress');
      await run(host, 'document.querySelector("#resume").click()');
      for (const window of windows) await waitFor(() => run(window, 'restoredState === expectedRestoreState && testFrames > testRestoreAt'), 'resume restores exact committed CPU state and continues for everyone');
      await run(host, 'document.querySelector("#menu-toggle").click(); document.querySelector("#return-lobby").click(); document.querySelector("#confirm-yes").click()');
      await waitFor(() => run(host, '!document.querySelector("#resume").hidden'), 'second lobby retains the resumed progress');
      const replacement = nesFixture();
      replacement[replacement.length - 1] = 1;
      await selectRom(replacement);
      await waitFor(() => room.rom?.equals(replacement) && [...room.peers].every(peer => peer.ready && peer.hash === room.romHash), 'new ROM reaches every participant without guest selection');
      await waitFor(() => run(host, '!document.querySelector("#start").disabled'), 'replacement ready');
      assert.equal(await run(host, 'document.querySelector("#resume").hidden'), true, 'Changing the ROM removes obsolete resume');
      await run(host, 'document.querySelector("#start").click()');
      for (const window of windows) await waitFor(() => run(window, 'testFrames > 20'), 'replacement game starts');

      // Save states: both players save, only the host loads, and every viewer restores the same console.
      const saveState = save => JSON.parse(zlib.gunzipSync(save.data).toString('utf8')).state;
      const press = (window, code, type) => run(window, `window.dispatchEvent(new KeyboardEvent("${type}",{code:"${code}",bubbles:true}))`);
      const counters = window => run(window, '[testNes.cpu.mem[0x22],testNes.cpu.mem[0x23]]');
      const settled = async label => {
        let values;
        await waitFor(async () => {
          values = await Promise.all(windows.map(counters));
          return values.every(value => JSON.stringify(value) === JSON.stringify(values[0]));
        }, label);
        return values[0];
      };
      const savesMenu = (window, open) => run(window, `(() => {
        if (document.querySelector("#saves-modal").hidden === ${open}) document.querySelector("#saves-toggle").click();
      })()`);
      const card = id => `#menu-saves [data-slot="${id}"]`;
      const slotButton = (window, id, action) => run(window, `document.querySelector('${card(id)} [data-action="${action}"]').click()`);
      // The screenshot inside a save must be the host screen at that moment (the fixture draws a solid color).
      const screenshotMatches = (window, image) => run(window, `(async () => {
        const image=document.querySelector(${JSON.stringify(image)});
        if (image.hidden || !image.src.startsWith('data:image/png;base64,')) return false;
        await image.decode();
        const copy=document.createElement('canvas');copy.width=256;copy.height=240;
        const context=copy.getContext('2d');context.drawImage(image,0,0);
        const pixel=canvas=>[...canvas.getContext('2d').getImageData(8,8,1,1).data].join();
        return image.naturalWidth===256 && image.naturalHeight===240 && pixel(copy)===pixel(document.querySelector('#canvas')) &&
          pixel(copy)!=='0,0,0,255';
      })()`);
      // The fixture palette has black entries; saving on a visible color keeps the screenshot check meaningful.
      const black = window => run(window, '[...document.querySelector("#canvas").getContext("2d").getImageData(8,8,1,1).data].join() === "0,0,0,255"');
      await press(host, 'KeyX', 'keydown');
      await waitFor(async () => (await counters(host))[0] >= 30, 'player 1 counter advances');
      await press(host, 'KeyX', 'keyup');
      await press(guest, 'KeyX', 'keydown');
      await waitFor(async () => (await counters(guest))[1] >= 10, 'player 2 counter advances');
      await press(guest, 'KeyX', 'keyup');
      let savedCounters = await settled('counters settle before saving');
      while (await black(host)) {
        await press(guest, 'KeyX', 'keydown');
        await waitFor(async () => (await counters(guest))[1] > savedCounters[1], 'player 2 counter moves off black');
        await press(guest, 'KeyX', 'keyup');
        savedCounters = await settled('counters settle before saving');
      }
      await press(host, 'Escape', 'keydown');
      await run(host, 'document.querySelector("#menu-saves-open").click()');
      assert.equal(await run(host, '!document.querySelector("#saves-modal").hidden && document.querySelector("#game-menu").hidden'), true,
        'The controls menu leads to the dedicated saves menu');
      assert.equal(await run(host, 'document.querySelectorAll("#menu-saves .save-card").length'), 4, 'Automatic plus three numbered slots');
      await slotButton(host, 1, 'save');
      const own = (user, id) => room.saves.get(user)?.get(id);
      await waitFor(() => own('alice', 1)?.nickname === 'alice', 'host saves slot 1');
      assert.match(own('alice', 1).thumbnail, /^data:image\/png;base64,/, 'The save carries a screenshot');
      await waitFor(() => run(host, `document.querySelector('${card(1)} .save-meta').textContent !== "Empty"`), 'slot 1 listed');
      await waitFor(() => screenshotMatches(host, `${card(1)} .save-thumb img`), 'the host sees the saved moment');
      await waitFor(() => run(host, 'document.querySelector("#toast").textContent === "Saved to Slot 1 for this session."'), 'without storage the save lasts the session');
      await shot(host, 'saves-host');
      await savesMenu(guest, true);
      assert.equal(await run(guest, `document.querySelector('${card(1)} .save-meta').textContent`), 'Empty', 'Player 2 does not see the host slots');
      assert.equal(await run(guest, `[...document.querySelectorAll('#menu-saves [data-action="load"]')].every(button => button.hidden) &&
        document.querySelector('#menu-saves .file-field').hidden`), true, 'Player 2 saves and downloads but cannot load');
      assert.equal(await run(viewer, 'document.querySelector("#saves-toggle").hidden && document.querySelector("#saves-modal").hidden'), true, 'Spectators have no saves');
      await slotButton(guest, 1, 'save');
      await waitFor(() => own('bob', 1)?.nickname === 'bob', 'player 2 saves their own slot 1 from their own emulator');
      assert.equal(own('alice', 1).nickname, 'alice', 'The host slot 1 is untouched');
      await shot(guest, 'saves-guest');
      const slotOne = saveState(own('alice', 1));
      assert.deepEqual([slotOne.cpu.mem[0x22], slotOne.cpu.mem[0x23]], savedCounters, 'Slot 1 holds both players’ progress');
      assert.deepEqual([saveState(own('bob', 1)).cpu.mem[0x22], saveState(own('bob', 1)).cpu.mem[0x23]], savedCounters,
        'Player 2 saved the same synchronized console');
      await press(guest, 'Escape', 'keydown');
      assert.equal(await run(guest, 'document.querySelector("#saves-modal").hidden && document.querySelector("#game-menu").hidden'), true, 'Esc closes the saves menu first');
      await savesMenu(host, false);
      await press(host, 'KeyX', 'keydown');
      await waitFor(async () => (await counters(host))[0] >= savedCounters[0] + 20, 'progress after saving');
      await press(host, 'KeyX', 'keyup');
      await settled('counters settle after more progress');
      await run(guest, `document.querySelector('${card(1)} [data-action="load"]').click()`);
      assert.equal(room.base, undefined, 'Hidden load buttons stay guarded');
      for (const window of windows) await run(window, 'window.previousNes=testNes; undefined');
      await savesMenu(host, true);
      await slotButton(host, 1, 'load');
      assert.equal(await run(host, '!document.querySelector("#confirm-action").hidden && document.querySelector("#saves-modal").hidden'), true, 'Loading asks for confirmation');
      assert.equal(await run(host, 'document.querySelector("#confirm-thumb").src === document.querySelector(\'#menu-saves [data-slot="1"] .save-thumb img\').src'), true,
        'The confirmation shows the moment being loaded');
      await shot(host, 'confirm-load');
      await run(host, 'document.querySelector("#confirm-no").click()');
      assert.equal(room.base, undefined, 'Cancel keeps the current progress');
      assert.equal(await run(host, '!document.querySelector("#saves-modal").hidden && document.querySelector("#saves-modal").contains(document.activeElement)'), true, 'Cancel returns to the saves menu');
      await slotButton(host, 1, 'load');
      await run(host, 'document.querySelector("#confirm-yes").click()');
      const expectedCpu = JSON.stringify(slotOne.cpu);
      for (const window of windows) {
        await waitFor(() => run(window, `testNes !== previousNes && testLoaded === ${JSON.stringify(expectedCpu)}`), 'every viewer restores the exact slot');
      }
      assert.deepEqual(await settled('restored counters agree'), savedCounters, 'Both players returned to the saved progress');
      assert.equal(room.base, own('alice', 1));
      await waitFor(() => run(guest, 'document.querySelector("#toast").textContent.startsWith("Save loaded for everyone: Slot 1 (alice")'), 'load announced');

      for (const window of windows) await run(window, 'window.loadsBeforeCheckpoint=testLoads; undefined');
      // One short autosave interval for exactly one checkpoint, then the default two minutes again.
      await run(host, `(() => { const before=window.testNes;
        Object.defineProperty(window.monkyGame,'autosaveFrames',{configurable:true,get:()=>window.testNes===before?90:undefined}); })()`);
      await waitFor(() => own('alice', 0) && room.base === own('alice', 0), 'autosave becomes the checkpoint base');
      assert.equal(own('bob', 0), own('alice', 0), 'The checkpoint is also player 2’s Automático');
      await run(host, 'delete window.monkyGame.autosaveFrames; undefined');
      const checkpointCpu = JSON.stringify(saveState(own('alice', 0)).cpu);
      for (const window of windows) {
        await waitFor(() => run(window, `testLoads === loadsBeforeCheckpoint + 1 && testLoaded === ${JSON.stringify(checkpointCpu)}`), 'every viewer reloads at the checkpoint');
      }
      assert.ok(room.dropped > 0, 'The checkpoint folds committed frames into the base');
      await savesMenu(host, true);
      await waitFor(() => run(host, `document.querySelector('${card(0)} .save-name').textContent === "Automatic" &&
        !document.querySelector('${card(0)} .save-meta').textContent.includes("Every 2 min") &&
        !document.querySelector('${card(0)} .save-thumb img').hidden`), 'autosave listed with its screenshot');
      assert.match(own('alice', 0).thumbnail, /^data:image\/png;base64,/, 'Autosaves carry a screenshot too');

      const downloads = [];
      host.webContents.session.once('will-download', (event, item) => {
        item.setSavePath(path.join(temporary, 'slot-1.monkynes'));
        item.once('done', (doneEvent, state) => downloads.push({ state, name: item.getFilename() }));
      });
      await slotButton(host, 1, 'download');
      await waitFor(() => downloads.length === 1, 'save download');
      assert.equal(downloads[0].state, 'completed');
      assert.match(downloads[0].name, /^homebrew-fixture - slot 1 - .+\.monkynes$/);
      const file = fs.readFileSync(path.join(temporary, 'slot-1.monkynes'));
      assert.ok(file.equals(own('alice', 1).data), 'The download is the save kept by the bot');

      await run(host, 'document.querySelector("#return-lobby").click(); document.querySelector("#confirm-yes").click()');
      for (const window of windows) await waitFor(() => run(window, '!document.querySelector("#game-root").classList.contains("playing")'), 'lobby before importing');
      await waitFor(() => run(host, '!document.querySelector("#saves-lobby").hidden'), 'lobby saves for the host');
      await run(host, 'document.querySelector("#saves-lobby").click()');
      assert.equal(await run(host, '!document.querySelector("#saves-modal").hidden && !document.querySelector("#menu-saves .file-field").hidden'), true, 'The host imports from the saves menu');
      await shot(host, 'saves-lobby');
      await run(host, `(() => {
        const bytes=Uint8Array.from(atob(${JSON.stringify(file.toString('base64'))}),value=>value.charCodeAt(0));
        const transfer=new DataTransfer();transfer.items.add(new File([bytes],'slot-1.monkynes'));
        const input=document.querySelector('#menu-saves input[type=file]');input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
      })()`);
      await waitFor(() => run(host, '!document.querySelector("#confirm-action").hidden'), 'importing over preserved progress asks first');
      assert.equal(await run(host, '!document.querySelector("#confirm-thumb").hidden && document.querySelector("#confirm-thumb").src.startsWith("data:image/png;base64,")'), true,
        'The import confirmation previews the file’s screenshot');
      await shot(host, 'confirm-import');
      await run(host, 'document.querySelector("#confirm-yes").click()');
      await waitFor(async () => room.base?.slot === null &&
        await run(host, 'document.querySelector("#status").textContent.startsWith("Save ready to resume: save file")'), 'imported file is the resume point');
      for (const window of [host, guest]) {
        await waitFor(() => run(window, `!document.querySelector("#resume-card").hidden && document.querySelector("#saves-modal").hidden &&
          document.querySelector("#resume-card .save-name").textContent === "Save file"`), 'the lobby shows the resume point');
        assert.equal(await screenshotMatches(window, '#resume-card img'), true, 'The resume point shows the imported screenshot');
      }
      assert.equal(await run(viewer, 'document.querySelector("#resume-card").hidden'), true, 'Spectators only read the status');
      await shot(host, 'lobby-resume');
      for (const window of windows) await run(window, 'window.previousNes=testNes; undefined');
      await run(host, 'document.querySelector("#resume").click()');
      for (const window of windows) {
        await waitFor(() => run(window, `testNes !== previousNes && testLoaded === ${JSON.stringify(expectedCpu)} && testFrames > 10`), 'imported save restores every viewer');
      }
      assert.deepEqual(await settled('imported counters agree'), savedCounters);
      await press(guest, 'KeyX', 'keydown');
      await waitFor(async () => (await counters(guest))[1] > savedCounters[1], 'player 2 plays after import');
      await press(guest, 'KeyX', 'keyup');
      await settled('both controllers stay synchronized after import');
      await new Promise(resolve => { viewer.webContents.once('did-finish-load', resolve); viewer.reload(); });
      await waitFor(() => run(viewer, 'document.querySelector("#status")?.textContent === "Watching the game." && document.querySelector("#game-root").classList.contains("playing")'), 'late spectator receives ROM and replays automatically');
      assert.equal(await run(viewer, 'document.querySelector("#rom").files.length'), 0);
      assert.equal(await run(viewer, 'document.querySelector("#canvas").getContext("2d").getImageData(100,100,1,1).data[3]'), 255, 'Late spectator rendered the real emulator');
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const storedKeys = window => run(window, '[...testStorage.store.keys()].sort()');
      // Chunked base64 of a stored save, so large states do not overflow String.fromCharCode.
      const storedSave = (window, key) => run(window, `(() => {
        const bytes=new Uint8Array(testStorage.store.get(${JSON.stringify(key)}));let binary='';
        for(let i=0;i<bytes.length;i+=0x8000)binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(binary);
      })()`).then(value => Buffer.from(value, 'base64'));
      const prefix = `nes/${room.romHash}/`;

      // Storage allowed during the session: each player keeps their own saves of this view on their computer.
      for (const window of [host, guest]) await run(window, 'testStorage.setStatus("granted")');
      for (const [window, user] of [[host, 'alice'], [guest, 'bob']]) {
        await waitFor(async () => JSON.stringify(await storedKeys(window)) === JSON.stringify([prefix + 'auto', prefix + 'slot-1']),
          `${user} keeps their own saves once storage is allowed`);
        assert.ok((await storedSave(window, prefix + 'slot-1')).equals(own(user, 1).data), `${user} kept their own slot 1`);
      }
      await savesMenu(guest, true);
      assert.match(await run(guest, 'document.querySelector("#menu-saves .saves-notice").textContent'), /^Only you see your saves\. They are kept on this computer/);
      await slotButton(guest, 2, 'save');
      await waitFor(() => run(guest, 'document.querySelector("#toast").textContent === "Saved to Slot 2 on this computer."'), 'saves go to this computer');
      assert.deepEqual(await run(guest, 'testStorage.writes.at(-1)'), [prefix + 'slot-2', false], 'A requested save is not an autosave');
      assert.deepEqual(await storedKeys(host), [prefix + 'auto', prefix + 'slot-1'], 'Nothing reaches the other player’s computer');
      await savesMenu(guest, false);

      // The host emulator produces every frame: out of view, the game pauses for everyone.
      await run(host, 'testHooks.visibility.forEach(handler => handler(false))');
      await waitFor(() => room.paused, 'a hidden host pauses the room');
      await waitFor(() => run(guest, `!document.querySelector("#pause-notice").hidden &&
        document.querySelector("#pause-notice").textContent === "Paused: alice can’t see the game."`), 'player 2 learns why the game paused');
      await shot(guest, 'paused');
      const pausedAt = await run(host, 'testFrames');
      await sleep(250);
      assert.ok(await run(host, 'testFrames') <= pausedAt + 1, 'No frames while the host cannot see the game');
      await run(host, 'testHooks.visibility.forEach(handler => handler(true))');
      await waitFor(async () => !room.paused && await run(guest, 'document.querySelector("#pause-notice").hidden') &&
        await run(host, `testFrames > ${pausedAt + 10}`), 'the game resumes when the host looks again');

      // Player 2 leaves: the game freezes and both players are asked whether to save.
      await run(guest, 'window.closeResult=undefined; Promise.resolve(testHooks.beforeClose[0]({reason:"leave"})).then(value=>{window.closeResult=value ?? "close";}); undefined');
      for (const window of [host, guest]) await waitFor(() => run(window, '!document.querySelector("#save-question").hidden'), 'both players are asked whether to save');
      assert.equal(await run(host, 'document.querySelector("#save-question-context").textContent'), 'bob is leaving the NES; the game will stop.');
      assert.equal(await run(guest, 'document.querySelector("#save-question-title").textContent'), 'Save the game state?');
      await waitFor(() => run(viewer, `!document.querySelector("#pause-notice").hidden &&
        document.querySelector("#pause-notice").textContent === "Game stopped: bob is leaving."`), 'spectators see why the game stopped');
      await shot(guest, 'question');
      const frozenAt = await run(host, 'testFrames');
      await sleep(250);
      assert.ok(await run(host, 'testFrames') <= frozenAt + 1, 'The game is frozen while players answer');
      assert.equal(await run(guest, 'window.closeResult'), undefined, 'The view stays open until player 2 answers');
      await run(guest, 'document.querySelector("#save-question-yes").click()');
      assert.equal(await run(guest, `!document.querySelector("#save-question-slots").hidden &&
        [...document.querySelectorAll("#save-question-slots .save-name")].map(name => name.textContent).join() === "Slot 1,Slot 2,Slot 3"`), true,
      'Saving means choosing one of the player’s slots');
      await shot(guest, 'question-slots');
      await run(guest, `document.querySelector('#save-question-slots [data-slot="3"] button').click()`);
      await waitFor(() => run(guest, 'window.closeResult === "close"'), 'answering lets player 2 leave');
      assert.ok((await storedKeys(guest)).includes(prefix + 'slot-3'), 'Player 2 kept the closing state on their computer');
      await waitFor(() => own('bob', 3), 'and in the session');
      const closingState = saveState({ data: await storedSave(guest, prefix + 'slot-3') });
      assert.deepEqual([closingState.cpu.mem[0x22], closingState.cpu.mem[0x23]], await counters(host), 'The frozen moment was saved');
      const hostKeys = await storedKeys(host);
      await run(host, 'document.querySelector("#save-question-no").click()');
      await waitFor(() => run(host, 'document.querySelector("#save-question").hidden'), 'the host chose not to save');
      assert.deepEqual(await storedKeys(host), hostKeys, 'Not saving writes nothing');
      // Monky closes player 2's view: onClose disconnects at once and the game stops for the host.
      const ticks = await run(host, 'testFrames');
      await run(guest, 'Promise.all(testHooks.close.map(handler => handler({reason:"leave"})))');
      await waitFor(() => run(host, 'document.querySelector("#status").textContent.includes("player left")'), 'NES disconnect teardown');
      assert.equal(await run(host, 'document.querySelector("#save-question").hidden'), true, 'Players who already answered are not asked again');
      await sleep(100);
      assert.ok(await run(host, 'testFrames') <= ticks + 3, 'Emulation stopped with the departed player');

      // A new session: the host brings its saves back from this computer and chooses one to load.
      const kept = Object.fromEntries(await Promise.all(hostKeys.map(async key => [key, (await storedSave(host, key)).toString('base64')])));
      room = service.create('nes', 'alice');
      for (const window of [host, guest]) {
        await new Promise(resolve => { window.webContents.once('did-finish-load', resolve); window.reload(); });
        await waitFor(() => run(window, 'document.querySelector("#room-players")?.textContent.includes("alice")'), 'reopened session');
      }
      await waitFor(() => run(guest, 'document.querySelector("#room-players").textContent.includes("bob")'), 'player 2 in the new session');
      await run(host, `(() => { for (const [key, data] of Object.entries(${JSON.stringify(kept)}))
        testStorage.store.set(key, Uint8Array.from(atob(data), value => value.charCodeAt(0)).buffer); testStorage.setStatus("granted"); })()`);
      await run(guest, 'document.querySelector("#join").click()');
      await selectRom(replacement);
      for (const window of [host, guest]) {
        await waitFor(() => run(window, 'document.querySelector("#ready").textContent === "Ready"'), 'ROM in the new session');
        await instrument(window);
      }
      await waitFor(() => own('alice', 1) && own('alice', 0), 'kept saves come back to the host slots');
      assert.ok(own('alice', 1).data.equals(Buffer.from(kept[prefix + 'slot-1'], 'base64')));
      assert.equal(room.base, undefined, 'Nothing loads by itself');
      await waitFor(() => run(host, 'document.querySelector("#toast").textContent === "Your kept saves of this ROM are in Saves. Load one to resume."'), 'the host is told');
      assert.equal(room.saves.has('bob'), false, 'Player 2 kept nothing without permission');
      await waitFor(() => run(host, '!document.querySelector("#saves-lobby").hidden'), 'saves in the new lobby');
      await run(host, 'document.querySelector("#saves-lobby").click()');
      await waitFor(() => run(host, `!document.querySelector('${card(1)} [data-action="load"]').hidden`), 'kept slot listed');
      await slotButton(host, 1, 'load');
      await waitFor(() => room.base === own('alice', 1), 'the host loads a kept save');
      await waitFor(() => run(host, '!document.querySelector("#resume").hidden && !document.querySelector("#resume").disabled'), 'resume from the kept save');
      await run(host, 'document.querySelector("#resume").click()');
      for (const window of [host, guest]) {
        await waitFor(() => run(window, `window.testLoaded === ${JSON.stringify(expectedCpu)} && window.testFrames > 10`), 'the kept save restores both players');
      }

      // Ending for everyone waits until player 2 answers too; nobody really ending lets the game go on.
      await run(host, 'window.closeResult=undefined; Promise.resolve(testHooks.beforeClose[0]({reason:"end"})).then(value=>{window.closeResult=value ?? "close";}); undefined');
      await waitFor(() => run(guest, `!document.querySelector("#save-question").hidden &&
        document.querySelector("#save-question-context").textContent === "alice is ending the NES for everyone."`), 'player 2 is asked before the end');
      await run(host, 'document.querySelector("#save-question-no").click()');
      await waitFor(() => run(host, 'document.querySelector("#save-question-context").textContent === "Waiting for bob to decide whether to save."'), 'the host waits for player 2');
      await shot(host, 'question-waiting');
      assert.equal(await run(host, 'window.closeResult'), undefined, 'The end waits for every player');
      await run(guest, 'document.querySelector("#save-question-no").click()');
      await waitFor(() => run(host, 'window.closeResult === "close"'), 'the end proceeds once player 2 answered');
      const resumedAt = await run(host, 'testFrames');
      await waitFor(() => run(host, `testFrames > ${resumedAt + 10} && document.querySelector("#save-question").hidden`), 'the frozen game resumes when the end does not happen');

      // Player 2 drops without asking: the host is asked; without storage the chosen save is downloaded.
      await run(host, 'testStorage.setStatus("denied")');
      guest.destroy();
      await waitFor(() => run(host, `!document.querySelector("#save-question").hidden &&
        document.querySelector("#save-question-context").textContent === "bob left the NES, and the game stopped."`), 'the remaining player is asked');
      assert.match(await run(host, 'document.querySelector("#save-question-note").textContent'), /downloaded as a file/);
      const closingDownload = new Promise(resolve => host.webContents.session.once('will-download', (event, item) => {
        item.setSavePath(path.join(temporary, 'closing.monkynes'));
        item.once('done', (doneEvent, state) => resolve({ state, name: item.getFilename() }));
      }));
      await run(host, 'document.querySelector("#save-question-yes").click()');
      await run(host, `document.querySelector('#save-question-slots [data-slot="2"] button').click()`);
      const downloaded = await closingDownload;
      assert.equal(downloaded.state, 'completed');
      assert.match(downloaded.name, /^homebrew-fixture - slot 2 - .+\.monkynes$/);
      const envelope = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(temporary, 'closing.monkynes'))).toString('utf8'));
      assert.equal(envelope.romHash, room.romHash, 'The downloaded closing save belongs to this ROM');
      await waitFor(() => run(host, 'document.querySelector("#save-question").hidden'), 'the question closes after saving');
      console.log('NES: host-only ROM, controls, restart/lobby, exact-state resume for all viewers, invalid replacement recovery, ROM replacement, per-player save slots with screenshots, host-only load, autosave checkpoint, save download/import, late spectator, saves kept on each computer and restored, host pause, save question on leave/end/drop with download fallback and teardown passed.');
      await finish(0);
      return;
    }
    await run(guest, 'document.querySelector("#join").click()');
    for (const window of [host, guest]) {
      await waitFor(() => run(window, 'document.querySelector("#ready").textContent === "Ready"'), 'real WAD preparation');
      await run(window, `window.originalDoom=window.createMonkyDoom;
        window.createMonkyDoom=async options=>{
          const engine=await window.originalDoom(options);window.testEngine=engine;
          window.testMouse=[];window.testKeys=[];
          const motion=engine._inject_mouse_motion, key=engine._inject_key_event;
          engine._inject_mouse_motion=(...args)=>{testMouse.push(args);return motion(...args);};
          engine._inject_key_event=(...args)=>{testKeys.push(args);return key(...args);};
          return engine;
        };undefined;`);
    }
    await waitFor(() => run(host, '!document.querySelector("#start").disabled'), 'two ready players');
    await shot(host, 'lobby-host');
    await run(host, 'document.querySelector("#start").click()');
    for (const window of [host, guest]) {
      await waitFor(() => run(window, 'window.testEngine?._monky_players() === 2 && window.testEngine._monky_tics() > 80'), 'two real Doom avatars', 40000);
    }
    assert.equal(await run(host, 'testEngine._monky_player()'), 0);
    assert.equal(await run(guest, 'testEngine._monky_player()'), 1);
    await waitFor(() => run(host, 'testAudioEnergy > 1'), 'audible engine audio with music enabled');
    const before = await run(guest, '[testEngine._monky_x(),testEngine._monky_y()]');
    await run(guest, 'window.dispatchEvent(new KeyboardEvent("keydown",{code:"KeyW",bubbles:true}))');
    await new Promise(resolve => setTimeout(resolve, 700));
    await run(guest, 'window.dispatchEvent(new KeyboardEvent("keyup",{code:"KeyW",bubbles:true}))');
    const after = await run(guest, '[testEngine._monky_x(),testEngine._monky_y()]');
    assert.notDeepEqual(after, before, 'Guest controls their own avatar');
    const image = await host.webContents.capturePage();
    assert.ok(image.toPNG().length > 10000, 'Real engine rendered a nonempty scene');
    await run(host, 'window.dispatchEvent(new MouseEvent("mousemove",{movementX:100,bubbles:true}))');
    assert.deepEqual(await run(host, 'testMouse'), [], 'Mouse outside the game cannot turn the player');
    host.show();
    host.focus();
    host.webContents.focus();
    await waitFor(() => run(host, 'document.hasFocus()'), 'visible pointer-lock test window');
    const capture = 'document.querySelector("#canvas").dispatchEvent(new MouseEvent("mousedown",{button:0,bubbles:true}))';
    await run(host, capture);
    await waitFor(() => run(host, 'document.pointerLockElement?.id === "canvas"'), 'real browser pointer lock');
    await run(host, `window.dispatchEvent(new MouseEvent("mousemove",{movementX:75,movementY:120,bubbles:true}));
      document.querySelector("#canvas").dispatchEvent(new MouseEvent("mousedown",{button:0,bubbles:true}));
      window.dispatchEvent(new KeyboardEvent("keydown",{code:"Space",bubbles:true}));
      window.dispatchEvent(new MouseEvent("mouseup",{button:0,bubbles:true}));`);
    assert.deepEqual(await run(host, 'testMouse.at(-1)'), [75, 0], 'Relative mouse turns once without moving the avatar forward');
    assert.deepEqual(await run(host, 'testKeys.filter(([type,code])=>code===32)'), [[0, 32]], 'Releasing mouse fire preserves held keyboard fire');
    host.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    host.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await waitFor(() => run(host, '!document.pointerLockElement'), 'Escape releases pointer lock');
    assert.deepEqual(await run(host, 'testKeys.filter(([type,code])=>code===32)'), [[0, 32], [1, 32]], 'Unlock releases held fire');
    assert.equal(await run(host, `(() => {
      const rect=document.querySelector('#canvas').getBoundingClientRect();
      return rect.x===0 && rect.y===0 && Math.abs(rect.width-innerWidth)<2 && Math.abs(rect.height-innerHeight)<2;
    })()`), true, 'Playing canvas fills the entire miniapp, not a fixed-width lobby');
    await run(host, 'document.querySelector("#game-root").requestFullscreen()');
    await waitFor(() => run(host, 'document.fullscreenElement?.id === "game-root"'), 'real game fullscreen');
    assert.equal(await run(host, 'Math.abs(document.querySelector("#game-root").getBoundingClientRect().height-innerHeight)<2'), true, 'Fullscreen game fills the viewport');
    await new Promise(resolve => setTimeout(resolve, 1200));
    await run(host, capture);
    await waitFor(() => run(host, 'document.pointerLockElement?.id === "canvas"'), 'recapture in fullscreen');
    await run(host, 'window.dispatchEvent(new KeyboardEvent("keydown",{code:"KeyW",bubbles:true})); document.exitFullscreen()');
    await waitFor(() => run(host, '!document.fullscreenElement && !document.pointerLockElement'), 'fullscreen exit releases mouse');
    assert.deepEqual(await run(host, 'testKeys.filter(([type,code])=>code===119).slice(-2)'), [[0, 119], [1, 119]], 'Fullscreen exit releases movement');
    await run(host, capture);
    await waitFor(() => run(host, 'document.pointerLockElement?.id === "canvas"'), 'recapture after fullscreen exit');
    host.hide();
    await waitFor(() => run(host, '!document.pointerLockElement'), 'window blur releases pointer lock');
    await run(viewer, 'document.querySelector("#ready").click()');
    await waitFor(() => run(viewer, 'document.querySelector("#ready").textContent === "Ready"'), 'spectator assets');
    await run(viewer, `window.originalDoom=window.createMonkyDoom;
      window.createMonkyDoom=async options=>{const engine=await window.originalDoom(options);window.testEngine=engine;return engine;};undefined;`);
    await run(viewer, 'document.querySelector("#watch").click()');
    await waitFor(() => run(viewer, 'document.querySelector("#status").textContent === "Watching the game."'), 'spectator joining', 40000);
    await waitFor(() => run(viewer, 'window.testEngine?._monky_players() === 2 && window.testEngine._monky_tics() > 80'), 'real spectator engine', 40000);
    const viewerTics = await run(viewer, 'testEngine._monky_tics()');
    await waitFor(() => run(viewer, `testEngine._monky_tics() > ${viewerTics + 5}`), 'spectator actively advances beyond its initial snapshot');
    assert.equal(room.peers.size, 3);
    for (const window of windows) await run(window, 'window.previousEngine=window.testEngine; window.previousAudio=testEngine.SDL2.audioContext; undefined');
    await run(guest, 'window.dispatchEvent(new KeyboardEvent("keydown",{code:"F2",bubbles:true}))');
    assert.equal(await run(guest, '!document.querySelector("#game-menu").hidden && document.querySelector("#host-actions").hidden'), true, 'DOOM guest sees controls but not administration');
    await shot(guest, 'menu-guest');
    assert.match(await run(guest, 'document.querySelector("#game-help").textContent'), /WASD.*Mouse/);
    const oldRound = room.round;
    await run(guest, 'document.querySelector("#restart").click(); document.querySelector("#confirm-yes").click()');
    assert.equal(room.round, oldRound);
    host.show();
    host.focus();
    host.webContents.focus();
    await run(host, capture);
    await waitFor(() => run(host, 'document.pointerLockElement?.id === "canvas"'), 'capture before host menu');
    await run(host, 'window.dispatchEvent(new KeyboardEvent("keydown",{code:"F2",bubbles:true}))');
    await waitFor(() => run(host, '!document.pointerLockElement && !document.querySelector("#game-menu").hidden'), 'DOOM host menu releases the mouse');
    await run(host, 'document.querySelector("#restart").click(); document.querySelector("#confirm-no").click()');
    assert.equal(room.round, oldRound);
    await run(host, 'document.querySelector("#restart").click(); document.querySelector("#confirm-yes").click()');
    for (const window of windows) await waitFor(() => run(window,
      'testEngine !== previousEngine && testEngine._monky_players() === 2 && testEngine._monky_tics() > 50'), 'DOOM restart creates a fresh synchronized engine including spectator', 40000);
    for (const window of windows) assert.equal(await run(window, 'previousAudio.state'), 'closed', 'Restart closes the retired native audio context');
    for (const window of windows) await run(window, 'window.previousEngine=testEngine; window.previousTics=testEngine._monky_tics(); undefined');
    await run(host, 'document.querySelector("#menu-toggle").click(); document.querySelector("#return-lobby").click(); document.querySelector("#confirm-yes").click()');
    for (const window of windows) await waitFor(() => run(window, '!document.querySelector("#game-root").classList.contains("playing") && !document.pointerLockElement'), 'DOOM returns everyone to lobby and frees mouse');
    assert.equal(await run(host, 'document.querySelector("#resume").hidden'), true, 'DOOM lobby clearly starts a new match, not NES resume');
    const stoppedTics = await run(host, 'previousEngine._monky_tics()');
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(await run(host, 'previousEngine._monky_tics()'), stoppedTics, 'Retired DOOM runtime stopped ticking');
    await run(host, 'document.querySelector("#start").click()');
    for (const window of windows) await waitFor(() => run(window,
      'testEngine !== previousEngine && testEngine._monky_players() === 2 && testEngine._monky_tics() > 50'), 'DOOM starts again from lobby without reopening the miniapp', 40000);
    await run(host, 'window.previousEngine=testEngine; document.querySelector("#menu-toggle").click(); document.querySelector("#restart").click(); document.querySelector("#confirm-yes").click()');
    await waitFor(() => run(host, 'testEngine !== previousEngine && document.querySelector("#game-root").classList.contains("playing")'), 'new DOOM runtime is still starting');
    await run(host, 'document.querySelector("#menu-toggle").click(); document.querySelector("#return-lobby").click(); document.querySelector("#confirm-yes").click()');
    for (const window of windows) await waitFor(() => run(window, '!document.querySelector("#game-root").classList.contains("playing")'), 'returning during native startup cancels every runtime');
    await run(host, 'document.querySelector("#start").click()');
    for (const window of windows) await waitFor(() => run(window,
      'document.querySelector("#game-root").classList.contains("playing") && testEngine._monky_players() === 2 && testEngine._monky_tics() > 50 && !document.querySelector("#status").classList.contains("game-error")'),
    'rapid lobby/restart does not revive retired runtimes', 40000);
    await run(guest, 'window.close()');
    guest.destroy();
    await waitFor(() => run(host, 'document.querySelector("#status").textContent.includes("player left")'), 'disconnect teardown');
    console.log('DOOM: avatars, mouse/audio, fullscreen, shared host menu, restart with spectator, lobby and fresh match without reopening passed.');
    await finish(0);
  }).catch(async error => {
    console.error(error);
    console.error(errors.slice(-60).join('\n'));
    for (const window of windows) if (!window.isDestroyed()) {
      console.error(await run(window, 'document.body.innerText').catch(failure => failure.message));
      if (process.env.MONKY_GAMES_TEST_GAME === 'doom') console.error(await run(window,
        '({tics:window.testEngine?._monky_tics(),players:window.testEngine?._monky_players(),player:window.testEngine?._monky_player(),fresh:window.testEngine!==window.previousEngine,queue:window._webxdcRecvQueue?.length})'));
    }
    await finish(1);
  });
}
