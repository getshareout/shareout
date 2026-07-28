# Pattern: Forms

Copy-paste form patterns for common use cases.

## Contact Form (Emails Owner)

```html
<script type="shareout/manifest">
{
  "version": "2.0",
  "sources": { "json": {} }
}
</script>
<script src="$ORIGIN/sdk/shareout.js"></script>

<form id="contact-form">
  <input type="text" name="name" placeholder="Name" required>
  <input type="email" name="email" placeholder="Email" required>
  <textarea name="message" placeholder="Message" required></textarea>
  <button type="submit">Send</button>
</form>

<script>
  const sdk = new ShareOut();
  document.getElementById('contact-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    await sdk.email.notifyOwner({
      subject: `Contact from ${form.get('name')}`,
      body: `Email: ${form.get('email')}\n\n${form.get('message')}`
    });
    alert('Message sent!');
    e.target.reset();
  });
</script>
```

## Data Collection Form

```html
<script type="shareout/manifest">
{
  "version": "2.0",
  "sources": {
    "tables": {
      "submissions": {
        "schema": [
          { "name": "id", "type": "string", "primary": true },
          { "name": "name", "type": "string" },
          { "name": "email", "type": "string" },
          { "name": "response", "type": "string" },
          { "name": "createdAt", "type": "string" }
        ]
      }
    }
  }
}
</script>

<form id="survey">
  <input type="text" name="name" data-shareout-binding="form:name">
  <input type="email" name="email" data-shareout-binding="form:email">
  <select name="response" data-shareout-binding="form:response">
    <option value="">Select...</option>
    <option value="yes">Yes</option>
    <option value="no">No</option>
  </select>
  <button type="submit">Submit</button>
</form>

<script>
  const sdk = new ShareOut();
  const submissions = sdk.table('submissions');

  document.getElementById('survey').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = new FormData(e.target);
    await submissions.insert({
      id: crypto.randomUUID(),
      name: form.get('name'),
      email: form.get('email'),
      response: form.get('response'),
      createdAt: new Date().toISOString()
    });
    alert('Submitted!');
  });
</script>
```

## Related

- [Overview](overview.md) - All patterns
- [SDK: Table](../sdk/table.md) - Table storage
- [SDK: Email](../sdk/email.md) - Email methods
