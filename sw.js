const CACHE="marknest-shell-v1.0.0";
const SHELL=["./","./index.html","./styles.css","./app.js","./manifest.json","./icon-192.png","./icon-512.png"];
const SHELL_SET=new Set(SHELL);

self.addEventListener("install",event=>event.waitUntil(
  caches.open(CACHE).then(async cache=>{
    for(const asset of SHELL){
      try{
        const response=await fetch(new Request(asset,{cache:"no-store"}));
        if(response.ok) await cache.put(asset,response);
      }catch{}
    }
  }).then(()=>self.skipWaiting())
));

self.addEventListener("activate",event=>event.waitUntil(
  caches.keys()
    .then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))
    .then(()=>self.clients.claim())
));

self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET") return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin) return;

  // Cache only the known application shell. Avoid accidentally caching arbitrary
  // same-origin responses, which can cause stale data and unnecessary storage use.
  const shellKey=SHELL_SET.has(request.url.replace(self.location.origin,""))
    ? request.url.replace(self.location.origin,"")
    : null;
  if(!shellKey) return;

  event.respondWith(
    caches.match(shellKey).then(cached=>cached||fetch(request).then(response=>{
      if(response.ok){
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(shellKey,copy)).catch(()=>{});
      }
      return response;
    }).catch(()=>request.mode==="navigate"?caches.match("./index.html"):Response.error()))
  );
});
