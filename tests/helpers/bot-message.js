const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { botLocalizedMessageSchema, getMessageText } = createRequire(require.resolve('@monky/bot-sdk'))('@monky/shared');

function botMessageText(value, locale) {
  const message = botLocalizedMessageSchema.parse(value);
  assert.deepEqual(Object.keys(message.localizations).sort(), ['en', 'pt-BR']);
  assert.ok(Object.values(message.localizations).includes(message.content), 'Fallback uses one authored variant');
  return locale ? getMessageText({ ...message, isBot: true }, locale) : message.content;
}

module.exports = { botMessageText };
