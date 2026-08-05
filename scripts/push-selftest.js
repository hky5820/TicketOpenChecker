// 자체 푸시 채널 스모크 테스트: 서버 띄우고 key/sync/저장 파일을 확인한다.
// node scripts/push-selftest.js
const { spawn } = require('child_process');
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PORT = 3199;

(async () => {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('서버 기동 타임아웃')), 15000);
      child.stdout.on('data', (c) => { if (String(c).includes('localhost')) { clearTimeout(to); resolve(); } });
      child.on('exit', (code) => reject(new Error(`서버 조기 종료 code=${code}`)));
    });

    const base = `http://127.0.0.1:${PORT}`;
    const keyRes = await fetch(`${base}/api/push/key`);
    assert.strictEqual(keyRes.status, 200);
    assert.strictEqual(keyRes.headers.get('access-control-allow-origin'), '*');
    const { key } = await keyRes.json();
    assert.ok(key && key.length > 20, 'VAPID 공개키 없음');

    const sub = { endpoint: 'https://example.com/fake-ep', keys: { p256dh: 'x', auth: 'y' } };
    const open = new Date(Date.now() + 30 * 60000).toISOString();
    const syncRes = await fetch(`${base}/api/push/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub, alarms: [{ key: 'a|b|c', title: '테스트 공연', open, url: 'https://example.com' }, { bad: true }] }),
    });
    assert.strictEqual(syncRes.status, 200);
    assert.strictEqual((await syncRes.json()).alarms, 1, '유효 알람 1건만 저장돼야 함');

    const saved = JSON.parse(fs.readFileSync(path.join(ROOT, '.push-subs.json'), 'utf8'));
    const rec = saved.find((r) => r.sub.endpoint === sub.endpoint);
    assert.ok(rec && rec.alarms.length === 1 && rec.alarms[0].title === '테스트 공연', '구독 파일 저장 실패');

    // 빈 목록 sync = 알람 전부 해제
    await fetch(`${base}/api/push/sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sub, alarms: [] }),
    });
    const saved2 = JSON.parse(fs.readFileSync(path.join(ROOT, '.push-subs.json'), 'utf8'));
    assert.strictEqual(saved2.find((r) => r.sub.endpoint === sub.endpoint).alarms.length, 0);

    assert.strictEqual((await fetch(`${base}/api/push/sync`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })).status, 400, 'sub 없는 요청은 400');

    console.log('push-selftest OK');
  } finally {
    child.kill();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
