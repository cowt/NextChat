const CHATGPT_NEXT_WEB_CACHE = "chatgpt-next-web-cache";
const CHATGPT_NEXT_WEB_FILE_CACHE = "chatgpt-next-web-file";
const CHATGPT_NEXT_WEB_IMG_CACHE = "chatgpt-next-web-img";
let a="useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";let nanoid=(e=21)=>{let t="",r=crypto.getRandomValues(new Uint8Array(e));for(let n=0;n<e;n++)t+=a[63&r[n]];return t};

self.addEventListener("activate", function (event) {
  console.log("ServiceWorker activated.");
});

self.addEventListener("install", function (event) {
  self.skipWaiting();  // enable new version
  event.waitUntil(
    caches.open(CHATGPT_NEXT_WEB_CACHE).then(function (cache) {
      return cache.addAll([]);
    }),
  );
});

function jsonify(data) {
  return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
}

async function upload(request, url) {
  const formData = await request.formData()
  const file = formData.getAll('file')[0]
  let ext = file.name.split('.').pop()
  if (ext === 'blob') {
    ext = file.type.split('/').pop()
  }
  const fileUrl = `${url.origin}/api/cache/${nanoid()}.${ext}`
  // console.debug('file', file, fileUrl, request)
  const cache = await caches.open(CHATGPT_NEXT_WEB_FILE_CACHE)
  await cache.put(new Request(fileUrl), new Response(file, {
    headers: {
      'content-type': file.type,
      'content-length': file.size,
      'cache-control': 'no-cache', // file already store in disk
      'server': 'ServiceWorker',
    }
  }))
  return jsonify({ code: 0, data: fileUrl })
}

async function remove(request, url) {
  const cache = await caches.open(CHATGPT_NEXT_WEB_FILE_CACHE)
  const res = await cache.delete(request.url)
  return jsonify({ code: 0 })
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // File cache API - handle first to ensure /api/cache/* GET returns from FILE_CACHE
  try {
    if (/^\/api\/cache/.test(url.pathname)) {
      if ('GET' == e.request.method) {
        e.respondWith((async () => {
          const cache = await caches.open(CHATGPT_NEXT_WEB_FILE_CACHE);
          const cached = await cache.match(e.request);
          if (cached) return cached;
          return jsonify({ code: -1, msg: '此文件未在 ServiceWorker 缓存中找到' });
        })());
        return;
      }
      if ('POST' == e.request.method) {
        e.respondWith(upload(e.request, url))
        return;
      }
      if ('DELETE' == e.request.method) {
        e.respondWith(remove(e.request, url))
        return;
      }
    }
  } catch (_) {}

  // Image cache: Cache First + background revalidate
  // Only handle GET requests for images; skip data/object/chrome-extension URLs
  try {
    const isGet = e.request.method === 'GET';
    const isImage = e.request.destination === 'image';
    const isHttp = url.protocol === 'http:' || url.protocol === 'https:';
    if (isGet && isImage && isHttp) {
      e.respondWith((async () => {
        const cache = await caches.open(CHATGPT_NEXT_WEB_IMG_CACHE);
        const cached = await cache.match(e.request);

        // Fire and forget background update when we have a cached response
        const revalidate = (async () => {
          try {
            const res = await fetch(e.request);
            // opaque responses (cross-origin without CORS) have status 0 but are still cacheable
            if (res) {
              const ok = (res.status === 200) || (res.type === 'opaque') || (res.ok === true);
              if (ok) {
                await cache.put(e.request, res.clone());
              }
            }
          } catch (_) {}
        })();
        if (cached) {
          // keep service worker alive until revalidate finishes
          e.waitUntil(revalidate);
          return cached;
        }
        // No cache hit: fetch from network and cache
        const res = await fetch(e.request);
        try {
          if (res) {
            const ok = (res.status === 200) || (res.type === 'opaque') || (res.ok === true);
            if (ok) {
              const cache = await caches.open(CHATGPT_NEXT_WEB_IMG_CACHE);
              await cache.put(e.request, res.clone());
            }
          }
        } catch (_) {}
        return res;
      })());
      return;
    }
  } catch (_) {}
});
