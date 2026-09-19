import { askCliChoice } from '@monky/bot-sdk';
import { configCommand } from './commands/lifecycle';
import { setupCommand } from './commands/setup';
import { cliText, getCliLocale, languageCommand } from './i18n';

export async function configurationMenu(): Promise<void> {
  while (true) {
    const action = await askCliChoice(getCliLocale(), cliText('Configurações', 'Settings'), [
      { value: 'language', label: 'Idioma / Language' },
      { value: 'show', label: cliText('Mostrar configuração do bot', 'Show bot configuration') },
      { value: 'setup', label: cliText('Configurar conexão e identidade', 'Configure connection and identity') },
      { value: 'back', label: cliText('Voltar', 'Back') },
    ]);
    if (action === 'back') return;
    if (action === 'language') await languageCommand([]);
    else if (action === 'setup') await setupCommand();
    else await configCommand(['show']);
  }
}
