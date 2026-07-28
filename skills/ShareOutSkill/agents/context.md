# Agent: Context Injection

How to provide artifact context to AI chat agents.

## Context Sources

| Source | Description | SDK Method |
|--------|-------------|------------|
| `artifact_data` | JSON/table data | Automatic |
| `user_input` | Current message | Automatic |
| `custom` | Injected context | `sdk.agent.setContext()` |

## SDK Methods

```javascript
// Set custom context
sdk.agent.setContext({
  businessRules: 'Only answer about products in our catalog',
  userData: { name: 'Alice', role: 'admin' }
});

// Append to context
sdk.agent.appendContext('key', value);

// Clear context
sdk.agent.clearContext();
```

## Context Limits

| Constraint | Value |
|------------|-------|
| Max context size | 100KB |
| Max custom fields | 50 |
| Refresh rate | Per message |

## Best Practices

1. **Keep context focused** - Only include relevant data
2. **Update dynamically** - Refresh context as artifact state changes
3. **Avoid PII** - Don't inject sensitive user data unless necessary

## Related

- [Overview](overview.md) - Agent setup
- [Prompts](prompts.md) - System prompt patterns
