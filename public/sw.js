// 서비스워커 자기소멸: 과거 캐시가 옛/새 파일을 뒤섞어 문제를 일으켜서 캐싱을 폐기한다.
// 모든 캐시를 지우고 등록을 해제한 뒤 열린 탭을 새로고침해 항상 네트워크 최신본을 쓰게 한다.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((client) => client.navigate(client.url));
    } catch (e) {
      // 무시 — 다음 로드에서 네트워크 최신본을 받는다.
    }
  })());
});
// fetch 핸들러 없음 → 브라우저가 SW를 거치지 않고 바로 네트워크로 요청한다.
