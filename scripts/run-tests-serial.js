#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const roots = process.argv.slice(2);
const testRoots = roots.length > 0 ? roots : ['tests'];
const testFilePattern = /(?:\.test|_test_|\.spec|_spec_)\.(?:[cm]?[jt]s)$/;

function collectTestFiles(rootDir) {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const stats = fs.statSync(rootDir);
  if (stats.isFile()) {
    return testFilePattern.test(path.basename(rootDir)) ? [rootDir] : [];
  }

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectTestFiles(fullPath));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (testFilePattern.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

const testFiles = [...new Set(testRoots.flatMap((rootDir) => collectTestFiles(rootDir)))].sort();

if (testFiles.length === 0) {
  console.error('No test files found.');
  process.exit(1);
}

for (let index = 0; index < testFiles.length; index += 1) {
  const file = testFiles[index];
  console.log(`\n[${index + 1}/${testFiles.length}] ${file}`);
  const bunTestPath = path.isAbsolute(file) ? file : `./${file}`;

  const result = spawnSync('bun', ['test', bunTestPath], {
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
