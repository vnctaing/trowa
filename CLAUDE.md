# Trowa

## TypeSafe (Jev)

Load the `typesafe:typesafe-ai` skill before designing any feature that needs a judgment ordinary code can't make: ranking search results, reading a title or description, picking one option from a set. Read the live docs it points to before writing the integration.

- Code owns the workflow. Ask Jev narrow typed questions (Choice, Noul, Score) and act on the answers and their confidence in code. Don't use it to generate text.
- Keep the audio and notation pipeline (`src/pipeline/`) in code. Jev reads text and images, not audio.
- Call TypeSafe only from `server/index.js` with `@typesafe-ai/sdk`. The key never reaches the browser.
- The key is `TYPESAFE_API_KEY`. `.env` holds a 1Password reference, not the key. Start the server with `op run --env-file=.env -- npm run dev`. Never print the key or commit it.
- When the key is missing or unresolved, the feature shows a clear message and the rest of the app keeps working.
