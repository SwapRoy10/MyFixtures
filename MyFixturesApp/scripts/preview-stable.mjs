// Non-watching alternative for platforms where watching assets='.' also sees
// Wrangler's temporary runtime files. Restart after editing application code.
import { unstable_startWorker } from 'wrangler';
const server = await unstable_startWorker({ config: 'wrangler.toml', dev: { watch: false, remote: false, server: { port: 8787 } } });
await server.ready;
console.log(`Preview ready at ${await server.url} (restart after code changes).`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.dispose(); process.exit(0); });
