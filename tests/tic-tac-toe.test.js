const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { newGame, gameAction, ticTacToeHtml } = require('../dist/screens/ticTacToe');

function action(state, userId, action, payload = {}) {
  return gameAction(state, { userId, userNickname: userId, action, payload, revision: state.revision });
}
test('only second participant may join; spectators and payload identity cannot play', () => {
  const state = newGame({ id: 'x', nickname: '<script>name</script>' }, 'en');
  assert.equal(action(state, 'x', 'join'), null);
  assert.equal(action(state, 'x', 'move', { position: 0 }), null);
  const joined = action(state, 'o', 'join');
  assert.equal(joined.players.length, 2);
  assert.equal(action(joined, 'spectator', 'join'), null);
  assert.equal(action(joined, 'spectator', 'move', { position: 0, userId: 'x' }), null);
  assert.equal(action(joined, 'o', 'move', { position: 0 }), null);
});
test('legal moves are immutable, revision checked, bounded and alternate turns', () => {
  const state = action(newGame({ id: 'x', nickname: 'X' }, 'pt-BR'), 'o', 'join');
  const next = action(state, 'x', 'move', { position: 0 });
  assert.equal(state.board[0], null);
  assert.equal(next.board[0], 'X');
  assert.equal(next.turn, 'O');
  assert.equal(gameAction(next, { userId: 'o', action: 'move', payload: { position: 1 }, revision: state.revision }), null);
  for (const position of [0, -1, 9, 1.5, '1', null]) assert.equal(action(next, 'o', 'move', { position }), null);
});
test('wins and draws are final and correctly detected', () => {
  for (const [moves, winner] of [[[0, 3, 1, 4, 2], 'X'], [[0, 3, 1, 4, 8, 5], 'O'], [[0, 1, 2, 4, 3, 5, 7, 6, 8], 'draw']]) {
    let state = action(newGame({ id: 'x', nickname: 'X' }, 'en'), 'o', 'join');
    for (const position of moves) state = action(state, state.turn.toLowerCase(), 'move', { position });
    assert.equal(state.winner, winner);
    assert.equal(action(state, 'x', 'move', { position: 8 }), null);
    assert.equal(action(state, 'o', 'join'), null);
  }
});
test('screen is self-contained, keyboard native buttons, and renders untrusted labels as text', () => {
  assert.match(ticTacToeHtml, /monkyScreen/);
  assert.match(ticTacToeHtml, /textContent/);
  assert.doesNotMatch(ticTacToeHtml, /innerHTML|fetch\(|https?:|type="(?:checkbox|radio)"|parent\.document/);
});

test('each viewer renders and refreshes controls in their own app language without changing game state', () => {
  const script = ticTacToeHtml.match(/<script>([\s\S]*?)<\/script>/)[1];
  const state = newGame({ id: 'x', nickname: 'X' }, 'pt-BR');
  function viewer(initialLocale) {
    let locale = initialLocale, render;
    const element = () => ({
      children: [], attributes: {}, textContent: '', hidden: false,
      addEventListener() {}, append(child) { this.children.push(child); },
      setAttribute(name, value) { this.attributes[name] = value; },
    });
    const elements = Object.fromEntries(['title', 'players', 'status', 'board', 'join'].map(id => [id, element()]));
    const api = {
      viewer: Object.freeze({ id: 'o', nickname: 'O', get locale() { return locale; } }),
      onState(callback) { render = callback; callback(state, 0); },
      sendAction() {},
    };
    vm.runInNewContext(script, {
      window: { monkyScreen: api },
      document: { getElementById: id => elements[id], createElement: element },
    });
    return { elements, changeLanguage(next) { locale = next; render(state, 0); } };
  }
  const portuguese = viewer('pt-BR'), english = viewer('en');
  assert.equal(portuguese.elements.title.textContent, 'Jogo da velha');
  assert.equal(english.elements.title.textContent, 'Tic-tac-toe');
  assert.equal(english.elements.join.textContent, 'Join as O');
  const cells = [...portuguese.elements.board.children];
  portuguese.changeLanguage('en');
  assert.equal(portuguese.elements.title.textContent, 'Tic-tac-toe');
  assert.equal(portuguese.elements.join.textContent, 'Join as O');
  assert.equal(cells[0].attributes['aria-label'], 'Cell 1: empty');
  assert.deepEqual(portuguese.elements.board.children, cells);
  portuguese.changeLanguage('pt-BR');
  assert.equal(portuguese.elements.join.textContent, 'Jogar como O');
  assert.equal(english.elements.join.textContent, 'Join as O');
  assert.deepEqual(state, newGame({ id: 'x', nickname: 'X' }, 'pt-BR'));
});
