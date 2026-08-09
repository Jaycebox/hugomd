'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const electronPath = path.join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron.exe');
const userData = path.join(os.tmpdir(), 'hugomd-ui-flow-test');
if (fs.existsSync(userData)) fs.rmSync(userData, { recursive: true, force: true });

const proc = spawn(electronPath, ['.', '--enable-logging'], {
  cwd: path.join(__dirname, '..'),
  env: {
    ...process.env,
    HUGOMD_SMOKE_RENDERER: '1',
    HUGOMD_SMOKE: 'ui-flow',
    HUGOMD_USER_DATA: userData,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
proc.stderr.on('data', (d) => process.stderr.write('ERR: ' + d));

(async () => {
  await new Promise((r) => setTimeout(r, 25000));
  proc.kill();
  process.exit(0);
})();
