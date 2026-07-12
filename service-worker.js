const CACHE='life-focus-v3';
const SHELL=['./','./index.html','./js/remote-sync.js','./js/app.js','./js/time-block.js','./manifest.json'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(url.pathname.endsWith('/data.json')){event.respondWith(fetch(event.request));return;}
  event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request).then(response=>{if(response&&response.ok&&response.type==='basic'){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));}return response})));
});
