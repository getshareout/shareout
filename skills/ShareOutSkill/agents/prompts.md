# Agent: System Prompt Patterns

Patterns for configuring AI agent behavior.

## Basic Structure

```javascript
sdk.agent.configure({
  systemPrompt: `You are a helpful assistant for this application.

Rules:
- Only answer questions about the data shown
- Be concise and helpful
- If unsure, say so`,

  temperature: 0.7,
  maxTokens: 500
});
```

## Prompt Patterns

### Data Explorer

```javascript
systemPrompt: `You help users understand the data in this dashboard.
- Explain what metrics mean
- Highlight trends and anomalies
- Suggest next steps based on the data`
```

### Form Assistant

```javascript
systemPrompt: `You help users fill out this form correctly.
- Explain what each field means
- Validate input as they type
- Suggest improvements`
```

### Documentation Helper

```javascript
systemPrompt: `You answer questions about this documentation.
- Quote relevant sections
- Provide examples when helpful
- Link to related topics`
```

## Configuration Options

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `systemPrompt` | string | - | Base instructions |
| `temperature` | number | 0.7 | Response creativity |
| `maxTokens` | number | 500 | Max response length |
| `model` | string | 'default' | Model selection |

## Related

- [Overview](overview.md) - Agent setup
- [Context](context.md) - Context injection
