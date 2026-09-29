const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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
  const service = new GamesService({ host: '127.0.0.1', port: 0, publicUrl: 'http://127.0.0.1' });
  const windows = [], errors = [], identities = new Map();
  let timeout;
  const waitFor = async (check, label, duration = 20000) => {
    const end = Date.now() + duration;
    while (Date.now() < end) {
      if (await check()) return;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`Timed out: ${label}\n${errors.join('\n')}`);
  };
  const run = (window, code) => window.webContents.executeJavaScript(code, true);
  const finish = async code => {
    clearTimeout(timeout);
    for (const window of windows) if (!window.isDestroyed()) window.destroy();
    await service.close();
    app.exit(code);
  };
  app.whenReady().then(async () => {
    timeout = setTimeout(() => { console.error('Games smoke timeout\n' + errors.join('\n')); void finish(1); }, 100000);
    const base = await service.start();
    const game = process.env.MONKY_GAMES_TEST_GAME;
    assert.ok(['doom', 'nes'].includes(game));
    const room = service.create(game, 'alice');
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
        window.monkyScreen={
        viewer:{id:${JSON.stringify(id)},nickname:${JSON.stringify(id)},locale:'en'},
        onState: callback=>{callback({},0);return ()=>{}},
        sendAction:(action,payload)=>{window.gameTest.authorize(payload.key);return true}
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
      for (const window of windows) {
        await waitFor(() => run(window, 'document.querySelector("#ready").textContent === "Ready"'), 'automatic host ROM synchronization');
        await run(window, `(() => {
          const Original=window.jsnes.NES;
          window.ReferenceNes=Original;
          window.jsnes={...window.jsnes,NES:class extends Original {
            constructor(...args){super(...args);window.testNes=this;window.testFrames=0;
              const originalFrame=this.frame;this.frame=()=>{
                window.testFrames++;const result=originalFrame();
                if(window.testFrames===window.testRestoreAt)window.restoredState=JSON.stringify(this.cpu.toJSON());
                return result;};}
          }};
        })()`);
      }
      assert.equal(await run(guest, 'document.querySelector("#rom").files.length'), 0, 'Guest never selects a local file');
      assert.equal(await run(viewer, 'document.querySelector("#rom").files.length'), 0, 'Spectator never selects a local file');
      await waitFor(() => run(host, '!document.querySelector("#start").disabled'), 'NES ready players');
      await run(host, 'document.querySelector("#start").click()');
      for (const window of windows) await waitFor(() => run(window, 'window.testFrames > 20'), 'players and waiting spectator start automatically');
      assert.equal(await run(host, `(() => {
        const r=document.querySelector('#canvas').getBoundingClientRect();
        return r.x===0 && r.y===0 && r.width===innerWidth && r.height===innerHeight;
      })()`), true, 'NES also fills the miniapp during play');
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
      await new Promise(resolve => { viewer.webContents.once('did-finish-load', resolve); viewer.reload(); });
      await waitFor(() => run(viewer, 'document.querySelector("#status")?.textContent === "Watching the game." && document.querySelector("#game-root").classList.contains("playing")'), 'late spectator receives ROM and replays automatically');
      assert.equal(await run(viewer, 'document.querySelector("#rom").files.length'), 0);
      assert.equal(await run(viewer, 'document.querySelector("#canvas").getContext("2d").getImageData(100,100,1,1).data[3]'), 255, 'Late spectator rendered the real emulator');
      const ticks = await run(host, 'testFrames');
      guest.destroy();
      await waitFor(() => run(host, 'document.querySelector("#status").textContent.includes("player left")'), 'NES disconnect teardown');
      await new Promise(resolve => setTimeout(resolve, 100));
      assert.ok(await run(host, 'testFrames') <= ticks + 3, 'Emulation stopped with the departed player');
      console.log('NES: host-only ROM, controls, restart/lobby, exact-state resume for all viewers, invalid replacement recovery, ROM replacement, late spectator and teardown passed.');
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
      console.error(await run(window, 'document.body.innerText'));
      if (process.env.MONKY_GAMES_TEST_GAME === 'doom') console.error(await run(window,
        '({tics:window.testEngine?._monky_tics(),players:window.testEngine?._monky_players(),player:window.testEngine?._monky_player(),fresh:window.testEngine!==window.previousEngine,queue:window._webxdcRecvQueue?.length})'));
    }
    await finish(1);
  });
}
