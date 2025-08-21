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

  // 🎯 统一缓存策略：完全跳过Service Worker图片缓存
  // 让ImageManager统一管理所有图片请求，避免双重缓存冲突
  try {
    const isGet = e.request.method === 'GET';
    const isImage = e.request.destination === 'image';
    
    // 🚨 重要：所有图片请求都跳过Service Worker缓存
    // 交给应用层的ImageManager统一处理
    if (isGet && isImage) {
      // 直接放行，不进行任何缓存处理
      return;
    }
  } catch (_) {}
  
  // 🧹 清理旧的图片缓存（一次性操作）
  try {
    if (!self.__IMAGE_CACHE_CLEARED) {
      self.__IMAGE_CACHE_CLEARED = true;
      caches.delete(CHATGPT_NEXT_WEB_IMG_CACHE).catch(() => {});
    }
  } catch (_) {}
});
