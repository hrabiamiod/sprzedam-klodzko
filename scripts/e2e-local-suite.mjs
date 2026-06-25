import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = 'http://127.0.0.1:8787';
const devVarsPath = path.join(process.cwd(), '.dev.vars');
const devEnv = {
  ...process.env,
  E2E_TURNSTILE_BYPASS_TOKEN: 'dev-bypass',
  ADMIN_USERNAME: 'admin-e2e',
  ADMIN_PASSWORD: 'admin-e2e-password',
  ADMIN_TOTP_SECRET: 'JBSWY3DPEHPK3PXP',
  ADMIN_SESSION_SECRET: 'local-admin-session-secret',
  ADMIN_ALLOWED_IPS: '127.0.0.1,::1',
  NTFY_TOPIC_URL: `${baseUrl}/__e2e-ntfy-failure`
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: devEnv,
    ...options
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`);
  }
}

function writeTemporaryDevVars() {
  const previous = fs.existsSync(devVarsPath) ? fs.readFileSync(devVarsPath, 'utf8') : null;
  fs.writeFileSync(devVarsPath, [
    `E2E_TURNSTILE_BYPASS_TOKEN=${devEnv.E2E_TURNSTILE_BYPASS_TOKEN}`,
    `ADMIN_USERNAME=${devEnv.ADMIN_USERNAME}`,
    `ADMIN_PASSWORD=${devEnv.ADMIN_PASSWORD}`,
    `ADMIN_TOTP_SECRET=${devEnv.ADMIN_TOTP_SECRET}`,
    `ADMIN_SESSION_SECRET=${devEnv.ADMIN_SESSION_SECRET}`,
    `ADMIN_ALLOWED_IPS=${devEnv.ADMIN_ALLOWED_IPS}`,
    `NTFY_TOPIC_URL=${devEnv.NTFY_TOPIC_URL}`,
    ''
  ].join('\n'));
  return () => {
    if (previous === null) {
      fs.rmSync(devVarsPath, { force: true });
      return;
    }
    fs.writeFileSync(devVarsPath, previous);
  };
}

async function waitForHealth() {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < 30_000) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Worker did not become ready: ${lastError?.message || 'timeout'}`);
}

async function main() {
  const restoreDevVars = writeTemporaryDevVars();
  run('npx', ['wrangler', 'd1', 'execute', 'sprzedam-klodzko-db-dev', '--env', 'dev', '--local', '--file=./schema.sql']);
  run('npx', ['wrangler', 'd1', 'execute', 'sprzedam-klodzko-db-dev', '--env', 'dev', '--local', '--command', 'DELETE FROM request_throttle_counters; DELETE FROM admin_sessions;']);

  const worker = spawn('npx', ['wrangler', 'dev', '--env', 'dev', '--local', '--port', '8787'], {
    env: devEnv,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  worker.stdout.on('data', (chunk) => process.stdout.write(chunk));
  worker.stderr.on('data', (chunk) => process.stderr.write(chunk));

  try {
    await waitForHealth();
    run('node', ['scripts/e2e-listing-flow.mjs'], {
      env: {
        ...devEnv,
        E2E_BASE_URL: baseUrl,
        E2E_TURNSTILE_TOKEN: 'dev-bypass',
        E2E_APPROVE_WITH_WRANGLER: '1'
      }
    });
    run('node', ['scripts/e2e-admin-auth.mjs'], {
      env: {
        ...devEnv,
        E2E_BASE_URL: baseUrl
      }
    });
  } finally {
    worker.kill('SIGTERM');
    await new Promise((resolve) => {
      const timeout = setTimeout(resolve, 2_000);
      worker.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    restoreDevVars();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
