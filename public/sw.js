// v4: 알림용 서비스워커 (KTX 앱 방식). 페이지가 reg.showNotification()으로 단말 알림창에 띄운다.
// 캐싱은 계속 안 한다(과거 캐시가 옛/새 파일을 뒤섞은 사고) — fetch 핸들러 없음, 항상 네트워크 직행.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch (e) { /* 무시 */ }
    await self.clients.claim();
  })());
});

// 알림 탭 → 이미 열려 있는 앱 창이 있으면 그 창으로, 없으면 새로 연다
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of list) { if ('focus' in c) return c.focus(); }
    if (self.clients.openWindow) return self.clients.openWindow('./');
  })());
});
