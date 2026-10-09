import { describe, it, expect } from 'vitest';
import { agentLanguageRule } from '../../../src/i18n';
import { commandToAgentPrompt, botDisabledMessage } from '../../../src/chat-agent/commands';
import { toolProgressLabel } from '../../../src/chat-agent/tool-progress';
import { describeAction, describeActionRich } from '../../../src/chat-agent/actions';
import { agentFallbackReplies } from '../../../src/chat-agent/replies';

describe('chat agent in Spanish', () => {
  it('always mirrors the user, and asks for rioplatense in a Spanish workspace', () => {
    expect(agentLanguageRule('en')).toBe('Reply in the language the user writes in.');
    expect(agentLanguageRule('es')).toMatch(/Argentina \(use vos\).*páginas/);
  });

  it('localizes commands, progress, cards and fallbacks; English is the default', () => {
    expect(commandToAgentPrompt('alerts', '')).toBe('List my metric alerts.');
    expect(commandToAgentPrompt('pdf', 'Ventas', 'es')).toBe('Mandame un PDF de esta página: Ventas');
    expect(botDisabledMessage('slack', 'es')).toMatch(/^El asistente de Slack/);
    expect(toolProgressLabel('read_artifact', {}, 'es')).toBe('Leyendo la página…');
    expect(toolProgressLabel('query_connection', { connection: 'ventas' }, 'es')).toBe('Consultando ventas…');
    expect(toolProgressLabel('nope', {}, 'es')).toBe('Estoy en eso…');
    const share = { kind: 'share', artifactId: 'a', artifactName: 'Ventas', emails: ['x@y.com'], role: 'viewer' } as const;
    expect(describeAction(share, 'es')).toBe('¿Comparto “Ventas” con x@y.com como lector?');
    expect(describeActionRich(share, 'es')).toMatchObject({ title: 'Compartir página', detail: 'Como lector' });
    expect(agentFallbackReplies('es').errored).toMatch(/^Uy/);
    expect(agentFallbackReplies().errored).toBe('Hmm, something went wrong on my end. Mind trying again?');
  });
});
