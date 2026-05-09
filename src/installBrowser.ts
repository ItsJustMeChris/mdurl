import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export async function installBrowser(): Promise<void> {
  const cli = await resolvePlaywrightCli();

  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'install', 'chromium'], {
      stdio: 'inherit',
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`playwright install chromium exited with code ${code}`));
      }
    });
  });
}

async function resolvePlaywrightCli(): Promise<string> {
  try {
    const packagePath = await import.meta.resolve('playwright-core/package.json');
    const packageDir = dirname(fileURLToPath(packagePath));
    return join(packageDir, 'cli.js');
  } catch {
    return 'node_modules/playwright-core/cli.js';
  }
}
