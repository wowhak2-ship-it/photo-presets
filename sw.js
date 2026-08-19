// Service worker — offline cache for the Photo Presets PWA
const CACHE = 'photo-presets-v140';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './privacy.html',
  './offer.html',
  './demo.jpg',
  './avatar.jpg',
  './icon-192-v2.png',
  './icon-512-v2.png',
  './icon-192-maskable-v2.png',
  './icon-512-maskable-v2.png',
  './apple-touch-icon-v2.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Android отдаёт «поделиться» POST-запросом с файлом внутри. Страница такой запрос
// прочитать не может — его перехватывает воркер: кладёт снимок в кэш и отправляет
// приложение на обычный адрес, откуда оно этот снимок уже забирает.
const SHARE_CACHE = 'photo-presets-share';
const SHARE_KEY = './shared-photo';

// Приложение открывают и с корня, и с /index.html, и с хвостом ?p=…; в кэше лежит одна
// копия — ищем её по всем этим видам адреса, иначе страница «не нашлась» и пошла бы в сеть.
async function kэшНайти(кэш, req) {
  return (await кэш.match(req, { ignoreSearch: true })) ||
         (await кэш.match('./index.html')) ||
         (await кэш.match('./'));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);

  if (req.method === 'POST' && url.searchParams.has('share')) {
    e.respondWith((async () => {
      let preset = null;
      try {
        const form = await req.formData();
        const file = form.get('photo');
        if (file && file.size) {
          const c = await caches.open(SHARE_CACHE);
          await c.put(SHARE_KEY, new Response(file, {
            headers: { 'content-type': file.type || 'image/jpeg' }
          }));
        } else {
          // Поделились не снимком, а ссылкой на пресет. Тапнуть по такой ссылке в
          // мессенджере мало: он откроет её у себя, а туда приложению хода нет.
          // Через «Поделиться» ссылка приходит сюда — и пресет ставится куда надо.
          const text = [form.get('url'), form.get('text'), form.get('title')]
            .filter(v => typeof v === 'string').join(' ');
          const m = text.match(/[?&]p=([A-Za-z0-9\-_]+)/);
          if (m) preset = m[1];
        }
      } catch (err) {}
      // 303 обязателен: иначе браузер повторит POST при обновлении страницы
      return Response.redirect(preset ? './index.html?p=' + preset : './index.html?shared=1', 303);
    })());
    return;
  }

  if (req.method !== 'GET') return;
  // Модель ИИ на 51 МБ приложение кладёт в свой отдельный кэш. Если её тронет ещё и
  // воркер, на телефоне будет лежать две копии — 102 МБ вместо 51.
  if (url.pathname.endsWith('/retouch.onnx')) return;
  const isHTML = req.mode === 'navigate' || req.destination === 'document' ||
                 url.pathname.endsWith('/') || url.pathname.endsWith('/index.html');
  // Витрина наборов должна обновляться сама: новый набор выкладывается файлом на сайт,
  // а не новой версией приложения. Под cache-first список замёрз бы навсегда.
  const isLive = url.pathname.endsWith('/packs.json');

  if (isHTML) {
    // Страницу отдаём ИЗ ПАМЯТИ СРАЗУ, а свежую копию тянем в фоне — она пойдёт в дело
    // при следующем запуске. Раньше здесь стояло «сначала сеть», и запуск приложения ждал
    // ответа GitHub: у Артура без VPN провайдер отдаёт его медленно, и это были те самые
    // секунды белого экрана (с VPN всё летало — так и нашли причину).
    // Обновление от этого не теряется: новую версию по-прежнему приносит служебный
    // воркер — он ставится в фоне и перезагружает страницу, когда готов.
    e.respondWith((async () => {
      const кэш = await caches.open(CACHE);
      const свой = await kэшНайти(кэш, req);
      const сеть = fetch(req, { cache: 'no-store' }).then(resp => {
        кэш.put('./index.html', resp.clone()).catch(() => {});
        return resp;
      }).catch(() => null);
      return свой || (await сеть) || new Response('нет сети', { status: 504 });
    })());
  } else if (isLive) {
    // Витрина наборов — наоборот, всегда из сети: новый набор должен появляться сразу.
    e.respondWith(
      fetch(req, { cache: 'no-store' }).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return resp;
      }).catch(() => caches.match(req))
    );
  } else {
    // Cache-first for static assets (icons, manifest)
    e.respondWith(
      caches.match(req).then(cached =>
        cached || fetch(req).then(resp => {
          const copy = resp.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          return resp;
        })
      )
    );
  }
});
