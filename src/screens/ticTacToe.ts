export interface Player { id: string; nickname: string }
export interface GameState {
  revision: number;
  locale: 'pt-BR' | 'en';
  players: Player[];
  board: ('X' | 'O' | null)[];
  turn: 'X' | 'O';
  winner: 'X' | 'O' | 'draw' | null;
}
export interface GameAction {
  userId: string;
  userNickname: string;
  action: string;
  payload: unknown;
  revision: number;
}

export function newGame(player: Player, locale: 'pt-BR' | 'en'): GameState {
  return { revision: 0, locale, players: [{ ...player }], board: Array.from({ length: 9 }, () => null), turn: 'X', winner: null };
}

const LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];

/** Identity and revision come from the server event, never from iframe payloads. */
export function gameAction(state: GameState, action: GameAction): GameState | null {
  if (action.revision !== state.revision || !action.userId || state.winner !== null) return null;
  if (action.action === 'join') {
    if (state.players.length !== 1 || state.players.some((player) => player.id === action.userId)) return null;
    return { ...state, revision: state.revision + 1, players: [...state.players, { id: action.userId, nickname: action.userNickname.slice(0, 80) }] };
  }
  if (action.action !== 'move' || state.players.length !== 2 || typeof action.payload !== 'object' ||
      action.payload === null || !('position' in action.payload)) return null;
  const position = action.payload.position;
  const player = state.players[state.turn === 'X' ? 0 : 1];
  if (player.id !== action.userId || typeof position !== 'number' || !Number.isInteger(position) ||
      position < 0 || position > 8 || state.board[position] !== null) return null;
  const board = [...state.board];
  board[position] = state.turn;
  const won = LINES.some((line) => line.every((index) => board[index] === state.turn));
  return {
    ...state, revision: state.revision + 1, board, turn: state.turn === 'X' ? 'O' : 'X',
    winner: won ? state.turn : board.every((cell) => cell !== null) ? 'draw' : null,
  };
}

export const ticTacToeHtml = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
:root{color-scheme:dark;font:16px system-ui;color:#f5f5fa;background:#161622}
body{margin:0;padding:20px}main{max-width:420px;margin:auto}h1{font-size:1.3rem}
#players,#status{min-height:24px;overflow-wrap:anywhere}#board{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
button{font:inherit;border:2px solid #737399;border-radius:10px;background:#30304c;color:inherit;cursor:pointer}
#board button{min-height:86px;font-size:2rem}button:focus-visible{outline:3px solid #bda6ff;outline-offset:2px}
button:disabled{cursor:default;opacity:.65}#join{padding:10px 20px;margin-top:16px}
</style></head><body><main><h1 id="title"></h1><p id="players"></p><p id="status" role="status" aria-live="polite"></p>
<div id="board" role="group"></div><button id="join" type="button"></button></main>
<script>
(() => {
  const api = window.monkyScreen;
  const cells = Array.from({length:9}, (_,position) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.addEventListener('click', () => api.sendAction('move', {position}));
    document.getElementById('board').append(button);
    return button;
  });
  document.getElementById('join').addEventListener('click', () => api.sendAction('join', {}));
  api.onState(state => {
    const en = api.viewer.locale === 'en';
    document.getElementById('title').textContent = en ? 'Tic-tac-toe' : 'Jogo da velha';
    document.getElementById('players').textContent = state.players.map((p,i) => (i ? 'O: ' : 'X: ') + p.nickname).join(' · ');
    const turn = state.players[state.turn === 'X' ? 0 : 1];
    document.getElementById('status').textContent = state.winner === 'draw' ? (en ? 'Draw!' : 'Empate!')
      : state.winner ? (en ? 'Winner: ' : 'Vencedor: ') + state.winner
      : state.players.length < 2 ? (en ? 'Waiting for a second player. Spectators welcome.' : 'Aguardando outro jogador. Espectadores são bem-vindos.')
      : (en ? 'Turn: ' : 'Vez de: ') + turn.nickname + ' (' + state.turn + ')';
    const mine = api.viewer.id;
    cells.forEach((button,i) => {
      button.textContent = state.board[i] || '';
      button.setAttribute('aria-label', (en ? 'Cell ' : 'Casa ') + (i+1) + ': ' + (state.board[i] || (en ? 'empty' : 'vazia')));
      button.disabled = state.winner !== null || state.players.length !== 2 || !turn || turn.id !== mine || state.board[i] !== null;
    });
    const join = document.getElementById('join');
    join.textContent = en ? 'Join as O' : 'Jogar como O';
    join.hidden = state.players.length === 2 || state.players.some(p => p.id === mine);
  });
})();
</script></body></html>`;
