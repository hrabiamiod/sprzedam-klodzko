#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));
const envFileArg = process.argv.find((value) => value.startsWith('--env-file='));
const envFilePath = envFileArg ? envFileArg.split('=', 2)[1] : '.env.prod.local';
const dryRun = args.has('--dry-run');
const skipPrompts = args.has('--yes');

const files = {
  wrangler: path.join(ROOT, 'wrangler.toml'),
  legalTerms: path.join(ROOT, 'frontend/public/regulamin.html'),
  legalPrivacy: path.join(ROOT, 'frontend/public/polityka-prywatnosci.html')
};

function parseDotEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const output = {};
  const content = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const stripped = line.startsWith('export ') ? line.slice(7).trim() : line;
    const match = stripped.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const commentIndex = value.indexOf(' #');
      if (commentIndex !== -1) {
        value = value.slice(0, commentIndex).trim();
      }
    }
    output[key] = value;
  }
  return output;
}

const loadedEnv = parseDotEnv(envFilePath);
for (const [key, value] of Object.entries(loadedEnv)) {
  if (process.env[key] === undefined) {
    process.env[key] = value;
  }
}

function promptLine(question, defaultValue = '') {
  if (skipPrompts) {
    const envValue = defaultValue;
    if (!envValue) {
      throw new Error(`Brakuje wartości dla: ${question}`);
    }
    return Promise.resolve(envValue);
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const suffix = defaultValue ? ` [${defaultValue}]` : '';
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      rl.close();
      const value = answer.trim() || defaultValue;
      resolve(value);
    });
  });
}

function promptSecret(question, defaultValue = '') {
  if (skipPrompts) {
    const envValue = defaultValue;
    if (!envValue) {
      throw new Error(`Brakuje sekretu dla: ${question}`);
    }
    return Promise.resolve(envValue);
  }

  return new Promise((resolve) => {
    const stdin = process.stdin;
    const wasRaw = Boolean(stdin.isRaw);
    let value = '';
    process.stdout.write(`${question}: `);

    function cleanup() {
      stdin.off('data', onData);
      if (stdin.isTTY && stdin.setRawMode) {
        stdin.setRawMode(wasRaw);
      }
    }

    function finish() {
      cleanup();
      process.stdout.write('\n');
      resolve(value.trim() || defaultValue);
    }

    function onData(chunk) {
      const input = chunk.toString('utf8');
      for (const char of input) {
        if (char === '\u0003') {
          cleanup();
          process.stdout.write('\n');
          process.exit(130);
        }
        if (char === '\r' || char === '\n') {
          finish();
          return;
        }
        if (char === '\u007f') {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    }

    if (!stdin.isTTY || !stdin.setRawMode) {
      throw new Error('Interaktywne wpisywanie sekretów wymaga terminala TTY');
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on('data', onData);
  });
}

function escapeForToml(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function replaceExact(content, from, to) {
  return content.includes(from) ? content.replaceAll(from, to) : content;
}

function writeIfChanged(filePath, nextContent) {
  const current = fs.readFileSync(filePath, 'utf8');
  if (current === nextContent) return false;
  fs.writeFileSync(filePath, nextContent);
  return true;
}

function runWranglerSecretPut(name, value) {
  const result = spawnSync('wrangler', ['secret', 'put', '--env', 'prod', name], {
    input: `${value}\n`,
    stdio: ['pipe', 'inherit', 'inherit']
  });
  if (result.status !== 0) {
    throw new Error(`wrangler secret put failed for ${name}`);
  }
}

async function main() {
  if (!fs.existsSync(files.wrangler)) {
    throw new Error('Brak wrangler.toml w katalogu roboczym');
  }

  const values = {
    PROD_D1_DATABASE_ID: process.env.PROD_D1_DATABASE_ID || process.env.D1_DATABASE_ID || '',
    TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY || '',
    ADMIN_ALLOWED_IPS: process.env.ADMIN_ALLOWED_IPS || '',
    ADMIN_NAME: process.env.ADMIN_NAME || '',
    ADMIN_EMAIL: process.env.ADMIN_EMAIL || '',
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || '',
    NTFY_TOPIC_URL: process.env.NTFY_TOPIC_URL || '',
    ADMIN_USERNAME: process.env.ADMIN_USERNAME || '',
    ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || '',
    ADMIN_TOTP_SECRET: process.env.ADMIN_TOTP_SECRET || '',
    ADMIN_SESSION_SECRET: process.env.ADMIN_SESSION_SECRET || '',
    TURNSTILE_SECRET_KEY: process.env.TURNSTILE_SECRET_KEY || ''
  };

  const requiredConfig = [
    ['PROD_D1_DATABASE_ID', false],
    ['TURNSTILE_SITE_KEY', false],
    ['ADMIN_ALLOWED_IPS', false],
    ['ADMIN_NAME', false],
    ['ADMIN_EMAIL', false]
  ];
  const requiredSecrets = [
    'OPENAI_API_KEY',
    'NTFY_TOPIC_URL',
    'ADMIN_USERNAME',
    'ADMIN_PASSWORD',
    'ADMIN_TOTP_SECRET',
    'ADMIN_SESSION_SECRET',
    'TURNSTILE_SECRET_KEY'
  ];

  for (const [key] of requiredConfig) {
    if (!values[key]) {
      values[key] = await promptLine(`Podaj ${key}`, values[key]);
    }
  }
  for (const key of requiredSecrets) {
    if (!values[key]) {
      values[key] = await promptSecret(`Podaj ${key}`, values[key]);
    }
  }

  const wranglerContent = fs.readFileSync(files.wrangler, 'utf8');
  let nextWrangler = wranglerContent;
  nextWrangler = replaceExact(
    nextWrangler,
    'database_id = "REPLACE_WITH_PROD_D1_DATABASE_ID"',
    `database_id = "${escapeForToml(values.PROD_D1_DATABASE_ID)}"`
  );
  nextWrangler = replaceExact(
    nextWrangler,
    'TURNSTILE_SITE_KEY = "REPLACE_WITH_TURNSTILE_SITE_KEY"',
    `TURNSTILE_SITE_KEY = "${escapeForToml(values.TURNSTILE_SITE_KEY)}"`
  );
  nextWrangler = replaceExact(
    nextWrangler,
    'ADMIN_ALLOWED_IPS = "REPLACE_WITH_ADMIN_IP_OR_CIDR"',
    `ADMIN_ALLOWED_IPS = "${escapeForToml(values.ADMIN_ALLOWED_IPS)}"`
  );

  const legalPlaceholders = [
    ['[IMIĘ NAZWISKO]', values.ADMIN_NAME],
    ['[EMAIL ADMINISTRATORA]', values.ADMIN_EMAIL]
  ];

  const legalFiles = [files.legalTerms, files.legalPrivacy];
  const legalNext = new Map();
  for (const filePath of legalFiles) {
    let content = fs.readFileSync(filePath, 'utf8');
    for (const [placeholder, replacement] of legalPlaceholders) {
      content = replaceExact(content, placeholder, replacement);
    }
    legalNext.set(filePath, content);
  }

  if (dryRun) {
    console.log('Dry run. Zostaną ustawione:');
    console.log(`- PROD_D1_DATABASE_ID: ${values.PROD_D1_DATABASE_ID}`);
    console.log(`- TURNSTILE_SITE_KEY: ${values.TURNSTILE_SITE_KEY}`);
    console.log(`- ADMIN_ALLOWED_IPS: ${values.ADMIN_ALLOWED_IPS}`);
    console.log(`- Legal: ${values.ADMIN_NAME} / ${values.ADMIN_EMAIL}`);
    console.log(`- Sekrety: ${requiredSecrets.join(', ')}`);
    return;
  }

  const changedWrangler = writeIfChanged(files.wrangler, nextWrangler);
  const changedLegal = [];
  for (const [filePath, content] of legalNext.entries()) {
    if (writeIfChanged(filePath, content)) {
      changedLegal.push(path.relative(ROOT, filePath));
    }
  }

  for (const key of requiredSecrets) {
    runWranglerSecretPut(key, values[key]);
  }

  console.log(changedWrangler ? `Zaktualizowano ${path.relative(ROOT, files.wrangler)}` : 'wrangler.toml bez zmian');
  if (changedLegal.length > 0) {
    console.log(`Zaktualizowano: ${changedLegal.join(', ')}`);
  }
  console.log('Sekrety zostały wgrane do env prod.');
  console.log('Następne kroki:');
  console.log('1. wrangler d1 execute sprzedam-klodzko-db --env prod --remote --file=./schema.sql');
  console.log('2. wrangler deploy --env prod');
  console.log('3. wrangler pages deploy public --cwd frontend --project-name sprzedam-klodzko-dev --branch main --commit-dirty=true');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
