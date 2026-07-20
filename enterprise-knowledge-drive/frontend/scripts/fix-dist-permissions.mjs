import { chmod, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const makeNginxReadable = async (path) => {
  const entries = await readdir(path, { withFileTypes: true });
  await chmod(path, 0o755);
  for (const entry of entries) {
    const target = join(path, entry.name);
    if (entry.isDirectory()) {
      await makeNginxReadable(target);
    } else {
      await chmod(target, 0o644);
    }
  }
};

await makeNginxReadable(fileURLToPath(new URL('../dist', import.meta.url)));
