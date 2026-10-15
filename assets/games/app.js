/* DOOM/Freedoom and a host-controlled NES emulator. No commercial ROM is bundled. */
(() => {
  'use strict';
  const api = window.monkyScreen;
  const config = window.monkyGame;
  const root = document.getElementById('game-root');
  const abort = new AbortController();
  const text = (pt, en) => api.viewer.locale === 'en' ? en : pt;
  const style = document.createElement('style');
  // Visual language mirrors the Monky client (tokens, .btn, .modal-card) so the miniapp feels native.
  style.textContent = `
    :root{color-scheme:dark;--bg-app:#0b0e14;--bg-panel:#161b22;--bg-card:#1c232d;--bg-card-hover:#242c38;--bg-input:#0d1117;
      --accent:#5865f2;--accent-hover:#4752c4;--text:#f0f3f6;--text-secondary:#9da7b3;--text-muted:#656d76;--border:#262c36;
      --success:#23a55a;--danger:#f23f43;--danger-hover:#d83a3e;--radius-sm:4px;--radius-md:8px;--radius-lg:12px;
      font:14px/1.45 Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:var(--bg-app);color:var(--text)}
    *{box-sizing:border-box}body{margin:0;padding:20px;-webkit-font-smoothing:antialiased}
    main{display:flex;flex-direction:column;gap:14px;max-width:960px;margin:auto}
    h1,h2,p{margin:0}h1{font-size:20px;font-weight:700}h2{font-size:15px;font-weight:700}button,input{font:inherit;color:inherit}
    .app-header{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
    .app-badge{padding:2px 8px;border:1px solid var(--border);border-radius:999px;background:var(--bg-card);color:var(--text-secondary);font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase}
    .chips{display:flex;flex-wrap:wrap;gap:6px}.chips:empty{display:none}
    .chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid var(--border);border-radius:999px;background:var(--bg-card);color:var(--text-secondary);font-size:12px;overflow-wrap:anywhere}
    .chip strong{color:var(--text);font-weight:600}.chip .ready{color:var(--success);font-weight:700}
    #status{padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--bg-panel);color:var(--text-secondary);white-space:pre-wrap;overflow-wrap:anywhere}
    #status:empty{display:none}
    #status.game-error{border-color:color-mix(in srgb,var(--danger) 55%,var(--border));background:color-mix(in srgb,var(--danger) 12%,var(--bg-panel));color:var(--text)}
    .panel{display:flex;flex-direction:column;gap:12px;padding:16px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--bg-panel)}
    .muted{color:var(--text-secondary);font-size:13px}#help,#game-help{white-space:pre-line}
    .actions{display:flex;flex-wrap:wrap;gap:8px}
    .btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:9px 16px;border:1px solid transparent;border-radius:var(--radius-md);font-weight:500;cursor:pointer;transition:background-color .15s ease,transform .05s ease}
    .btn:active:not(:disabled){transform:scale(.98)}.btn:disabled{opacity:.5;cursor:not-allowed}
    .btn-primary{background:var(--accent);color:#fff}.btn-primary:hover:not(:disabled){background:var(--accent-hover)}
    .btn-secondary{border-color:var(--border);background:var(--bg-card)}.btn-secondary:hover:not(:disabled){background:var(--bg-card-hover)}
    .btn-danger{background:var(--danger);color:#fff}.btn-danger:hover:not(:disabled){background:var(--danger-hover)}
    .btn-sm{padding:6px 12px;font-size:13px}
    .btn-overlay{border-color:var(--border);background:rgba(22,27,34,.88);backdrop-filter:blur(6px)}.btn-overlay:hover{background:var(--bg-card-hover)}
    .btn:focus-visible,.modal-close:focus-visible,canvas:focus-visible,.file-field:focus-within{outline:2px solid var(--accent);outline-offset:2px}
    .file-field{position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:12px;padding:12px;border:1px dashed var(--border);border-radius:var(--radius-md);background:var(--bg-input);color:var(--text-secondary);cursor:pointer}
    .file-field:hover{border-color:var(--accent)}.file-field .btn{pointer-events:none}
    .file-field input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
    canvas{display:block;align-self:center;width:100%;max-height:60vh;object-fit:contain;border:1px solid var(--border);border-radius:var(--radius-lg);background:#000;image-rendering:pixelated}
    main:not(.playing) canvas.blank{display:none}
    main.playing{position:fixed;inset:0;display:block;width:100%;height:100%;max-width:none;margin:0;background:#000;overflow:hidden}
    main.playing canvas{width:100%;height:100%;max-height:none;border:0;border-radius:0}
    main.playing> :not(canvas):not(#mouse-hint):not(#pause-notice):not(.game-error):not(#game-toolbar):not(.modal-backdrop):not(#toast){display:none}
    main.playing #mouse-hint,main.playing .game-error,main.playing #pause-notice{position:absolute;left:50%;transform:translateX(-50%);max-width:90%;padding:6px 12px;border-radius:var(--radius-md);pointer-events:none}
    main.playing #mouse-hint{bottom:12px;background:rgba(22,27,34,.88);color:var(--text-secondary);font-size:12px}main.playing .game-error{top:12px}
    #pause-notice{margin:0;border:1px solid var(--border);background:var(--bg-panel);color:var(--text);text-align:center}main.playing #pause-notice{top:50%;transform:translate(-50%,-50%);padding:12px 18px;background:rgba(22,27,34,.92)}
    #game-toolbar{position:absolute;top:10px;right:10px;z-index:2;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}
    .modal-backdrop{position:fixed;inset:0;z-index:10;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.7)}
    .modal-card{display:flex;flex-direction:column;gap:16px;width:100%;max-width:480px;max-height:calc(100vh - 32px);overflow:auto;padding:20px;border:1px solid var(--border);border-radius:var(--radius-lg);background:var(--bg-panel);box-shadow:0 16px 48px rgba(0,0,0,.5)}
    .modal-wide{max-width:640px}.modal-header{display:flex;align-items:center;justify-content:space-between;gap:12px}
    .modal-title{font-size:18px;font-weight:700}.modal-footer{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:10px}
    .modal-close{padding:2px 8px;border:0;border-radius:var(--radius-sm);background:transparent;color:var(--text-muted);font-size:20px;line-height:1;cursor:pointer}
    .modal-close:hover{background:var(--bg-card);color:var(--text)}
    .saves{display:flex;flex-direction:column;gap:14px}.save-list{display:flex;flex-direction:column;gap:10px}
    .save-card,.resume-card{display:flex;flex-wrap:wrap;align-items:center;gap:14px;padding:10px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--bg-card)}
    .resume-card{background:var(--bg-panel)}
    .save-thumb{position:relative;flex:none;display:flex;align-items:center;justify-content:center;width:104px;aspect-ratio:16/15;padding:6px;overflow:hidden;border-radius:var(--radius-sm);background:var(--bg-input);color:var(--text-muted);font-size:11px;text-align:center}
    .save-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;image-rendering:pixelated}
    .save-info{flex:1 1 140px;min-width:0;display:flex;flex-direction:column;gap:2px}.save-name{font-weight:600}
    .save-meta{color:var(--text-secondary);font-size:12px;overflow-wrap:anywhere}
    .save-actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:6px;margin-left:auto}
    .saves-footer{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px}.saves-footer .muted{flex:1 1 240px}
    .confirm-thumb{align-self:center;width:192px;aspect-ratio:16/15;object-fit:cover;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--bg-input);image-rendering:pixelated}
    #menu-saves-open{margin-right:auto}
    .toast{position:fixed;bottom:24px;left:50%;z-index:20;transform:translateX(-50%);max-width:calc(100vw - 32px);padding:10px 16px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--bg-panel);color:var(--text);box-shadow:0 4px 16px rgba(0,0,0,.3);font-size:13px;pointer-events:none}
    .toast.danger{border-color:color-mix(in srgb,var(--danger) 55%,var(--border));background:color-mix(in srgb,var(--danger) 12%,var(--bg-panel))}
    a{color:var(--accent)}[hidden]{display:none!important}`;
  document.head.append(style);
  root.innerHTML = `<header class="app-header"><span class="app-badge">MonkyBot</span><h1></h1></header>
    <div id="room-players" class="chips"></div>
    <p id="status" role="status" aria-live="polite"></p>
    <label id="rom-label" class="file-field"><span id="rom-button" class="btn btn-secondary btn-sm"></span><span id="rom-text"></span>
      <input id="rom" type="file" accept=".nes"></label>
    <div id="controls" class="actions"><button id="join" type="button" class="btn btn-secondary"></button>
      <button id="ready" type="button" class="btn btn-secondary"></button><button id="resume" type="button" class="btn btn-primary"></button>
      <button id="start" type="button" class="btn btn-primary"></button><button id="watch" type="button" class="btn btn-secondary"></button>
      <button id="saves-lobby" type="button" class="btn btn-secondary" aria-controls="saves-modal"></button></div>
    <div id="resume-card" class="resume-card" hidden><div class="save-thumb"><img alt="" hidden><span></span></div>
      <div class="save-info"><span class="save-meta resume-label"></span><span class="save-name"></span><span class="save-meta"></span></div></div>
    <p id="mouse-hint"></p><p id="pause-notice" role="status" aria-live="polite" hidden></p>
    <canvas id="canvas" class="blank" width="640" height="400" tabindex="0"></canvas>
    <section class="panel"><h2 id="help-title"></h2><p id="help" class="muted"></p><p id="legal" class="muted"></p></section>
    <div id="game-toolbar" hidden><button id="join-playing" type="button" class="btn btn-primary"></button>
      <button id="saves-toggle" type="button" class="btn btn-overlay" aria-controls="saves-modal" aria-expanded="false"></button>
      <button id="menu-toggle" type="button" class="btn btn-overlay" aria-controls="game-menu" aria-expanded="false"></button></div>
    <section id="game-menu" class="modal-backdrop" hidden><div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="game-menu-title">
      <div class="modal-header"><h2 id="game-menu-title" class="modal-title"></h2><button id="menu-close" type="button" class="modal-close">×</button></div>
      <p id="game-help"></p><p id="menu-notice" class="muted"></p>
      <div id="menu-footer" class="modal-footer"><button id="menu-saves-open" type="button" class="btn btn-secondary"></button>
        <div id="host-actions" class="actions"><button id="restart" type="button" class="btn btn-secondary"></button>
        <button id="return-lobby" type="button" class="btn btn-secondary"></button></div></div></div></section>
    <section id="saves-modal" class="modal-backdrop" hidden><div class="modal-card modal-wide" role="dialog" aria-modal="true" aria-labelledby="saves-title">
      <div class="modal-header"><h2 id="saves-title" class="modal-title">Saves</h2><button id="saves-close" type="button" class="modal-close">×</button></div>
      <div id="menu-saves" class="saves"></div></div></section>
    <div id="confirm-action" class="modal-backdrop" hidden><div class="modal-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
      <h2 id="confirm-title" class="modal-title"></h2><img id="confirm-thumb" class="confirm-thumb" alt="" hidden><p class="muted"></p>
      <div class="modal-footer"><button id="confirm-no" type="button" class="btn btn-secondary"></button>
        <button id="confirm-yes" type="button" class="btn btn-danger"></button></div></div></div>
    <div id="save-question" class="modal-backdrop" hidden><div class="modal-card modal-wide" role="alertdialog" aria-modal="true" aria-labelledby="save-question-title">
      <h2 id="save-question-title" class="modal-title"></h2><p id="save-question-context" class="muted"></p>
      <div id="save-question-slots" class="save-list"></div><p id="save-question-note" class="muted"></p>
      <div class="modal-footer"><button id="save-question-no" type="button" class="btn btn-secondary"></button>
        <button id="save-question-yes" type="button" class="btn btn-primary"></button></div></div></div>
    <p id="toast" class="toast" role="status" aria-live="polite" hidden></p>`;
  const get = id => document.getElementById(id);
  const status = get('status');
  const canvas = get('canvas');
  const join = get('join'), ready = get('ready'), start = get('start'), watch = get('watch');
  let socket, keyPair, publicKey, renewal;
  let uid = 0, slot = null, peers = [], started = false, prepared = false, loading = false, disposed = false, ended = false;
  let prepareFailed = false;
  let round = 0, incomingHash, uploading = false, menuOpen = false, savesOpen = false, pendingAction = null, confirmReturn = null;
  let doomGeneration = 0, watchingDoom = false, canResume = false;
  let engine, nes, gameData, hash, loop, hostLoop, audio, audioTime = 0, audioSamples = [];
  let buttons = 0, remoteButtons = [0, 0], nesSynchronized = false;
  let replay = [], replayIndex = 0, catchingUp = false;
  // NES saves belong to each player: slot 0 is their autosave (the host's checkpoint), 1-3 are their own slots.
  // The bot keeps them for the session; with permission, Monky also keeps them on this computer.
  const AUTOSAVE = 0, SAVE_SLOTS = [0, 1, 2, 3], PLAYER_SLOTS = [1, 2, 3], SAVE_FORMAT = 'monky-nes-save';
  const MAX_SAVE_BYTES = 512 * 1024, MAX_SAVE_JSON = 4 * 1024 * 1024, MAX_THUMBNAIL = 96 * 1024;
  let emulator = '', romName = '', saves = [], baseInfo = null, baseText = '', baseHash = '', nesBase = '', resumeFrom = null;
  let checkpointId = 0, sinceCheckpoint = 0, uploads = Promise.resolve(), toastText = null, toastTimer, peersKey = '';
  // Slots with a save in progress, and keep requests waiting for the bot's answer.
  const saving = new Set(), keeping = new Map();
  // Device storage (absent in older Monky clients): status, the ROM already restored, and this view's own saves.
  const storage = api.storage;
  let storageStatus = storage?.status ?? 'unavailable', restoredFor = '';
  const ownSaves = new Map();
  // Closing: the save question shown to this player, the host loop frozen for it, and the host being out of view.
  let question = null, frozen = false, hostVisible = true, pauseInfo = null, closingInfo = null;
  // Save screenshots by save hash; each is fetched from the bot at most once per view.
  const thumbs = new Map(), thumbRequests = new Set();
  const down = new Map();
  const audioNodes = new Set();
  const nesHelp = () => text(
    'Setas: direcional\nX: botão A · Z: botão B\nEnter: Start · Shift: Select\nEsc: abrir/fechar os controles\nCada jogador usa essas teclas no próprio controle. Para dupla, selecione o modo de 2 jogadores dentro do jogo.',
    'Arrow keys: D-pad\nX: A button · Z: B button\nEnter: Start · Shift: Select\nEsc: open/close the controls\nEach player uses these keys for their own controller. For co-op, select the 2-player mode inside the game.');
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
    const playing = started && !!(engine || nes), en = api.viewer.locale === 'en';
    if (savesOpen && !savesAvailable()) savesOpen = false;
    root.classList.toggle('playing', playing);
    root.querySelector('h1').textContent = config.game === 'doom' ? 'DOOM / Freedoom' : text('Emulador NES', 'NES emulator');
    get('controls').hidden = ended;
    status.textContent = text(...statusText);
    renderPlayers();
    get('rom-label').hidden = ended || config.game !== 'nes' || slot !== 0 || started;
    get('rom').disabled = slot !== 0 || loading || uploading || started;
    get('rom-button').textContent = prepared ? text('Trocar ROM', 'Change ROM') : text('Escolher ROM', 'Choose ROM');
    get('rom-text').textContent = prepared && romName ? romName : text('Nenhuma ROM escolhida (.nes)', 'No ROM chosen yet (.nes)');
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
    get('help-title').textContent = text('Controles', 'Controls');
    get('help').textContent = config.game === 'doom' ? doomHelp() : nesHelp();
    get('legal').textContent = config.game === 'doom'
      ? text('Engine GPL e conteúdo livre Freedoom 0.13.0. Fontes e licenças acompanham o bot.',
        'GPL engine and free Freedoom 0.13.0 game data. Source and licenses are included with the bot.')
      : text('O host escolhe uma ROM que tenha permissão para compartilhar. Ela é enviada aos participantes autenticados e mantida apenas em memória durante a sessão, sem ser salva pelo bot.',
        'The host chooses a ROM they have permission to share. It is sent to authenticated participants and kept only in memory during the session, not saved by the bot.');
    if (config.game === 'nes' && uid && !started && !ended && !loading && !uploading && !prepareFailed && !status.classList.contains('game-error')) {
      if (canResume) status.textContent = resumeFrom === 'save' && baseInfo
        ? text(`Save pronto para retomar: ${slotName(baseInfo.slot, false)} (${describeSave(baseInfo, false)}). O host pode retomar a partida a partir dele ou iniciar do zero.`,
          `Save ready to resume: ${slotName(baseInfo.slot, true)} (${describeSave(baseInfo, true)}). The host can resume from it or start over.`)
        : text('Progresso preservado. O host pode retomar a partida ou iniciar do zero. Trocar a ROM descarta o progresso.',
          'Progress preserved. The host can resume or start over. Changing the ROM discards progress.');
      else if (slot === 0) status.textContent = prepared
        ? text('ROM pronta. Você pode iniciar sozinho ou aguardar o jogador 2.', 'ROM ready. Start solo or wait for player 2.')
        : text('Escolha a ROM para preparar a partida. Só você controla o jogo da sala.', 'Choose the ROM to prepare the game. Only you manage the room’s game.');
      else status.textContent = !prepared
        ? text('Aguardando o host escolher e preparar a ROM. Você já pode entrar como jogador 2 ou permanecer como espectador.',
          'Waiting for the host to choose and prepare the ROM. You can already join as player 2 or remain a spectator.')
        : text('ROM recebida. Aguardando o host iniciar a partida.', 'ROM received. Waiting for the host to start the game.');
    }
    const savesLabel = saves.length ? `Saves (${saves.length})` : 'Saves';
    get('saves-lobby').hidden = started || !savesAvailable();
    get('saves-lobby').textContent = savesLabel;
    const resumeCard = get('resume-card');
    resumeCard.hidden = config.game !== 'nes' || started || ended || !canResume || resumeFrom !== 'save' || !baseInfo || slot === null;
    if (!resumeCard.hidden) {
      showThumb(resumeCard.querySelector('.save-thumb'), baseInfo, '');
      resumeCard.querySelector('.resume-label').textContent = text('Ponto de retomada', 'Resume point');
      resumeCard.querySelector('.save-name').textContent = slotTitle(baseInfo.slot, en);
      resumeCard.querySelector('.save-meta:last-child').textContent = describeSave(baseInfo, en);
    }
    get('game-toolbar').hidden = !playing;
    get('join-playing').hidden = slot !== null || config.game !== 'nes';
    get('join-playing').textContent = join.textContent;
    get('join-playing').disabled = join.disabled;
    get('saves-toggle').hidden = !started || !savesAvailable();
    get('saves-toggle').textContent = savesLabel;
    get('saves-toggle').setAttribute('aria-expanded', String(savesOpen));
    get('menu-toggle').textContent = text('Controles e opções · ', 'Controls and options · ') + (config.game === 'doom' ? 'F2' : 'Esc');
    get('menu-toggle').setAttribute('aria-expanded', String(menuOpen));
    get('game-menu').hidden = !playing || !menuOpen || !!pendingAction || asking();
    get('game-menu-title').textContent = config.game === 'doom' ? text('Controles do DOOM', 'DOOM controls') : text('Controles do NES', 'NES controls');
    get('game-help').textContent = config.game === 'doom' ? doomHelp() : nesHelp();
    get('menu-notice').textContent = config.game === 'nes'
      ? text('O menu não pausa a partida. Cada jogador tem os próprios saves; só o host carrega um save, reinicia ou volta ao lobby.',
        'The menu does not pause the game. Each player has their own saves; only the host loads a save, restarts or returns to the lobby.')
      : text('O menu não pausa a partida. Só o host pode reiniciar ou voltar ao lobby.',
        'The menu does not pause the game. Only the host can restart or return to the lobby.');
    get('menu-saves-open').hidden = !started || !savesAvailable();
    get('menu-saves-open').textContent = savesLabel;
    get('host-actions').hidden = slot !== 0;
    get('menu-footer').hidden = get('menu-saves-open').hidden && slot !== 0;
    get('menu-close').setAttribute('aria-label', text('Fechar', 'Close'));
    get('restart').textContent = config.game === 'doom' ? text('Reiniciar partida', 'Restart game') : text('Reiniciar ROM', 'Restart ROM');
    get('return-lobby').textContent = text('Voltar ao lobby', 'Return to lobby');
    get('saves-modal').hidden = !savesOpen || !!pendingAction || asking();
    get('saves-close').setAttribute('aria-label', text('Fechar', 'Close'));
    renderSaves(get('menu-saves'));
    const confirm = get('confirm-action');
    confirm.hidden = !pendingAction || slot !== 0 || asking();
    if (!confirm.hidden) {
      get('confirm-title').textContent = confirmTitle();
      confirm.querySelector('p').textContent = confirmText();
      const yes = get('confirm-yes');
      yes.textContent = confirmLabel();
      yes.className = 'btn ' + (pendingAction.type === 'return-lobby' && config.game === 'nes' ? 'btn-primary' : 'btn-danger');
      const preview = confirmPreview(), image = get('confirm-thumb');
      if (preview && image.getAttribute('src') !== preview) image.src = preview;
      image.hidden = !preview;
    }
    get('confirm-no').textContent = text('Cancelar', 'Cancel');
    const notice = get('pause-notice');
    const closer = closingInfo?.uid !== uid ? closingInfo : null;
    const waiting = config.game === 'nes' && started && !ended && !asking() && (closer ?? (slot !== 0 ? pauseInfo : null));
    notice.hidden = !waiting;
    if (waiting) notice.textContent = closer
      ? text(`Partida parada: ${closer.nickname} está ${closer.reason === 'end' ? 'encerrando o NES' : 'saindo'}.`,
        `Game stopped: ${closer.nickname} is ${closer.reason === 'end' ? 'ending the NES' : 'leaving'}.`)
      : text(`Pausado: ${pauseInfo.nickname} não está vendo o jogo.`, `Paused: ${pauseInfo.nickname} can’t see the game.`);
    renderQuestion();
    if (toastText) get('toast').textContent = text(...toastText);
  }
  function renderPlayers() {
    // Chips are rebuilt only when the room changes, so frequent renders stay cheap.
    const key = JSON.stringify([api.viewer.locale, peers.map(peer => [peer.uid, peer.slot, peer.nickname, peer.ready])]);
    if (key === peersKey) return;
    peersKey = key;
    get('room-players').replaceChildren(...peers.map(peer => {
      const chip = document.createElement('span'), role = document.createElement('span'), name = document.createElement('strong');
      chip.className = 'chip';
      role.textContent = peer.slot === null ? text('Assistindo', 'Watching') : `${text('Jogador', 'Player')} ${peer.slot + 1}`;
      name.textContent = peer.nickname;
      chip.append(role, name);
      if (peer.ready) {
        const mark = document.createElement('span');
        mark.className = 'ready';
        mark.textContent = '✓';
        mark.title = text('Pronto', 'Ready');
        chip.append(mark);
      }
      return chip;
    }));
  }
  const savesAvailable = () => config.game === 'nes' && slot !== null && !ended && !!emulator && prepared && (!started || !!nes);
  const confirmTitle = () => ({
    start: text('Iniciar do zero?', 'Start over?'), restart: text('Reiniciar a partida?', 'Restart the game?'),
    load: text('Carregar save?', 'Load save?'), import: text('Carregar arquivo de save?', 'Load save file?'),
  })[pendingAction?.type] ?? text('Voltar ao lobby?', 'Return to lobby?');
  const confirmLabel = () => ({
    start: text('Iniciar do zero', 'Start over'), restart: text('Reiniciar', 'Restart'),
    load: text('Carregar', 'Load'), import: text('Carregar', 'Load'),
  })[pendingAction?.type] ?? text('Voltar ao lobby', 'Return to lobby');
  function confirmPreview() {
    if (pendingAction?.type === 'import') return pendingAction.preview;
    const save = pendingAction?.type === 'load' ? saves.find(item => item.slot === pendingAction.slot) : null;
    return save ? thumbs.get(save.hash) ?? '' : '';
  }
  function confirmText() {
    const type = pendingAction?.type;
    if (type === 'restart' || type === 'start') {
      return config.game === 'nes'
        ? text('Reiniciar para todos? O progresso atual será perdido; os saves continuam disponíveis.',
          'Restart for everyone? Current progress will be lost; saves remain available.')
        : text('Reiniciar para todos? O progresso atual será perdido.', 'Restart for everyone? Current progress will be lost.');
    }
    if (type === 'load' || type === 'import') {
      const save = type === 'load' ? saves.find(item => item.slot === pendingAction.slot) : null;
      const pt = save ? `${slotName(save.slot, false)} (${describeSave(save, false)})` : slotName(null, false);
      const en = save ? `${slotName(save.slot, true)} (${describeSave(save, true)})` : slotName(null, true);
      return started
        ? text(`Carregar ${pt} para todos? O progresso desde então será perdido.`,
          `Load ${en} for everyone? Progress made since then will be lost.`)
        : text(`Trocar o progresso preservado por ${pt}?`, `Replace the preserved progress with ${en}?`);
    }
    return config.game === 'nes'
      ? text('Voltar ao lobby para todos? O progresso ficará disponível para retomar enquanto a ROM e a sessão forem mantidas.',
        'Return everyone to the lobby? Progress can be resumed while the ROM and session are kept.')
      : text('Voltar ao lobby para todos? O progresso atual será perdido.', 'Return everyone to the lobby? Current progress will be lost.');
  }
  const slotName = (id, en) => id === null ? (en ? 'save file' : 'arquivo de save')
    : id === AUTOSAVE ? (en ? 'Automatic' : 'Automático') : 'Slot ' + id;
  const slotTitle = (id, en) => id === null ? (en ? 'Save file' : 'Arquivo de save') : slotName(id, en);
  // Saves kept on this computer may be days old, so other days also show the date.
  const clock = (time, en) => {
    const date = new Date(time), locale = en ? 'en' : 'pt-BR';
    const hour = date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    return date.toDateString() === new Date().toDateString() ? hour
      : `${date.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })} ${hour}`;
  };
  const describeSave = (save, en) => (save.nickname ? save.nickname + ' · ' : '') + clock(save.savedAt, en);
  function toast(pt, en, danger = false) {
    toastText = [pt, en];
    get('toast').textContent = text(pt, en);
    get('toast').classList.toggle('danger', danger);
    get('toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastText = null; get('toast').hidden = true; }, 4000);
  }
  function buildSaves(container) {
    container.innerHTML = '<div class="save-list"></div><div class="saves-footer"><p class="muted saves-notice"></p>' +
      '<label class="file-field"><span class="btn btn-secondary btn-sm"></span><span class="file-hint"></span>' +
      '<input type="file" accept=".monkynes"></label></div>';
    for (const id of SAVE_SLOTS) {
      const card = document.createElement('article');
      card.className = 'save-card';
      card.dataset.slot = String(id);
      card.innerHTML = '<div class="save-thumb"><img alt="" hidden><span></span></div>' +
        '<div class="save-info"><span class="save-name"></span><span class="save-meta"></span></div>' +
        '<div class="save-actions"><button type="button" class="btn btn-primary btn-sm" data-action="save"></button>' +
        '<button type="button" class="btn btn-secondary btn-sm" data-action="load"></button>' +
        '<button type="button" class="btn btn-secondary btn-sm" data-action="download"></button></div>';
      container.querySelector('.save-list').append(card);
    }
  }
  /** Screenshot of a save, or a short placeholder while it loads or when the save has none. */
  function showThumb(box, save, empty) {
    const image = box.querySelector('img'), label = box.querySelector('span');
    const source = save ? thumbs.get(save.hash) ?? '' : '';
    if (source && image.getAttribute('src') !== source) image.src = source;
    image.hidden = !source;
    label.hidden = !!source;
    label.textContent = !save ? empty : save.thumb ? text('Carregando imagem…', 'Loading image…') : text('Sem imagem', 'No image');
  }
  function renderSaves(container) {
    // Cards are updated in place so a focused button survives frequent renders.
    if (!savesAvailable()) return;
    const en = api.viewer.locale === 'en';
    for (const card of container.querySelectorAll('.save-card')) {
      const id = Number(card.dataset.slot), save = saves.find(entry => entry.slot === id);
      const [saveButton, loadButton, downloadButton] = card.querySelectorAll('button');
      card.querySelector('.save-name').textContent = slotTitle(id, en);
      // Every listed save is this player's own: the time is enough.
      card.querySelector('.save-meta').textContent = save ? clock(save.savedAt, en)
        : id === AUTOSAVE ? text('A cada 2 min de partida', 'Every 2 min of play') : text('Vazio', 'Empty');
      showThumb(card.querySelector('.save-thumb'), save, id === AUTOSAVE ? text('Nenhum ainda', 'None yet') : text('Vazio', 'Empty'));
      saveButton.hidden = id === AUTOSAVE || !started;
      saveButton.disabled = saving.has(id) || !nesSynchronized || asking();
      saveButton.textContent = saving.has(id) ? text('Salvando…', 'Saving…') : save ? text('Sobrescrever', 'Overwrite') : text('Salvar', 'Save');
      // Overwriting is quieter than filling an empty slot, to avoid replacing a save by accident.
      saveButton.className = 'btn btn-sm ' + (save ? 'btn-secondary' : 'btn-primary');
      loadButton.hidden = slot !== 0 || !save;
      loadButton.disabled = !!pendingAction;
      loadButton.textContent = text('Carregar', 'Load');
      downloadButton.hidden = !save;
      downloadButton.textContent = text('Baixar', 'Download');
      card.querySelector('.save-actions').hidden = saveButton.hidden && loadButton.hidden && downloadButton.hidden;
    }
    container.querySelector('.saves-notice').textContent = savesNotice();
    const file = container.querySelector('.file-field');
    file.hidden = slot !== 0;
    file.querySelector('input').disabled = !!pendingAction;
    file.querySelector('.btn').textContent = text('Carregar arquivo', 'Load file');
    file.querySelector('.file-hint').textContent = text('Save baixado antes (.monkynes)', 'A downloaded save (.monkynes)');
  }
  function savesNotice() {
    if (storageStatus === 'granted') return text(
      'Só você vê seus saves. Eles ficam guardados neste computador (Configurações do bot → Armazenamento), e Baixar continua disponível.',
      'Only you see your saves. They are kept on this computer (Bot settings → Storage), and Download remains available.');
    return text('Só você vê seus saves. Eles ficam na memória do bot até a sessão terminar (30 min depois que todos saírem); use Baixar para continuar outro dia.' +
      (storage ? ' Para guardá-los neste computador, permita o armazenamento ao abrir o miniapp ou em Configurações do bot → Armazenamento.' : ''),
    'Only you see your saves. They stay in the bot’s memory until the session ends (30 min after everyone leaves); use Download to continue another day.' +
      (storage ? ' To keep them on this computer, allow storage when opening the miniapp or in Bot settings → Storage.' : ''));
  }
  const validThumbnail = value => typeof value === 'string' && value.length <= MAX_THUMBNAIL &&
    /^data:image\/(?:png|webp|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value) ? value : '';
  /** Fetches missing screenshots of the visible saves and forgets the ones no longer listed. */
  function syncThumbnails() {
    const visible = [...saves, baseInfo].filter(save => save?.hash);
    const keep = new Set(visible.map(save => save.hash));
    for (const key of thumbs.keys()) if (!keep.has(key)) thumbs.delete(key);
    for (const key of thumbRequests) if (!keep.has(key)) thumbRequests.delete(key);
    if (config.game !== 'nes' || slot === null) return;
    for (const save of visible) {
      if (!save.thumb || thumbs.has(save.hash) || thumbRequests.has(save.hash)) continue;
      thumbRequests.add(save.hash);
      send({ type: 'thumbnail', hash: save.hash });
    }
  }
  /** The host's screen at the saved frame, small enough to travel inside the save. */
  function screenshot() {
    try {
      for (const [type, quality] of [['image/png'], ['image/webp', .8]]) {
        const image = validThumbnail(canvas.toDataURL(type, quality));
        if (image.startsWith('data:' + type)) return image;
      }
    } catch (error) { console.warn('[games] Save screenshot failed.', error); }
    return '';
  }
  function askConfirm(action) {
    pendingAction = action;
    confirmReturn = document.activeElement;
    render();
    get('confirm-no').focus();
  }
  function restoreFocus(target, fallback) {
    (target?.isConnected && target.getClientRects().length ? target : fallback).focus();
  }
  function cancelConfirm() {
    if (!pendingAction) return;
    pendingAction = null;
    render();
    restoreFocus(confirmReturn, started ? canvas : get('controls').querySelector('button:not([hidden])') ?? canvas);
    confirmReturn = null;
  }
  function toggleSaves() {
    if (!savesOpen && (!savesAvailable() || pendingAction)) return;
    savesOpen = !savesOpen;
    if (savesOpen) { menuOpen = false; releaseKeys(); }
    render();
    if (savesOpen) get('saves-close').focus();
    else restoreFocus(started ? canvas : get('saves-lobby'), canvas);
  }
  const closeSaves = () => { if (savesOpen) toggleSaves(); };
  function closeMenu() {
    if (menuOpen) toggleMenu();
  }
  /** Esc and backdrop clicks close the topmost dialog first; the save question only goes back a step. */
  function closeDialog() {
    if (asking()) {
      if (question.step === 'slot') { question.step = 'ask'; render(); get('save-question-yes').focus(); }
    } else if (pendingAction) cancelConfirm();
    else if (savesOpen) closeSaves();
    else closeMenu();
  }
  // ── Save question when the miniapp closes ─────────────────────────────────
  /** Whether this player is answering the save question; it covers every other dialog. */
  const asking = () => !!question && question.step !== 'done';
  /** Only players with a running, synchronized game have a state to save. */
  const canAskToSave = () => config.game === 'nes' && slot !== null && started && !ended && !!nes && nesSynchronized;
  // Players who answered the current closing, so whoever ends the miniapp knows when nobody is left deciding.
  const closingAnswered = new Set();
  /**
   * Asks this player whether to save the game state; yes picks one of their slots. `kind` is `self` when this
   * player is closing, `closing` when another player is, and `stopped` when another player already left.
   */
  function askToSave(kind, { reason = 'leave', nickname = '', shot = null } = {}) {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    question = { kind, reason, nickname, shot, self: kind === 'self', step: 'ask', choice: null, promise, resolve };
    menuOpen = false;
    savesOpen = false;
    pendingAction = null;
    releaseMouse();
    render();
    get('save-question-yes').focus();
    return promise;
  }
  /** The frozen game state, or the one captured before the emulator was released. */
  const questionShot = current => nes && nesSynchronized && !ended ? snapshot() : current.shot;
  async function answerQuestion(id) {
    const current = question;
    if (!current || !['ask', 'slot'].includes(current.step)) return;
    if (id !== null) {
      current.step = 'saving';
      render();
      const shot = questionShot(current);
      if (shot) await keepSave(id, shot, { closing: true });
      current.choice = 'save';
    } else current.choice = 'skip';
    if (question !== current) return;
    // The closer who ends the miniapp for everyone waits for this answer.
    if (current.kind !== 'stopped') {
      try { if (started && !ended) send({ type: 'closing-done', round }); } catch { /* the game connection already closed */ }
    }
    current.step = current.self && current.reason === 'end' ? 'waiting' : 'done';
    settleQuestion();
    render();
  }
  /** Ending for everyone waits until the other players answered or left; Monky's "End now" skips the wait. */
  function settleQuestion() {
    const current = question;
    if (!current || current.step === 'ask' || current.step === 'slot' || current.step === 'saving') return;
    if (current.step === 'waiting' && peers.some(peer => peer.slot !== null && peer.uid !== uid && !closingAnswered.has(peer.uid))) return;
    current.step = 'done';
    current.resolve();
  }
  function questionContext(current) {
    const name = current.nickname;
    if (current.step === 'waiting') {
      const names = peers.filter(peer => peer.slot !== null && peer.uid !== uid && !closingAnswered.has(peer.uid)).map(peer => peer.nickname).join(', ');
      return text(`Aguardando ${names} decidir se salva o jogo.`, `Waiting for ${names} to decide whether to save.`);
    }
    if (current.kind === 'self') return current.reason === 'end'
      ? text('Você está encerrando o NES para todos.', 'You are ending the NES for everyone.')
      : text('Você está saindo do NES.', 'You are leaving the NES.');
    if (current.kind === 'closing') return current.reason === 'end'
      ? text(`${name} está encerrando o NES para todos.`, `${name} is ending the NES for everyone.`)
      : text(`${name} está saindo do NES; a partida vai parar.`, `${name} is leaving the NES; the game will stop.`);
    return name ? text(`${name} saiu do NES, e a partida parou.`, `${name} left the NES, and the game stopped.`)
      : text('Um jogador saiu do NES, e a partida parou.', 'A player left the NES, and the game stopped.');
  }
  function buildQuestionSlots() {
    const list = get('save-question-slots');
    for (const id of PLAYER_SLOTS) {
      const card = document.createElement('article');
      card.className = 'save-card';
      card.dataset.slot = String(id);
      card.innerHTML = '<div class="save-thumb"><img alt="" hidden><span></span></div>' +
        '<div class="save-info"><span class="save-name"></span><span class="save-meta"></span></div>' +
        '<div class="save-actions"><button type="button" class="btn btn-sm"></button></div>';
      list.append(card);
    }
  }
  function renderQuestion() {
    const dialog = get('save-question');
    dialog.hidden = !asking();
    if (dialog.hidden) return;
    const current = question, en = api.viewer.locale === 'en', choosing = current.step === 'slot' || current.step === 'saving';
    get('save-question-title').textContent = current.step === 'waiting'
      ? text('Aguardando os outros jogadores', 'Waiting for the other players') : text('Quer salvar o estado do jogo?', 'Save the game state?');
    get('save-question-context').textContent = questionContext(current) +
      (current.step === 'slot' ? text(' Escolha um slot.', ' Choose a slot.') : '');
    const list = get('save-question-slots');
    list.hidden = !choosing;
    for (const card of list.querySelectorAll('.save-card')) {
      const id = Number(card.dataset.slot), save = saves.find(entry => entry.slot === id), button = card.querySelector('button');
      card.querySelector('.save-name').textContent = slotTitle(id, en);
      card.querySelector('.save-meta').textContent = save ? clock(save.savedAt, en) : text('Vazio', 'Empty');
      showThumb(card.querySelector('.save-thumb'), save, text('Vazio', 'Empty'));
      button.disabled = current.step === 'saving';
      button.textContent = current.step === 'saving' ? text('Salvando…', 'Saving…')
        : save ? text('Sobrescrever', 'Overwrite') : text('Salvar aqui', 'Save here');
      button.className = 'btn btn-sm ' + (save ? 'btn-secondary' : 'btn-primary');
    }
    get('save-question-note').textContent = current.step === 'waiting'
      ? text('Para não esperar, use Encerrar agora no cartão do miniapp.', 'To stop waiting, use End now on the miniapp card.')
      : storageStatus === 'granted' ? text('O save fica guardado neste computador.', 'The save is kept on this computer.')
        : text('Sem permissão para guardar neste computador, o save escolhido é baixado como arquivo.',
          'Without permission to keep it on this computer, the chosen save is downloaded as a file.');
    const no = get('save-question-no'), yes = get('save-question-yes');
    no.hidden = current.step === 'waiting';
    no.disabled = yes.disabled = current.step === 'saving';
    no.textContent = choosing ? text('Voltar', 'Back') : text('Não salvar', 'Don’t save');
    yes.hidden = current.step !== 'ask';
    yes.textContent = text('Salvar', 'Save');
  }
  /** Monky asks before this person leaves or ends the miniapp: the game freezes and every player is asked. */
  function beforeClose({ reason }) {
    if (config.game !== 'nes') return;
    if (!canAskToSave() && !asking()) return;
    try { if (canAskToSave()) send({ type: 'closing', reason, round }); } catch { /* the game connection already closed */ }
    if (asking()) {
      // Answering another player's question also answers this close.
      question.self = true;
      question.reason = reason;
      if (question.kind === 'closing') question.kind = 'self';
    } else void askToSave('self', { reason, shot: snapshot() });
    frozen = true;
    syncHostLoop();
    render();
    return question.promise;
  }
  /**
   * Runs on every close, hidden and muted, for at most 5 seconds. Without an answer (left the room, someone else
   * ended it, or "Close now") the Automático keeps the game state when this person allowed storage.
   */
  async function viewClosed() {
    if (config.game !== 'nes') return;
    stopHostLoop();
    const current = question;
    const shot = current?.choice || slot === null ? null : canAskToSave() ? snapshot() : current?.shot;
    if (shot) await storeAutosave(shot);
    // Leaving now stops the game for the others at once instead of when Monky discards this document.
    socket?.close();
  }
  /** Only the host's view matters: it produces every frame, so the game pauses while the host cannot see it. */
  function visibility(visible) {
    hostVisible = visible;
    if (config.game !== 'nes' || slot !== 0 || !started || ended) return;
    reportVisibility(visible);
    syncHostLoop();
  }
  function reportVisibility(visible) {
    try { if (socket?.readyState === WebSocket.OPEN) send({ type: visible ? 'unpause' : 'pause', round }); }
    catch (error) { console.warn('[games] Could not report the host visibility.', error); }
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
  const base64 = bytes => {
    const data = new Uint8Array(bytes);
    let binary = '';
    for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
    return btoa(binary);
  };
  const fromBase64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
  async function gzip(value) {
    return new Uint8Array(await new Response(new Blob([value]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  }
  async function gunzip(bytes) {
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_SAVE_JSON) {
        await reader.cancel();
        throw new Error(text('O save é grande demais.', 'The save is too large.'));
      }
      chunks.push(value);
    }
    return new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
  }
  /** Save file format v1: also the unit a future Monky per-bot storage can keep as-is. */
  const saveEnvelope = (state, thumbnail) => '{"format":"' + SAVE_FORMAT + '","version":1,"emulator":' + JSON.stringify(emulator) +
    ',"romHash":"' + hash + '","romName":' + JSON.stringify(romName) + ',"savedAt":' + Date.now() +
    (thumbnail ? ',"thumbnail":' + JSON.stringify(thumbnail) : '') + ',"state":' + state + '}';
  async function readSave(bytes) {
    if (bytes.length > MAX_SAVE_BYTES) throw new Error(text('O arquivo de save é grande demais.', 'The save file is too large.'));
    let value, contents;
    try {
      contents = await gunzip(bytes);
      value = JSON.parse(contents);
    } catch { throw new Error(text('Arquivo de save inválido.', 'Invalid save file.')); }
    const plain = item => item !== null && typeof item === 'object' && !Array.isArray(item);
    // Same checks as the bot, so a file the miniapp accepts is never refused later.
    if (value?.format !== SAVE_FORMAT || value.version !== 1 || typeof value.savedAt !== 'number' ||
        value.romName !== undefined && typeof value.romName !== 'string' || !plain(value.state) ||
        !['cpu', 'mmap', 'ppu', 'papu'].every(key => plain(value.state[key]))) {
      throw new Error(text('Arquivo de save inválido.', 'Invalid save file.'));
    }
    if (value.emulator !== emulator) throw new Error(text(
      `Este save foi criado com outra versão do emulador (${value.emulator}); esta sessão usa ${emulator}.`,
      `This save was created with another emulator version (${value.emulator}); this session uses ${emulator}.`));
    if (value.romHash !== hash) throw new Error(text('Este save é de outra ROM. Escolha a mesma ROM usada ao salvar.',
      'This save belongs to another ROM. Choose the ROM used when saving.'));
    return value;
  }
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
      void restoreSaves();
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
        romName = file.name.slice(0, 80);
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
  let nesCanvas;
  /** Fresh emulator from the ROM plus a state: the shared base by default, or a checkpoint. */
  function createNes(state) {
    if (state === undefined) {
      state = baseText ? JSON.parse(baseText).state : null;
      nesBase = baseHash;
    }
    if (!nesCanvas || canvas.width !== 256 || canvas.height !== 240) {
      canvas.width = 256;
      canvas.height = 240;
      const context = canvas.getContext('2d');
      const image = context.createImageData(256, 240);
      nesCanvas = { context, image, pixels: new Uint32Array(image.data.buffer) };
    }
    const { context, image, pixels } = nesCanvas;
    nes = new window.jsnes.NES({
      onFrame(buffer) {
        for (let i = 0; i < buffer.length; i++) pixels[i] = 0xff000000 | buffer[i];
        context.putImageData(image, 0, 0);
      },
      onAudioSample: pushAudio, sampleRate: 48000,
    });
    nes.loadROM(gameData);
    // fromJSON keeps plain arrays by reference, so each restore needs a freshly parsed state.
    if (state) nes.fromJSON(state);
    sinceCheckpoint = 0;
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
  function applyFrame(frame) {
    nesFrame([frame[0], frame[1]]);
    sinceCheckpoint++;
    if (frame[2] !== 1) return;
    const state = checkpoint();
    // The host's checkpoint is every player's Automático; each keeps it on their own computer.
    if (slot !== null && slot !== 0 && !catchingUp) void storeAutosave({ state, thumbnail: screenshot() });
  }
  /** Autosave marker: every viewer continues from the same serialized state late viewers will load. */
  function checkpoint() {
    const state = JSON.stringify(nes.toJSON());
    createNes(JSON.parse(state));
    return state;
  }
  const autosaveFrames = () => Number.isInteger(config.autosaveFrames) && config.autosaveFrames > 0 ? config.autosaveFrames : 7200;
  /** This player's emulator state and screen, captured together. */
  const snapshot = () => ({ state: JSON.stringify(nes.toJSON()), thumbnail: screenshot() });
  /** A save envelope small enough to send; the screenshot is dropped rather than the save when a state is large. */
  async function pack({ state, thumbnail }) {
    let data = await gzip(saveEnvelope(state, thumbnail));
    if (data.length > MAX_SAVE_BYTES && thumbnail) data = await gzip(saveEnvelope(state, ''));
    if (data.length > MAX_SAVE_BYTES) throw new Error(text('O save ficou grande demais.', 'The save is too large.'));
    return data;
  }
  const storageKey = (romHash, id) => `nes/${romHash}/${id === AUTOSAVE ? 'auto' : 'slot-' + id}`;
  /**
   * Keeps one of this player's saves on this computer when they allowed it. Saves they asked for report
   * failures; autosaves never interrupt the game (Monky itself warns when storage is nearly full).
   */
  async function storeSave(id, data) {
    if (!hash) return false;
    const key = storageKey(hash, id);
    ownSaves.set(key, data);
    if (storageStatus !== 'granted') return false;
    try {
      return await storage.set(key, data, id === AUTOSAVE ? { autosave: true } : undefined);
    } catch (error) {
      console.warn('[games] Could not keep the save on this computer.', error);
      if (id !== AUTOSAVE) toast(...storageFailure(error), true);
      return false;
    }
  }
  function storageFailure(error) {
    return error?.reason === 'quota'
      ? ['O armazenamento do bot neste computador está cheio. Libere espaço em Configurações do bot → Armazenamento.',
        'The bot’s storage on this computer is full. Free some space in Bot settings → Storage.']
      : ['Não foi possível guardar o save neste computador.', 'Could not keep the save on this computer.'];
  }
  async function storeAutosave(shot) {
    try { await storeSave(AUTOSAVE, await pack(shot)); }
    catch (error) { console.warn('[games] Autosave was not kept on this computer.', error); }
  }
  /** Keeps a save in this player's own slot for the session; resolves whether the bot accepted it. */
  function sendKeep(id, data) {
    keeping.get(id)?.(false);
    return new Promise(resolve => {
      const timer = setTimeout(() => finish(false), 10000);
      const finish = accepted => { clearTimeout(timer); if (keeping.get(id) === finish) keeping.delete(id); resolve(accepted); };
      keeping.set(id, finish);
      try { send({ type: 'keep', slot: id, data: base64(data) }); }
      catch { finish(false); }
    });
  }
  /**
   * Saves this player's own state in one of their slots: in the bot's memory for the session and, with
   * permission, on this computer. When closing without permission the file is downloaded instead.
   */
  async function keepSave(id, shot, { closing = false } = {}) {
    saving.add(id);
    render();
    try {
      const data = await pack(shot);
      const [kept, stored] = await Promise.all([sendKeep(id, data), storeSave(id, data)]);
      if (closing && !stored) {
        downloadFile(data, id, Date.now());
        toast('Download do save iniciado.', 'Save download started.');
      } else if (stored) toast(`Salvo no ${slotName(id, false)} neste computador.`, `Saved to ${slotName(id, true)} on this computer.`);
      else if (kept) toast(`Salvo no ${slotName(id, false)} nesta sessão.`, `Saved to ${slotName(id, true)} for this session.`);
      else toast('Não foi possível salvar agora. Tente novamente.', 'Could not save right now. Try again.', true);
      return kept || stored || closing;
    } catch (error) {
      console.warn('[games] Save failed.', error);
      toast('Não foi possível salvar. ' + error.message, 'Could not save. ' + error.message, true);
      return false;
    } finally {
      saving.delete(id);
      render();
    }
  }
  /** Rejects saves that the current ROM and emulator cannot run, before anyone loads them. */
  function trialLoad(state) {
    const trial = new window.jsnes.NES({ emulateSound: false });
    trial.loadROM(gameData);
    trial.fromJSON(state);
    trial.frame();
  }
  const canRestore = () => config.game === 'nes' && storageStatus === 'granted' && slot !== null && prepared &&
    !!gameData && !!hash && !!emulator && restoredFor !== hash && !ended;
  /** Brings this player's saves of the chosen ROM back from this computer into their slots. */
  async function restoreSaves() {
    if (!canRestore()) return;
    const romHash = restoredFor = hash;
    try {
      let restored = 0, skipped = 0;
      for (const { key } of await storage.list({ prefix: `nes/${romHash}/` })) {
        const match = /^nes\/[a-f0-9]{64}\/(auto|slot-[1-3])$/.exec(key);
        if (!match) continue;
        const value = await storage.get(key);
        if (hash !== romHash || ended) return;
        if (!(value instanceof ArrayBuffer)) continue;
        const bytes = new Uint8Array(value);
        let save;
        try {
          save = await readSave(bytes);
          trialLoad(save.state);
        } catch (error) {
          console.warn('[games] Ignored a save kept on this computer.', key, error);
          skipped++;
          continue;
        }
        const image = validThumbnail(save.thumbnail), checksum = await digest(bytes);
        if (image) { thumbs.set(checksum, image); thumbRequests.add(checksum); }
        send({ type: 'restore', slot: match[1] === 'auto' ? AUTOSAVE : Number(match[1].slice(5)), data: base64(bytes) });
        restored++;
      }
      if (restored) toast(slot === 0 && !started
        ? 'Seus saves guardados desta ROM estão em Saves. Carregue um para retomar.'
        : 'Seus saves guardados desta ROM estão em Saves.',
      slot === 0 && !started ? 'Your kept saves of this ROM are in Saves. Load one to resume.' : 'Your kept saves of this ROM are in Saves.');
      else if (skipped) toast('Saves guardados de outra versão do emulador foram ignorados.', 'Kept saves from another emulator version were skipped.');
    } catch (error) {
      if (restoredFor === romHash) restoredFor = '';
      console.warn('[games] Could not read the saves kept on this computer.', error);
    }
  }
  /** Once storage is allowed during a session, the saves this player made in this view are kept too. */
  async function flushOwnSaves() {
    for (const [key, data] of ownSaves) {
      if (storageStatus !== 'granted') return;
      try { await storage.set(key, data, key.endsWith('/auto') ? { autosave: true } : undefined); }
      catch (error) { console.warn('[games] Could not keep an earlier save on this computer.', error); }
    }
  }
  function upload(message, state, thumbnail) {
    uploads = uploads.then(async () => {
      const data = await pack({ state, thumbnail });
      // The host keeps its own Automático; the bot makes the same checkpoint every player's Automático.
      void storeSave(AUTOSAVE, data);
      // Saves are large: let the previous one drain so frame messages keep their connection budget.
      for (let attempt = 0; socket?.bufferedAmount > 64 * 1024; attempt++) {
        if (attempt >= 50) throw new Error(text('Conexão ocupada; o save não foi enviado.', 'Connection busy; the save was not sent.'));
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (ended || message.round !== round) return;
      send({ ...message, data: base64(data) });
    }).catch(error => console.warn('[games] Autosave upload failed.', error));
  }
  function requestSave(id) {
    if (!started || slot === null || !nes || !nesSynchronized || saving.has(id) || !PLAYER_SLOTS.includes(id) || asking()) return;
    void keepSave(id, snapshot());
  }
  function chooseLoad(id) {
    if (slot !== 0 || pendingAction || !saves.some(save => save.slot === id)) return;
    const action = { type: 'load', slot: id };
    if (started || canResume) askConfirm(action);
    else { send({ ...action, round }); closeSaves(); }
  }
  function requestDownload(id) {
    if (slot !== null && saves.some(save => save.slot === id)) send({ type: 'download', slot: id });
  }
  function downloadFile(bytes, id, savedAt, name = romName) {
    const time = new Date(savedAt), pad = number => String(number).padStart(2, '0');
    const file = [(name || 'NES').replace(/\.nes$/i, ''),
      id === AUTOSAVE ? text('automático', 'autosave') : 'slot ' + id,
      `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}-${pad(time.getMinutes())}`].join(' - ');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    link.download = file.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 150) + '.monkynes';
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 60000);
  }
  const downloadSave = value => downloadFile(fromBase64(value.data), value.slot, Date.now() - value.age, value.romName);
  async function importSave(input) {
    const file = input.files[0];
    input.value = '';
    if (!file || slot !== 0 || !prepared || !gameData || pendingAction) return;
    if (file.size > MAX_SAVE_BYTES) throw new Error(text('O arquivo de save é grande demais.', 'The save file is too large.'));
    const bytes = new Uint8Array(await file.arrayBuffer());
    const value = await readSave(bytes);
    // A throwaway emulator rejects unusable files before anyone else loads them.
    trialLoad(value.state);
    if (ended || slot !== 0 || pendingAction) return;
    // The preview only feeds the confirmation; the server reads the screenshot from the file itself.
    const action = { type: 'import', data: base64(bytes), preview: validThumbnail(value.thumbnail) };
    if (started || canResume) askConfirm(action);
    else { send({ type: 'import', data: action.data, round }); closeSaves(); }
  }
  function catchUp() {
    if (ended) return;
    try {
      const end = Math.min(replay.length, replayIndex + 120);
      while (replayIndex < end) applyFrame(replay[replayIndex++]);
      if (replayIndex < replay.length) { loop = setTimeout(catchUp, 0); return; }
      replay = [];
      replayIndex = 0;
      catchingUp = false;
      nesSynchronized = true;
      syncHostLoop();
      show(slot === null ? 'Assistindo à partida.' : 'Partida em andamento.', slot === null ? 'Watching the game.' : 'Game in progress.');
      render();
    } catch (error) { stop(); fail(error); }
  }
  /** The host runs the frame loop only while it sees the game and nobody is being asked to save. */
  function syncHostLoop() {
    const run = config.game === 'nes' && slot === 0 && started && !!nes && nesSynchronized && !ended && hostVisible && !frozen;
    if (run && !hostLoop) startNesLoop();
    else if (!run && hostLoop) stopHostLoop();
  }
  function stopHostLoop() {
    clearInterval(hostLoop);
    hostLoop = undefined;
  }
  function startNesLoop() {
    hostLoop = setInterval(() => {
      try {
        const masks = [buttons, remoteButtons[1]];
        nesFrame(masks);
        if (++sinceCheckpoint < autosaveFrames()) {
          send({ type: 'frames', frames: [masks], round });
          return;
        }
        const id = ++checkpointId;
        send({ type: 'frames', frames: [[...masks, 1]], round, checkpoint: id });
        const image = screenshot();
        upload({ type: 'state', slot: AUTOSAVE, round, checkpoint: id }, checkpoint(), image);
      } catch (error) { stop(); fail(error); }
    }, 1000 / 60);
  }
  async function play(resume = false) {
    if (!prepared || config.game === 'doom' && slot === null && !watchingDoom) return;
    const playingRound = round;
    // Engines need a laid-out canvas; the lobby keeps it hidden until a game starts.
    canvas.classList.remove('blank');
    if (slot !== null) canvas.focus();
    if (config.game === 'doom') await runDoom(slot === null);
    else {
      resumeAudio();
      createNes();
      nesSynchronized = slot === 0 && !resume;
      if (nesSynchronized) syncHostLoop();
      else send({ type: 'watch', hash, round });
      // A host that starts the round out of view starts it paused.
      if (slot === 0 && !hostVisible) reportVisibility(false);
    }
    if (ended || !started || playingRound !== round) return;
    show('Partida em andamento.', 'Game in progress.');
    render();
  }
  async function runDoom(spectator) {
    const generation = doomGeneration, playingRound = round;
    canvas.classList.remove('blank');
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
    stopHostLoop();
    frozen = false;
    pauseInfo = null;
    closingInfo = null;
    buttons = 0;
    remoteButtons = [0, 0];
    down.clear();
    replay = [];
    replayIndex = 0;
    catchingUp = false;
    nesSynchronized = false;
    nes = undefined;
    menuOpen = false;
    savesOpen = false;
    pendingAction = null;
    saving.clear();
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
    if (!started || !(engine || nes) || asking()) return;
    menuOpen = !menuOpen;
    savesOpen = false;
    pendingAction = null;
    releaseMouse();
    render();
    if (menuOpen) get('menu-close').focus();
    else canvas.focus();
  }
  function stop() {
    if (ended) return;
    ended = true;
    started = false;
    canvas.classList.add('blank');
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
    if (event.code === 'Escape' && (asking() || pendingAction || savesOpen || menuOpen)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (pressed && !event.repeat) closeDialog();
      return;
    }
    if (!started) return;
    if (event.code === (config.game === 'doom' ? 'F2' : 'Escape')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (pressed && !event.repeat) toggleMenu();
      return;
    }
    if (menuOpen || savesOpen || pendingAction || asking() || event.target instanceof Element && event.target.closest('button,input,a')) {
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
    if (disposed) return;
    if (event.data instanceof ArrayBuffer) {
      if (ended) return;
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
    // After the game stopped, only the bot's answer to this player's last save still matters.
    if (ended && !(value.type === 'saved' || value.type === 'unavailable' && value.action === 'keep')) return;
    if (value.type === 'challenge') {
      const proof = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey,
        new TextEncoder().encode(config.roomId + ':' + value.challenge));
      abort.signal.throwIfAborted();
      send({ type: 'authenticate', key: publicKey, proof: base64(proof) });
    } else if (value.type === 'authenticated') {
      uid = value.uid;
      emulator = value.emulator ?? '';
      show('Conectado. Aguardando os jogadores.', 'Connected. Waiting for the players.');
    } else if (value.type === 'lobby') {
      peers = value.peers;
      const previousSlot = slot;
      slot = peers.find(peer => peer.uid === uid)?.slot ?? null;
      started = value.started;
      round = value.round;
      canResume = value.canResume;
      resumeFrom = value.resumeFrom ?? null;
      saves = (value.saves ?? []).map(save => ({ ...save, savedAt: Date.now() - save.age }));
      baseInfo = value.base ? { ...value.base, savedAt: Date.now() - value.base.age } : null;
      const host = peers.find(peer => peer.slot === 0);
      pauseInfo = value.paused && host ? { nickname: host.nickname } : null;
      syncThumbnails();
      settleQuestion();
      render();
      if (slot !== null && !started) {
        if (prepared && previousSlot === null) send({ type: 'ready', hash });
        else if (!prepared && !loading && !uploading && !prepareFailed && config.game === 'doom') {
          void prepare().catch(fail);
        }
      }
      if (slot !== null && previousSlot === null) void restoreSaves();
      if (config.game === 'nes' && started && prepared && !nes) await play();
    } else if (value.type === 'rom') {
      if (config.game !== 'nes' || typeof value.hash !== 'string' || !/^[a-f0-9]{64}$/.test(value.hash)) throw new Error('Invalid ROM announcement');
      incomingHash = value.hash;
    } else if (value.type === 'base') {
      if (config.game !== 'nes') return;
      // Ordered before any round that uses it; existing emulators keep running until that round starts.
      baseText = value.hash ? await gunzip(fromBase64(value.data)) : '';
      baseHash = value.hash || '';
      baseInfo = value.hash ? { slot: value.slot, nickname: value.nickname, savedAt: Date.now() - value.age, hash: value.hash, thumb: !!value.thumb } : null;
      render();
    } else if (value.type === 'start' || value.type === 'resume') {
      if (config.game === 'nes' && (value.base ?? '') !== baseHash) {
        throw new Error(text('O estado da partida não chegou a este miniapp. Reabra-o.', 'The game state did not reach this miniapp. Reopen it.'));
      }
      if (config.game === 'nes') resetNes();
      else resetDoom();
      // A question about a closing that did not happen belongs to the previous round.
      if (question && !question.self) question = null;
      closingAnswered.clear();
      round = value.round;
      canResume = false;
      started = true;
      if (config.game === 'nes' && value.type === 'start' && baseInfo && slot !== null) {
        const pt = `${slotName(baseInfo.slot, false)} (${describeSave(baseInfo, false)})`;
        const en = `${slotName(baseInfo.slot, true)} (${describeSave(baseInfo, true)})`;
        toast(`Save carregado para todos: ${pt}.`, `Save loaded for everyone: ${en}.`);
      }
      await play(value.type === 'resume');
      render();
    } else if (value.type === 'reset-lobby') {
      started = false;
      round = value.round;
      canvas.classList.add('blank');
      if (config.game === 'nes') resetNes();
      else resetDoom();
      if (question && !question.self) question = null;
      closingAnswered.clear();
      show('De volta ao lobby. Aguardando o host.', 'Back in the lobby. Waiting for the host.');
      render();
    } else if (value.type === 'input' && value.round === round) remoteButtons[value.slot] = value.buttons;
    else if (value.type === 'frames') {
      if (value.round !== round) return;
      if (catchingUp) replay.push(...value.frames);
      else if (nes && nesSynchronized) for (const frame of value.frames) applyFrame(frame);
    } else if (value.type === 'replay') {
      if (value.round !== round) return;
      if (nes && !nesSynchronized && !catchingUp) {
        if ((value.base ?? '') !== baseHash) {
          throw new Error(text('O estado da partida não chegou a este miniapp. Reabra-o.', 'The game state did not reach this miniapp. Reopen it.'));
        }
        // A checkpoint may have replaced the base after this emulator was created.
        if (nesBase !== baseHash) createNes();
        replay = value.frames;
        replayIndex = 0;
        catchingUp = true;
        show('Sincronizando a partida...', 'Synchronizing the game...');
        catchUp();
      }
    } else if (value.type === 'paused' || value.type === 'unpaused') {
      if (value.round !== round) return;
      pauseInfo = value.type === 'paused' ? { nickname: value.nickname } : null;
      render();
    } else if (value.type === 'closing') {
      if (value.round !== round || config.game !== 'nes') return;
      // Another player is leaving or ending: the host stops producing frames and this player is asked too.
      closingInfo = { uid: value.uid, nickname: value.nickname, reason: value.reason === 'end' ? 'end' : 'leave' };
      closingAnswered.delete(value.uid);
      frozen = true;
      syncHostLoop();
      if (value.uid !== uid && !asking() && canAskToSave()) void askToSave('closing', { reason: closingInfo.reason, nickname: value.nickname, shot: snapshot() });
      render();
    } else if (value.type === 'closing-answered') {
      if (value.round !== round) return;
      closingAnswered.add(value.uid);
      settleQuestion();
      render();
    } else if (value.type === 'closing-cancelled') {
      if (value.round !== round) return;
      // Nobody closed after all: the game goes on, unless this player is still answering their own close.
      closingInfo = null;
      closingAnswered.clear();
      // An answered question is over; only a close this player is still answering keeps the game frozen.
      if (question && (!question.self || !asking())) question = null;
      frozen = asking();
      syncHostLoop();
      render();
    } else if (value.type === 'saved') {
      const image = validThumbnail(value.thumbnail);
      if (image && typeof value.hash === 'string') { thumbs.set(value.hash, image); thumbRequests.add(value.hash); }
      if (value.slot === AUTOSAVE) { if (slot !== null && !ended) toast('Save automático feito.', 'Autosave done.'); }
      else keeping.get(value.slot)?.(true);
      render();
    } else if (value.type === 'thumbnail') {
      const image = validThumbnail(value.thumbnail);
      if (image && thumbRequests.has(value.hash)) { thumbs.set(value.hash, image); render(); }
    } else if (value.type === 'save-data') {
      downloadSave(value);
      toast('Download do save iniciado.', 'Save download started.');
    } else if (value.type === 'unavailable') {
      if (value.action === 'keep') keeping.get(value.slot)?.(false);
      else if (value.action === 'restore') console.warn('[games] The bot refused a save kept on this computer.', value.slot, value.reason);
      else if (value.action === 'state') console.warn('[games] The bot skipped an autosave.');
      else if (value.action === 'load' || value.action === 'import') {
        if (value.reason === 'invalid') toast('O bot recusou este arquivo de save.', 'The bot refused this save file.', true);
        else toast('Não foi possível carregar esse save agora.', 'Could not load that save right now.', true);
      } else if (value.action === 'download') {
        toast('Não foi possível baixar esse save agora.', 'Could not download that save right now.', true);
      } else show('A vaga ou a partida mudou. Aguarde o estado da sala e tente novamente.',
        'The seat or game has changed. Wait for the room state and try again.');
    } else if (value.type === 'mismatch') {
      if (config.game === 'nes' && prepared && hash === value.hash) return;
      prepareFailed = true;
      prepared = false;
      show('A ROM ainda não está sincronizada com a do host. Tente receber os arquivos novamente.',
        'The ROM is not synchronized with the host yet. Try receiving the files again.', true);
      render();
    }
    else if (value.type === 'stopped') {
      // The other player left: before the emulator is released, this player is asked whether to save.
      if (canAskToSave()) {
        const shot = snapshot();
        if (asking()) question.shot = shot;
        // Whoever already answered for this player's announced close is not asked again.
        else if (!(closingInfo && question?.step === 'done')) void askToSave('stopped', { nickname: typeof value.nickname === 'string' ? value.nickname : '', shot });
      }
      stop();
      if (config.game === 'nes') show('Um jogador saiu. Feche a visualização e abra novamente para continuar; os saves seguem disponíveis no lobby.',
        'A player left. Close this view and open it again to continue; saves remain available in the lobby.');
      else show('Um jogador saiu. Feche a visualização e abra novamente para iniciar outra partida.',
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
  get('menu-close').addEventListener('click', closeMenu);
  for (const id of ['saves-lobby', 'saves-toggle', 'menu-saves-open']) get(id).addEventListener('click', toggleSaves);
  get('saves-close').addEventListener('click', closeSaves);
  for (const id of ['game-menu', 'saves-modal', 'confirm-action']) {
    // Only a click that starts and ends on the dimmed area closes; drags out of the card do not.
    const backdrop = get(id);
    let pressed = false;
    backdrop.addEventListener('pointerdown', event => { pressed = event.target === backdrop; });
    backdrop.addEventListener('click', event => {
      if (pressed && event.target === backdrop) closeDialog();
      pressed = false;
    });
  }
  const savesList = get('menu-saves');
  buildSaves(savesList);
  buildQuestionSlots();
  get('save-question-yes').addEventListener('click', () => {
    if (question?.step !== 'ask') return;
    question.step = 'slot';
    render();
    get('save-question-slots').querySelector('button')?.focus();
  });
  get('save-question-no').addEventListener('click', () => {
    if (question?.step === 'slot') { question.step = 'ask'; render(); get('save-question-yes').focus(); }
    else void answerQuestion(null).catch(fail);
  });
  get('save-question-slots').addEventListener('click', event => {
    const card = event.target.closest('button') && event.target.closest('[data-slot]');
    if (card && question?.step === 'slot') void answerQuestion(Number(card.dataset.slot)).catch(fail);
  });
  savesList.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const id = Number(button.closest('[data-slot]').dataset.slot);
    try {
      if (button.dataset.action === 'save') requestSave(id);
      else if (button.dataset.action === 'load') chooseLoad(id);
      else requestDownload(id);
    } catch (error) { fail(error); }
  });
  savesList.addEventListener('change', event => {
    if (event.target.type === 'file') void importSave(event.target).catch(error => {
      toast('Não foi possível carregar o save. ' + error.message, 'Could not load the save. ' + error.message, true);
    });
  });
  for (const action of ['restart', 'return-lobby']) get(action).addEventListener('click', () => {
    if (slot !== 0 || !started) return;
    askConfirm({ type: action });
  });
  get('confirm-no').addEventListener('click', cancelConfirm);
  get('confirm-yes').addEventListener('click', () => {
    const action = pendingAction;
    const allowed = started ? ['restart', 'return-lobby', 'load', 'import'] : ['start', 'load', 'import'];
    if (slot !== 0 || !action || !allowed.includes(action.type)) return;
    const { preview, ...message } = action;
    try {
      send({ ...message, round });
      pendingAction = null;
      confirmReturn = null;
      // A save chosen in the lobby becomes the resume point shown there.
      if (!started) savesOpen = false;
      render();
      if (!started) restoreFocus(get('resume'), get('saves-lobby'));
    } catch (error) { fail(error); }
  });
  start.addEventListener('click', () => {
    if (slot !== 0 || started) return;
    if (canResume) askConfirm({ type: 'start' });
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
  // Device storage and the closing and visibility hooks exist only in newer Monky clients.
  const unsubscribeStorage = storage?.onStatus?.(status => {
    const before = storageStatus;
    storageStatus = status;
    if (status === 'granted' && before !== 'granted') { void flushOwnSaves(); void restoreSaves(); }
    render();
  });
  if (config.game === 'nes') {
    api.onBeforeClose?.(beforeClose);
    api.onClose?.(viewClosed);
    api.onVisibilityChange?.(visibility);
  }
  window.addEventListener('error', event => { fail(event.error ?? new Error(event.message)); stop(); });
  window.addEventListener('unhandledrejection', event => { fail(event.reason); stop(); });
  window.addEventListener('pagehide', () => {
    disposed = true;
    clearInterval(renewal);
    unsubscribe();
    unsubscribeStorage?.();
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
