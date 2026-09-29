/* DOOM/Freedoom and a host-controlled NES emulator. No commercial ROM is bundled. */
(() => {
  'use strict';
  const api = window.monkyScreen;
  const config = window.monkyGame;
  const root = document.getElementById('game-root');
  const abort = new AbortController();
  const text = (pt, en) => api.viewer.locale === 'en' ? en : pt;
  const style = document.createElement('style');
  style.textContent = `
    :root{color-scheme:dark;font:15px system-ui;background:#171720;color:#f0eff9}
    body{margin:0;padding:16px}main{max-width:1000px;margin:auto}h1{font-size:1.3rem}
    button,input{font:inherit}button{background:#37304e;color:inherit;border:1px solid #82709f;border-radius:8px;padding:10px 16px;cursor:pointer}
    button:disabled{opacity:.5;cursor:default}button:focus-visible,canvas:focus-visible,input:focus-visible{outline:3px solid #c2a5ff;outline-offset:3px}
    #controls{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
    #status{min-height:24px;white-space:pre-wrap;overflow-wrap:anywhere}
    canvas{display:block;width:100%;max-height:65vh;object-fit:contain;background:#050509;image-rendering:pixelated}
    main.playing{position:fixed;inset:0;width:100%;height:100%;max-width:none;margin:0;background:#050509;overflow:hidden}
    main.playing canvas{width:100%;height:100%;max-height:none}
    main.playing> :not(canvas):not(#mouse-hint):not(.game-error):not(#game-toolbar):not(#game-menu):not(#confirm-action){display:none}
    main.playing #mouse-hint,main.playing .game-error{position:absolute;left:50%;transform:translateX(-50%);max-width:90%;padding:6px 12px;background:#171720dd;border-radius:8px;pointer-events:none}
    main.playing #mouse-hint{bottom:8px;font-size:.8rem}main.playing .game-error{top:8px}
    #room-players{overflow-wrap:anywhere}#rom-label{display:block;margin:12px 0}#help,#legal{font-size:.85rem;color:#bab4cd}
    #help,#game-help{white-space:pre-line}#game-toolbar{position:absolute;top:8px;right:8px;display:flex;gap:8px}
    #game-menu,main.playing #confirm-action{position:absolute;top:58px;right:8px;max-width:min(440px,calc(100% - 48px));max-height:calc(100% - 90px);overflow:auto;padding:16px;background:#171720f5;border:1px solid #82709f;border-radius:8px}
    #game-menu h2{margin-top:0;font-size:1.1rem}#host-actions{display:flex;gap:8px;flex-wrap:wrap}
    #confirm-action{margin-top:12px;border-top:1px solid #82709f}#confirm-action button{margin-right:8px}
    a{color:#c2a5ff}[hidden]{display:none!important}`;
  document.head.append(style);
  root.innerHTML = `<h1></h1><p id="room-players"></p><p id="status" role="status" aria-live="polite"></p>
    <label id="rom-label"><span></span> <input id="rom" type="file" accept=".nes"></label>
    <div id="controls"><button id="join" type="button"></button><button id="ready" type="button"></button>
    <button id="resume" type="button"></button><button id="start" type="button"></button><button id="watch" type="button"></button></div>
    <p id="mouse-hint"></p>
    <canvas id="canvas" width="640" height="400" tabindex="0"></canvas><p id="help"></p><p id="legal"></p>
    <div id="game-toolbar" hidden><button id="join-playing" type="button"></button>
      <button id="menu-toggle" type="button" aria-controls="game-menu" aria-expanded="false"></button></div>
    <section id="game-menu" hidden aria-labelledby="game-menu-title"><h2 id="game-menu-title"></h2>
      <p id="game-help"></p><p id="menu-notice"></p>
      <div id="host-actions"><button id="restart" type="button"></button><button id="return-lobby" type="button"></button></div>
    </section>
    <div id="confirm-action" hidden><p></p><button id="confirm-yes" type="button"></button><button id="confirm-no" type="button"></button></div>`;
  const get = id => document.getElementById(id);
  const status = get('status');
  const canvas = get('canvas');
  const join = get('join'), ready = get('ready'), start = get('start'), watch = get('watch');
  let socket, keyPair, publicKey, renewal;
  let uid = 0, slot = null, peers = [], started = false, prepared = false, loading = false, disposed = false, ended = false;
  let prepareFailed = false;
  let round = 0, incomingHash, uploading = false, menuOpen = false, pendingAction = null;
  let doomGeneration = 0, watchingDoom = false, canResume = false;
  let engine, nes, gameData, hash, loop, audio, audioTime = 0, audioSamples = [];
  let buttons = 0, remoteButtons = [0, 0], nesSynchronized = false;
  let replay = [], replayIndex = 0, catchingUp = false;
  const down = new Map();
  const audioNodes = new Set();
  const nesHelp = () => text(
    'Setas: direcional\nX: botão A · Z: botão B\nEnter: Start · Shift: Select\nEsc: abrir/fechar este menu\nCada jogador usa essas teclas no próprio controle. Para dupla, selecione o modo de 2 jogadores dentro do jogo.',
    'Arrow keys: D-pad\nX: A button · Z: B button\nEnter: Start · Shift: Select\nEsc: open/close this menu\nEach player uses these keys for their own controller. For co-op, select the 2-player mode inside the game.');
  const doomHelp = () => text(
    'WASD: mover · Mouse/setas: virar\nClique esquerdo/espaço: atirar · E: usar · 1–7: armas\nClique no jogo para capturar o mouse; Esc libera.\nF2: abrir/fechar Controles e opções. O menu libera o mouse.',
    'WASD: move · Mouse/arrows: turn\nLeft click/space: fire · E: use · 1–7: weapons\nClick the game to capture the mouse; Esc releases it.\nF2: open/close Controls and options. The menu releases the mouse.');
  let statusText = ['', ''];
  const show = (pt, en, error = false) => {
    statusText = [pt, en];
    status.textContent = text(pt, en);
    status.classList.toggle('game-error', error);
  };
  function render() {
    root.classList.toggle('playing', started && !!(engine || nes));
    root.querySelector('h1').textContent = config.game === 'doom' ? 'DOOM / Freedoom' : text('Emulador NES', 'NES emulator');
    get('controls').hidden = ended;
    status.textContent = text(...statusText);
    get('room-players').textContent = peers.map(peer =>
      (peer.slot === null ? text('Assistindo: ', 'Watching: ') : `${text('Jogador', 'Player')} ${peer.slot + 1}: `) +
      peer.nickname + (peer.ready ? ' ✓' : '')).join(' · ');
    get('rom-label').hidden = ended || config.game !== 'nes' || slot !== 0 || started;
    get('rom').disabled = slot !== 0 || loading || uploading || started;
    get('rom-label').querySelector('span').textContent = text('Host: escolha a ROM NES da sala:', 'Host: choose the room’s NES ROM:');
    join.textContent = text('Entrar como jogador 2', 'Join as player 2');
    join.hidden = slot !== null || started && config.game !== 'nes';
    join.disabled = !uid || peers.some(peer => peer.slot === 1) || started && !prepared;
    ready.textContent = prepared ? text('Pronto', 'Ready') : text('Tentar novamente', 'Retry');
    ready.hidden = !prepareFailed || config.game === 'doom' && (slot === null || started);
    ready.disabled = !uid || loading || uploading || prepared;
    start.textContent = config.game === 'doom' ? text('Iniciar cooperativo', 'Start co-op') :
      canResume ? text('Iniciar do zero', 'Start over') : text('Iniciar jogo', 'Start game');
    start.hidden = slot !== 0 || started;
    const players = peers.filter(peer => peer.slot !== null);
    start.disabled = !prepared || loading || uploading || players.length < (config.game === 'doom' ? 2 : 1) || players.some(peer => !peer.ready);
    get('resume').hidden = slot !== 0 || started || !canResume;
    get('resume').disabled = start.disabled;
    get('resume').textContent = text('Retomar partida', 'Resume game');
    watch.textContent = config.game === 'nes' ? text('Espectador', 'Spectator') : text('Assistir', 'Watch');
    watch.hidden = slot !== null || config.game === 'doom' && !started;
    watch.disabled = config.game === 'nes' || !uid || loading || !!engine || catchingUp;
    get('mouse-hint').hidden = config.game !== 'doom' || !engine || slot === null;
    get('mouse-hint').textContent = document.pointerLockElement === canvas
      ? text('Mouse capturado · Esc para liberar', 'Mouse captured · Esc to release')
      : text('Clique para capturar o mouse · Esc para liberar', 'Click to capture the mouse · Esc to release');
    get('help').textContent = config.game === 'doom' ? doomHelp() : nesHelp();
    get('legal').textContent = config.game === 'doom'
      ? text('Engine GPL e conteúdo livre Freedoom 0.13.0. Fontes e licenças acompanham o bot.',
        'GPL engine and free Freedoom 0.13.0 game data. Source and licenses are included with the bot.')
      : text('O host escolhe uma ROM que tenha permissão para compartilhar. Ela é enviada aos participantes autenticados e mantida apenas em memória durante a sessão, sem ser salva pelo bot.',
        'The host chooses a ROM they have permission to share. It is sent to authenticated participants and kept only in memory during the session, not saved by the bot.');
    if (config.game === 'nes' && uid && !started && !ended && !loading && !uploading && !prepareFailed && !status.classList.contains('game-error')) {
      if (canResume) status.textContent = text('Progresso preservado. O host pode retomar a partida ou iniciar do zero. Trocar a ROM descarta o progresso.',
        'Progress preserved. The host can resume or start over. Changing the ROM discards progress.');
      else if (slot === 0) status.textContent = prepared
        ? text('ROM pronta. Você pode iniciar sozinho ou aguardar o jogador 2.', 'ROM ready. Start solo or wait for player 2.')
        : text('Escolha a ROM para preparar a partida. Só você controla o jogo da sala.', 'Choose the ROM to prepare the game. Only you manage the room’s game.');
      else status.textContent = !prepared
        ? text('Aguardando o host escolher e preparar a ROM. Você já pode entrar como jogador 2 ou permanecer como espectador.',
          'Waiting for the host to choose and prepare the ROM. You can already join as player 2 or remain a spectator.')
        : text('ROM recebida. Aguardando o host iniciar a partida.', 'ROM received. Waiting for the host to start the game.');
    }
    get('game-toolbar').hidden = !started || !(engine || nes);
    get('join-playing').hidden = slot !== null || config.game !== 'nes';
    get('join-playing').textContent = join.textContent;
    get('join-playing').disabled = join.disabled;
    get('menu-toggle').textContent = text('Controles e opções · ', 'Controls and options · ') + (config.game === 'doom' ? 'F2' : 'Esc');
    get('menu-toggle').setAttribute('aria-expanded', String(menuOpen));
    get('game-menu').hidden = !started || !(engine || nes) || !menuOpen || !!pendingAction;
    get('game-menu-title').textContent = config.game === 'doom' ? text('Controles do DOOM', 'DOOM controls') : text('Controles do NES', 'NES controls');
    get('game-help').textContent = config.game === 'doom' ? doomHelp() : nesHelp();
    get('menu-notice').textContent = text('O menu não pausa a partida. Só o host pode reiniciar ou voltar ao lobby.',
      'The menu does not pause the game. Only the host can restart or return to the lobby.');
    get('host-actions').hidden = slot !== 0;
    get('restart').textContent = config.game === 'doom' ? text('Reiniciar partida', 'Restart game') : text('Reiniciar ROM', 'Restart ROM');
    get('return-lobby').textContent = text('Voltar ao lobby', 'Return to lobby');
    get('confirm-action').hidden = !pendingAction || slot !== 0;
    get('confirm-action').querySelector('p').textContent = pendingAction === 'restart' || pendingAction === 'start'
      ? text('Reiniciar para todos? O progresso atual será perdido.', 'Restart for everyone? Current progress will be lost.')
      : config.game === 'nes'
        ? text('Voltar ao lobby para todos? O progresso ficará disponível para retomar enquanto a ROM e a sessão forem mantidas.',
          'Return everyone to the lobby? Progress can be resumed while the ROM and session are kept.')
        : text('Voltar ao lobby para todos? O progresso atual será perdido.', 'Return everyone to the lobby? Current progress will be lost.');
    get('confirm-yes').textContent = text('Confirmar', 'Confirm');
    get('confirm-no').textContent = text('Cancelar', 'Cancel');
  }
  function fail(error) {
    if (disposed || ended && error?.name === 'AbortError') return;
    console.error('[games]', error);
    const detail = error?.message ?? String(error);
    show('Não foi possível continuar o jogo. ' + detail, 'Could not continue the game. ' + detail, true);
  }
  function send(value) {
    if (socket?.readyState !== WebSocket.OPEN) throw new Error(text('Conexão com o jogo indisponível.', 'Game connection is unavailable.'));
    if (socket.bufferedAmount > 1024 * 1024) throw new Error(text('Conexão com o jogo muito lenta.', 'Game connection is too slow.'));
    socket.send(value instanceof Uint8Array ? value : JSON.stringify(value));
  }
  function loadScript(url) {
    return new Promise((resolve, reject) => {
      abort.signal.throwIfAborted();
      const script = document.createElement('script');
      const finish = error => {
        clearTimeout(timeout);
        abort.signal.removeEventListener('abort', cancelled);
        script.onload = script.onerror = null;
        if (error) { script.remove(); reject(error); }
        else resolve();
      };
      const cancelled = () => finish(abort.signal.reason);
      const timeout = setTimeout(() => finish(new Error(text('Tempo esgotado ao carregar a engine.', 'Loading the engine timed out.'))), 30000);
      abort.signal.addEventListener('abort', cancelled, { once: true });
      script.crossOrigin = 'anonymous';
      script.src = url;
      script.onload = () => finish();
      script.onerror = () => finish(new Error(text('Falha ao carregar a engine.', 'Failed to load the engine.')));
      document.head.append(script);
    });
  }
  const base64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  async function digest(bytes) {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  async function validateNes(data) {
    if (data.length < 16 || data.length > 4 * 1024 * 1024 ||
        String.fromCharCode(...data.subarray(0, 4)) !== 'NES\u001a') throw new Error(text('Arquivo não é uma ROM NES válida de até 4 MiB.', 'Not a valid NES ROM up to 4 MiB.'));
    if ((data[7] & 0x0c) === 0x08) throw new Error(text('Use uma ROM no formato iNES original.', 'Use an original iNES-format ROM.'));
    const expected = 16 + (data[6] & 4 ? 512 : 0) + data[4] * 16384 + data[5] * 8192;
    if (!data[4] || expected !== data.length) throw new Error(text('ROM incompleta ou cabeçalho inválido.', 'Incomplete ROM or invalid header.'));
    if (!window.jsnes) await loadScript(config.base + '/games/nes.js');
    abort.signal.throwIfAborted();
    new window.jsnes.NES().loadROM(data);
  }
  async function receiveRom(data) {
    prepared = false;
    loading = true;
    prepareFailed = false;
    show('Preparando a ROM escolhida pelo host...', 'Preparing the ROM chosen by the host...');
    render();
    try {
      await validateNes(data);
      const checksum = await digest(data);
      abort.signal.throwIfAborted();
      if (!incomingHash || checksum !== incomingHash) throw new Error(text('A ROM recebida não confere com a do host.', 'The received ROM does not match the host’s ROM.'));
      incomingHash = undefined;
      gameData = data;
      hash = checksum;
      prepared = true;
      send({ type: 'ready', hash });
      show('ROM recebida. Aguardando o host iniciar.', 'ROM received. Waiting for the host to start.');
      if (started) await play();
    } catch (error) {
      prepareFailed = true;
      throw error;
    } finally { loading = false; uploading = false; render(); }
  }
  async function prepare() {
    abort.signal.throwIfAborted();
    if (prepared || loading || uploading) return;
    if (config.game === 'nes' && (slot !== 0 || started)) throw new Error(text('Só o host pode escolher a ROM no lobby.', 'Only the host can choose the ROM in the lobby.'));
    loading = true;
    prepareFailed = false;
    render();
    show('Preparando arquivos do jogo...', 'Preparing game files...');
    try {
      let data;
      if (config.game === 'doom') {
        if (!window.createMonkyDoom) await loadScript(config.base + '/games/doom/engine.js');
        const response = await fetch(config.base + '/games/doom/freedoom1.wad', { signal: abort.signal });
        if (!response.ok) throw new Error('Freedoom HTTP ' + response.status);
        data = new Uint8Array(await response.arrayBuffer());
      } else {
        const file = get('rom').files[0];
        if (!file || file.size < 16 || file.size > 4 * 1024 * 1024) {
          throw new Error(text('Escolha uma ROM NES válida, de até 4 MiB.', 'Choose a valid NES ROM, up to 4 MiB.'));
        }
        data = new Uint8Array(await file.arrayBuffer());
        abort.signal.throwIfAborted();
        await validateNes(data);
        abort.signal.throwIfAborted();
        send(data);
        uploading = true;
        show('Enviando a ROM aos participantes da sala...', 'Sending the ROM to room participants...');
        return;
      }
      const checksum = await digest(data);
      abort.signal.throwIfAborted();
      gameData = data;
      hash = checksum;
      prepared = true;
      if (slot !== null) send({ type: 'ready', hash });
      show('Pronto. Aguarde os dois jogadores e inicie a partida.', 'Ready. Wait for both players and start the game.');
    } catch (error) {
      prepareFailed = true;
      throw error;
    } finally { loading = false; render(); }
  }
  function resumeAudio() {
    if (config.game !== 'nes' || ended) return;
    audio ??= new AudioContext({ sampleRate: 48000 });
    if (audio.state !== 'running') void audio.resume().catch(fail);
  }
  function pushAudio(left, right) {
    if (!audio || audio.state !== 'running' || catchingUp) return;
    audioSamples.push(left, right);
    if (audioSamples.length < 2048) return;
    const buffer = audio.createBuffer(2, audioSamples.length / 2, 48000);
    for (let i = 0; i < buffer.length; i++) {
      buffer.getChannelData(0)[i] = audioSamples[i * 2];
      buffer.getChannelData(1)[i] = audioSamples[i * 2 + 1];
    }
    audioSamples = [];
    if (audioTime > audio.currentTime + .25) return;
    const node = audio.createBufferSource();
    node.buffer = buffer;
    node.connect(audio.destination);
    audioTime = Math.max(audioTime, audio.currentTime + .02);
    node.start(audioTime);
    audioTime += buffer.duration;
    audioNodes.add(node);
    node.onended = () => { node.disconnect(); audioNodes.delete(node); };
  }
  function createNes() {
    canvas.width = 256;
    canvas.height = 240;
    const context = canvas.getContext('2d');
    const image = context.createImageData(256, 240);
    const pixels = new Uint32Array(image.data.buffer);
    nes = new window.jsnes.NES({
      onFrame(buffer) {
        for (let i = 0; i < buffer.length; i++) pixels[i] = 0xff000000 | buffer[i];
        context.putImageData(image, 0, 0);
      },
      onAudioSample: pushAudio, sampleRate: 48000,
    });
    nes.loadROM(gameData);
  }
  function nesFrame(masks) {
    masks.forEach((mask, player) => {
      for (let button = 0; button < 8; button++) {
        if (mask & (1 << button)) nes.buttonDown(player + 1, button);
        else nes.buttonUp(player + 1, button);
      }
    });
    nes.frame();
  }
  function catchUp() {
    if (ended) return;
    try {
      const end = Math.min(replay.length, replayIndex + 120);
      while (replayIndex < end) nesFrame(replay[replayIndex++]);
      if (replayIndex < replay.length) { loop = setTimeout(catchUp, 0); return; }
      replay = [];
      replayIndex = 0;
      catchingUp = false;
      nesSynchronized = true;
      if (slot === 0) startNesLoop();
      show(slot === null ? 'Assistindo à partida.' : 'Partida em andamento.', slot === null ? 'Watching the game.' : 'Game in progress.');
      render();
    } catch (error) { stop(); fail(error); }
  }
  function startNesLoop() {
    loop = setInterval(() => {
      try {
        const masks = [buttons, remoteButtons[1]];
        nesFrame(masks);
        send({ type: 'frames', frames: [masks], round });
      } catch (error) { stop(); fail(error); }
    }, 1000 / 60);
  }
  async function play(resume = false) {
    if (!prepared || config.game === 'doom' && slot === null && !watchingDoom) return;
    const playingRound = round;
    if (slot !== null) canvas.focus();
    if (config.game === 'doom') await runDoom(slot === null);
    else {
      resumeAudio();
      createNes();
      nesSynchronized = slot === 0 && !resume;
      if (nesSynchronized) startNesLoop();
      else send({ type: 'watch', hash, round });
    }
    if (ended || !started || playingRound !== round) return;
    show('Partida em andamento.', 'Game in progress.');
    render();
  }
  async function runDoom(spectator) {
    const generation = doomGeneration, playingRound = round;
    window._monkyUID = uid;
    window._webxdcRecvQueue ??= [];
    window._webxdcEarlyQueue = [];
    window._webxdcChannel = { send(packet) {
      if (generation !== doomGeneration || !started) return;
      const bytes = new Uint8Array(packet.length + 4);
      new DataView(bytes.buffer).setUint32(0, playingRound, true);
      bytes.set(packet, 4);
      send(bytes);
    } };
    let diagnostic = '';
    const runtime = await window.createMonkyDoom({
      noInitialRun: true, canvas,
      locateFile: name => config.base + '/games/doom/' + name,
      print: line => { if (!line.startsWith('doom: SV got packet')) console.debug('[DOOM]', line); },
      printErr: line => { if (line.trim()) diagnostic = line; console.warn('[DOOM]', line); },
      onAbort: reason => { if (generation === doomGeneration) fail(new Error(String(reason))); },
      onExit: code => {
        if (ended || generation !== doomGeneration) return;
        engine = undefined;
        stop();
        socket?.close();
        if (code) fail(new Error(diagnostic || 'DOOM exit ' + code));
        else show('Jogo encerrado. Reabra o miniapp para jogar novamente.', 'Game ended. Reopen the miniapp to play again.');
      },
    });
    if (ended || generation !== doomGeneration) {
      try { runtime._monky_stop(); }
      catch (error) { if (error.name !== 'ExitStatus' || error.status !== 0) fail(error); }
      return;
    }
    engine = runtime;
    engine.FS.writeFile('/freedoom1.wad', gameData);
    engine.FS.writeFile('/default.cfg', [
      'key_up 17', 'key_down 31', 'key_strafeleft 30', 'key_straferight 32',
      'key_fire 57', 'key_use 18', 'show_endoom 0',
    ].join('\n') + '\n');
    // Browser input owns capture and injects relative motion; SDL must not also read it.
    const args = ['-iwad', '/freedoom1.wad', '-window', '-nogui', '-nograbmouse', '-nomouse',
      '-config', '/default.cfg', '-servername', 'Monky', '-pet', api.viewer.nickname,
      '-skill', '2', '-warp', '1', '1'];
    if (slot === 0) args.push('-server', '-privateserver', '-nodes', '2');
    else args.push('-connect', '1');
    if (spectator) args.push('-drone');
    engine.callMain(args);
  }
  function doomKey(source, code, pressed) {
    const wasDown = [...down.values()].includes(code);
    if (pressed) down.set(source, code); else down.delete(source);
    const isDown = [...down.values()].includes(code);
    if (wasDown !== isDown) engine._inject_key_event(isDown ? 0 : 1, code);
  }
  function releaseKeys() {
    buttons = 0;
    if (started && slot !== null && config.game === 'nes' && socket?.readyState === WebSocket.OPEN) send({ type: 'input', buttons: 0, round });
    if (engine) for (const code of new Set(down.values())) engine._inject_key_event(1, code);
    down.clear();
  }
  function releaseMouse() {
    releaseKeys();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  }
  async function captureMouse() {
    if (!engine || !started || menuOpen || slot === null || document.pointerLockElement === canvas) return;
    const generation = doomGeneration;
    canvas.focus();
    try {
      await canvas.requestPointerLock();
      if (ended || disposed || !started || menuOpen || slot === null || generation !== doomGeneration) releaseMouse();
    }
    catch (error) {
      console.error('[games] Mouse capture failed.', error);
      show('Não foi possível capturar o mouse. Clique novamente no jogo para tentar.',
        'Could not capture the mouse. Click the game again to retry.', true);
    }
  }
  function resetNes() {
    clearInterval(loop);
    clearTimeout(loop);
    buttons = 0;
    remoteButtons = [0, 0];
    down.clear();
    replay = [];
    replayIndex = 0;
    catchingUp = false;
    nesSynchronized = false;
    nes = undefined;
    menuOpen = false;
    pendingAction = null;
    for (const node of audioNodes) { node.stop(); node.disconnect(); }
    audioNodes.clear();
    audioSamples = [];
    audioTime = audio?.currentTime ?? 0;
  }
  function resetDoom() {
    releaseMouse();
    doomGeneration++;
    const previous = engine;
    engine = undefined;
    window._webxdcChannel = undefined;
    window._webxdcRecvQueue = [];
    window._webxdcEarlyQueue = [];
    menuOpen = false;
    pendingAction = null;
    if (previous) {
      const context = previous.SDL2?.audioContext;
      try { previous._monky_stop(); }
      catch (error) { if (error.name !== 'ExitStatus' || error.status !== 0) throw error; }
      finally {
        if (context && context.state !== 'closed') void context.close().catch(fail);
      }
    }
  }
  function toggleMenu() {
    if (!started || !(engine || nes)) return;
    menuOpen = !menuOpen;
    pendingAction = null;
    releaseMouse();
    render();
    if (menuOpen) get('menu-toggle').focus();
    else canvas.focus();
  }
  function stop() {
    if (ended) return;
    ended = true;
    started = false;
    releaseMouse();
    clearInterval(loop);
    replay = [];
    abort.abort();
    try { resetDoom(); } catch (error) { fail(error); }
    resetNes();
    engine = undefined;
    gameData = undefined;
    window._webxdcChannel = undefined;
    window._webxdcRecvQueue = [];
    started = false;
    if (audio) void audio.close().catch(fail);
    audio = undefined;
    render();
  }
  function key(event, pressed) {
    if (!started) return;
    if (event.code === (config.game === 'doom' ? 'F2' : 'Escape')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (pressed && !event.repeat) toggleMenu();
      return;
    }
    if (menuOpen || pendingAction || event.target instanceof Element && event.target.closest('button,input,a')) {
      if (engine) event.stopImmediatePropagation();
      return;
    }
    if (config.game === 'nes' && !nesSynchronized) return;
    const nesKeys = { KeyX: 0, KeyZ: 1, ShiftLeft: 2, ShiftRight: 2, Enter: 3, ArrowUp: 4, ArrowDown: 5, ArrowLeft: 6, ArrowRight: 7 };
    const doomKeys = { KeyW: 119, KeyS: 115, KeyA: 97, KeyD: 100, ArrowLeft: 0xac, ArrowRight: 0xae,
      ArrowUp: 0xad, ArrowDown: 0xaf, Space: 32, KeyE: 101, Escape: 27, Enter: 13, Tab: 9,
      ShiftLeft: 0xb6, ShiftRight: 0xb6, Digit1: 49, Digit2: 50, Digit3: 51, Digit4: 52, Digit5: 53, Digit6: 54, Digit7: 55 };
    const code = (config.game === 'doom' ? doomKeys : nesKeys)[event.code];
    if (code === undefined) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (slot === null || event.repeat) return;
    if (config.game === 'doom') {
      if (engine) doomKey(event.code, code, pressed);
    } else {
      if (pressed) down.set(event.code, code); else down.delete(event.code);
      buttons = [...down.values()].reduce((mask, button) => mask | (1 << button), 0);
      send({ type: 'input', buttons, round });
    }
  }
  async function received(event) {
    if (ended || disposed) return;
    if (event.data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(event.data);
      if (config.game === 'nes') { await receiveRom(bytes); return; }
      if (bytes.length < 12) throw new Error('Invalid DOOM packet');
      if (new DataView(bytes.buffer).getUint32(0, true) !== round || !started) return;
      if (!window._webxdcRecvQueue) window._webxdcRecvQueue = [];
      if (window._webxdcRecvQueue.length >= 512) throw new Error('DOOM receive queue overflow');
      window._webxdcRecvQueue.push(bytes.slice(8));
      return;
    }
    const value = JSON.parse(event.data);
    if (value.type === 'challenge') {
      const proof = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey,
        new TextEncoder().encode(config.roomId + ':' + value.challenge));
      abort.signal.throwIfAborted();
      send({ type: 'authenticate', key: publicKey, proof: base64(proof) });
    } else if (value.type === 'authenticated') {
      uid = value.uid;
      show('Conectado. Aguardando os jogadores.', 'Connected. Waiting for the players.');
    } else if (value.type === 'lobby') {
      peers = value.peers;
      const previousSlot = slot;
      slot = peers.find(peer => peer.uid === uid)?.slot ?? null;
      started = value.started;
      round = value.round;
      canResume = value.canResume;
      render();
      if (slot !== null && !started) {
        if (prepared && previousSlot === null) send({ type: 'ready', hash });
        else if (!prepared && !loading && !uploading && !prepareFailed && config.game === 'doom') {
          void prepare().catch(fail);
        }
      }
      if (config.game === 'nes' && started && prepared && !nes) await play();
    } else if (value.type === 'rom') {
      if (config.game !== 'nes' || typeof value.hash !== 'string' || !/^[a-f0-9]{64}$/.test(value.hash)) throw new Error('Invalid ROM announcement');
      incomingHash = value.hash;
    } else if (value.type === 'start' || value.type === 'resume') {
      if (config.game === 'nes') resetNes();
      else resetDoom();
      round = value.round;
      canResume = false;
      started = true;
      await play(value.type === 'resume');
      render();
    } else if (value.type === 'reset-lobby') {
      started = false;
      round = value.round;
      if (config.game === 'nes') resetNes();
      else resetDoom();
      show('De volta ao lobby. Aguardando o host.', 'Back in the lobby. Waiting for the host.');
      render();
    } else if (value.type === 'input' && value.round === round) remoteButtons[value.slot] = value.buttons;
    else if (value.type === 'frames') {
      if (value.round !== round) return;
      if (catchingUp) replay.push(...value.frames);
      else if (nes && nesSynchronized) for (const frame of value.frames) nesFrame(frame);
    } else if (value.type === 'replay') {
      if (value.round !== round) return;
      if (nes && !nesSynchronized && !catchingUp) {
        replay = value.frames;
        replayIndex = 0;
        catchingUp = true;
        show('Sincronizando a partida...', 'Synchronizing the game...');
        catchUp();
      }
    } else if (value.type === 'unavailable') show(
      'A vaga ou a partida mudou. Aguarde o estado da sala e tente novamente.',
      'The seat or game has changed. Wait for the room state and try again.');
    else if (value.type === 'mismatch') {
      if (config.game === 'nes' && prepared && hash === value.hash) return;
      prepareFailed = true;
      prepared = false;
      show('A ROM ainda não está sincronizada com a do host. Tente receber os arquivos novamente.',
        'The ROM is not synchronized with the host yet. Try receiving the files again.', true);
      render();
    }
    else if (value.type === 'stopped') {
      stop();
      show('Um jogador saiu. Feche a visualização e abra novamente para iniciar outra partida.',
        'A player left. Close this view and open it again to start another game.');
    }
  }
  for (const button of [join, get('join-playing')]) button.addEventListener('click', () => { try { send({ type: 'join' }); } catch (error) { fail(error); } });
  ready.addEventListener('click', () => {
    if (config.game === 'nes' && slot !== 0) {
      try { send({ type: 'request-rom' }); } catch (error) { fail(error); }
    } else void prepare().catch(fail);
  });
  get('menu-toggle').addEventListener('click', toggleMenu);
  for (const action of ['restart', 'return-lobby']) get(action).addEventListener('click', () => {
    if (slot !== 0 || !started) return;
    pendingAction = action;
    render();
    get('confirm-no').focus();
  });
  get('confirm-no').addEventListener('click', () => { pendingAction = null; render(); (started ? get('menu-toggle') : get('resume')).focus(); });
  get('confirm-yes').addEventListener('click', () => {
    if (slot !== 0 || !pendingAction || !started && pendingAction !== 'start') return;
    try { send({ type: pendingAction, round }); pendingAction = null; render(); }
    catch (error) { fail(error); }
  });
  start.addEventListener('click', () => {
    if (slot !== 0 || started) return;
    if (canResume) { pendingAction = 'start'; render(); get('confirm-no').focus(); }
    else { try { send({ type: 'start' }); } catch (error) { fail(error); } }
  });
  get('resume').addEventListener('click', () => { try { send({ type: 'resume' }); } catch (error) { fail(error); } });
  canvas.addEventListener('blur', releaseKeys);
  canvas.addEventListener('mousedown', event => {
    if (config.game !== 'doom' || !engine || menuOpen || slot === null) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (document.pointerLockElement !== canvas) { void captureMouse(); return; }
    if (event.button === 0) doomKey('mouse-left', 32, true);
  }, true);
  window.addEventListener('mouseup', event => {
    if (config.game === 'doom' && engine && event.button === 0) doomKey('mouse-left', 32, false);
  }, true);
  window.addEventListener('mousemove', event => {
    if (engine && slot !== null && document.pointerLockElement === canvas) {
      engine._inject_mouse_motion(event.movementX, 0);
    }
  }, true);
  canvas.addEventListener('contextmenu', event => {
    if (document.pointerLockElement === canvas) event.preventDefault();
  });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement !== canvas) releaseKeys();
    render();
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) releaseMouse();
    render();
  });
  watch.addEventListener('click', () => {
    if (config.game !== 'doom' || loading || engine || !started || slot !== null) return;
    watchingDoom = true;
    void (async () => {
      await prepare();
      abort.signal.throwIfAborted();
      if (!started) return;
      const watchingRound = round;
      loading = true;
      render();
      try {
        await runDoom(true);
        if (!ended && started && watchingRound === round) show('Assistindo à partida.', 'Watching the game.');
      } finally { loading = false; render(); }
    })().catch(fail);
  });
  get('rom').addEventListener('change', () => {
    if (config.game !== 'nes' || slot !== 0 || started || loading || uploading) return;
    if (!get('rom').files.length) return;
    const previous = { prepared, gameData, hash };
    prepared = false;
    prepareFailed = false;
    gameData = undefined;
    render();
    if (uid && get('rom').files.length) void prepare().catch(error => {
      if (!ended && !disposed && previous.prepared) {
        prepared = true;
        gameData = previous.gameData;
        hash = previous.hash;
        prepareFailed = false;
      }
      fail(error);
      render();
    });
  });
  const onDown = event => { try { key(event, true); } catch (error) { fail(error); } };
  const onUp = event => { try { key(event, false); } catch (error) { fail(error); } };
  window.addEventListener('keydown', resumeAudio, true);
  window.addEventListener('pointerdown', resumeAudio, true);
  window.addEventListener('keydown', onDown, true);
  window.addEventListener('keyup', onUp, true);
  window.addEventListener('blur', releaseMouse);
  document.addEventListener('visibilitychange', () => { if (document.hidden) releaseMouse(); });
  const unsubscribe = api.onState(render);
  window.addEventListener('error', event => { fail(event.error ?? new Error(event.message)); stop(); });
  window.addEventListener('unhandledrejection', event => { fail(event.reason); stop(); });
  window.addEventListener('pagehide', () => {
    disposed = true;
    clearInterval(renewal);
    unsubscribe();
    stop();
    abort.abort();
    socket?.close();
  }, { once: true });
  show('Verificando conexão e permissões...', 'Checking connection and permissions...');
  render();
  void (async () => {
    const health = await fetch(config.base + '/games/health', { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]) });
    if (!health.ok || (await health.json()).application !== 'monky-games') throw new Error(text('Serviço de jogos indisponível.', 'Game service unavailable.'));
    keyPair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    publicKey = base64(await crypto.subtle.exportKey('raw', keyPair.publicKey));
    abort.signal.throwIfAborted();
    const renew = () => {
      if (!api.sendAction('connect', { key: publicKey })) {
        show('Aguardando autorização da sala de voz...', 'Waiting for voice room authorization...');
      }
    };
    renew();
    renewal = setInterval(renew, 5000);
    const url = new URL(config.base);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '/games/room/' + config.roomId;
    socket = new WebSocket(url);
    socket.binaryType = 'arraybuffer';
    let receiving = Promise.resolve();
    socket.onmessage = event => {
      // NES ROM validation must finish before a start or replay is applied.
      if (config.game === 'nes') receiving = receiving.then(() => received(event)).catch(fail);
      else void received(event).catch(fail);
    };
    socket.onerror = () => fail(new Error(text('Falha na conexão do jogo. Verifique URL pública, porta e firewall.',
      'Game connection failed. Check the public URL, port and firewall.')));
    socket.onclose = () => {
      clearInterval(renewal);
      if (!disposed && !ended) {
        stop();
        show('Conexão encerrada. Reabra o miniapp para reconectar.', 'Connection closed. Reopen the miniapp to reconnect.');
      }
    };
  })().catch(fail);
})();
