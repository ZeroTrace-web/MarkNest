const CACHE="marknest-shell-v1.0.1";
const SHELL=["./","./index.html","./styles.css","./app.js","./manifest.json","./icon-192.png","./icon-512.png"];
const SHELL_URLS=SHELL.map(asset=>new URL(asset,self.location.href).href);
const SHELL_SET=new Set(SHELL_URLS);

self.addEventListener("install",event=>event.waitUntil(
  caches.open(CACHE).then(async cache=>{
    for(const url of SHELL_URLS){
      try{
        const response=await fetch(new Request(url,{cache:"no-store"}));
        if(response.ok) await cache.put(url,response);
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
  if(!SHELL_SET.has(request.url)) return;

  event.respondWith(
    caches.match(request).then(cached=>cached||fetch(request).then(response=>{
      if(response.ok){
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>{});
      }
      return response;
    }).catch(()=>{
      const indexUrl=new URL("./index.html",self.location.href).href;
      return request.mode==="navigate"?caches.match(indexUrl).then(r=>r||Response.error()):Response.error();
    }))
  );
});
