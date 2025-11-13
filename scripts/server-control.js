const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const pidFilePath = path.join(projectRoot, '.server.pid');
const serverEntry = path.join(projectRoot, 'server.js');

function readPid() {
  try {
    const pid = parseInt(fs.readFileSync(pidFilePath, 'utf8').trim(), 10);
    return Number.isNaN(pid) ? null : pid;
  } catch (_) {
    return null;
  }
}

function writePid(pid) {
  fs.writeFileSync(pidFilePath, String(pid));
}

function removePidFile() {
  try { fs.unlinkSync(pidFilePath); } catch (_) {}
}

function isPidRunning(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

function killPid(pid) {
  if (!pid) return;
  try {
    process.kill(pid);
  } catch (err) {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    }
  }
}

async function stop() {
  const pid = readPid();
  if (!pid || !isPidRunning(pid)) {
    removePidFile();
    console.log('Server non in esecuzione.');
    return;
  }

  console.log(`Arresto server (PID ${pid})...`);
  killPid(pid);

  const start = Date.now();
  const timeoutMs = 7000;
  while (Date.now() - start < timeoutMs) {
    if (!isPidRunning(pid)) break;
    await new Promise(r => setTimeout(r, 150));
  }

  if (isPidRunning(pid)) {
    console.error('Impossibile arrestare il server in modo pulito.');
  } else {
    console.log('Server arrestato.');
  }
  removePidFile();
}

function start() {
  const existingPid = readPid();
  if (existingPid && isPidRunning(existingPid)) {
    console.log(`Server già in esecuzione (PID ${existingPid}).`);
    return;
  }

  if (!fs.existsSync(serverEntry)) {
    console.error('Impossibile trovare server.js nella root del progetto.');
    process.exit(1);
  }

  const child = spawn(process.execPath, [serverEntry], {
    cwd: projectRoot,
    detached: true,
    stdio: 'ignore'
  });
  writePid(child.pid);
  child.unref();
  console.log(`Server avviato (PID ${child.pid}).`);
}

async function restart() {
  await stop();
  start();
}

function status() {
  const pid = readPid();
  if (pid && isPidRunning(pid)) {
    console.log(`Server in esecuzione (PID ${pid}).`);
  } else {
    console.log('Server non in esecuzione.');
  }
}

async function main() {
  const cmd = (process.argv[2] || '').toLowerCase();
  switch (cmd) {
    case 'start':
      start();
      break;
    case 'stop':
      await stop();
      break;
    case 'restart':
      await restart();
      break;
    case 'status':
      status();
      break;
    default:
      console.log('Uso: node scripts/server-control.js <start|stop|restart|status>');
      process.exitCode = 1;
  }
}

main();




