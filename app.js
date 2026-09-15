
// Keep full-screen dialogs aligned with Android's visual viewport when the on-screen keyboard opens.
function syncModalViewport(){
 const root=document.documentElement;
 const vv=window.visualViewport;
 if(vv){root.style.setProperty("--modal-vh", `${Math.round(vv.height)}px`);}
}
if(window.visualViewport){
 window.visualViewport.addEventListener("resize", syncModalViewport, {passive:true});
 window.visualViewport.addEventListener("scroll", syncModalViewport, {passive:true});
}
window.addEventListener("resize", syncModalViewport, {passive:true});
syncModalViewport();
// Local-only storage adapter. No network, account, API, or remote database is used.
// Defensive storage: schema versioning, checksums, last-known-good backup,
// corruption recovery, and migration from the previous local database format.
const LOCAL_STORAGE_PREFIX="marknest:";
const LOCAL_DB_KEY=LOCAL_STORAGE_PREFIX+"db:v2";
const LOCAL_BACKUP_KEY=LOCAL_STORAGE_PREFIX+"db:v2:backup";
const LOCAL_META_KEY=LOCAL_STORAGE_PREFIX+"meta";
const LOCAL_TABLES=["bookmarks","notes","categories","site_families"];
const LOCAL_SCHEMA_VERSION=2;
let localStorageReady=false;
function localEmptyState(){return Object.fromEntries(LOCAL_TABLES.map(t=>[t,[]]));}
function localJson(value){return JSON.stringify(value);}
function localChecksum(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(16).padStart(8,"0");}
function localEnvelope(data){const payload=localJson({schema:LOCAL_SCHEMA_VERSION,tables:data});return {schema:LOCAL_SCHEMA_VERSION,checksum:localChecksum(payload),payload};}
function localDecode(raw){
 try{
  const env=JSON.parse(raw);
  if(!env||env.schema!==LOCAL_SCHEMA_VERSION||typeof env.payload!=="string"||env.checksum!==localChecksum(env.payload))return null;
  const body=JSON.parse(env.payload);
  if(!body||body.schema!==LOCAL_SCHEMA_VERSION||!body.tables)return null;
  return Object.fromEntries(LOCAL_TABLES.map(t=>[t,Array.isArray(body.tables[t])?body.tables[t].map(row=>{
   if(!row||typeof row!=="object"||Array.isArray(row))return row;
   const clean={...row}; delete clean.user_id; return clean;
  }):[]]));
 }catch{return null}
}
function localStorageProbe(){try{const k=LOCAL_STORAGE_PREFIX+"probe";localStorage.setItem(k,"1");const ok=localStorage.getItem(k)==="1";localStorage.removeItem(k);return ok}catch{return false}}
function localStorageInit(){
 localStorageReady=localStorageProbe();
 if(!localStorageReady)throw new Error("This browser blocks persistent local storage. Open MarkNest as a normal site instead of a restricted/private iframe.");
 try{
  if(!localStorage.getItem(LOCAL_DB_KEY)){
   const old=localStorage.getItem("bookmark-vault-local-v1");
   if(old){const parsed=JSON.parse(old);const migrated=Object.fromEntries(LOCAL_TABLES.map(t=>[t,Array.isArray(parsed[t])?parsed[t]:[]]));localDbWrite(migrated);localStorage.removeItem("bookmark-vault-local-v1");}
  }
 }catch{}
}
function localDbRead(){
 if(!localStorageReady)localStorageInit();
 try{
  const current=localDecode(localStorage.getItem(LOCAL_DB_KEY)||"");if(current)return current;
  const backupRaw=localStorage.getItem(LOCAL_BACKUP_KEY)||"",backup=localDecode(backupRaw);
  if(backup){localStorage.setItem(LOCAL_DB_KEY,backupRaw);return backup;}
 }catch{}
 return localEmptyState();
}
function localDbWrite(data){
 if(!localStorageReady)localStorageInit();
 const normalized=Object.fromEntries(LOCAL_TABLES.map(t=>[t,Array.isArray(data[t])?data[t].map(row=>{
  if(!row||typeof row!=="object"||Array.isArray(row))return row;
  const clean={...row}; delete clean.user_id; return clean;
 }):[]]));
 const envelope=localEnvelope(normalized);
 const serialized=localJson(envelope);
 let old=null;
 try{old=localStorage.getItem(LOCAL_DB_KEY);if(old&&!localDecode(old))old=null;}catch{}
 try{
  localStorage.setItem(LOCAL_DB_KEY,serialized);
 }catch(e){
  throw new Error("Local storage is full or unavailable. Export your MarkNest, then remove some data or browser site data and try again.");
 }
 // Keep the previous valid snapshot as a recovery point. Failure here must not
 // roll back a successful primary write.
 if(old){try{localStorage.setItem(LOCAL_BACKUP_KEY,old)}catch{}}
 try{localStorage.setItem(LOCAL_META_KEY,localJson({schema:LOCAL_SCHEMA_VERSION,updatedAt:new Date().toISOString(),checksum:envelope.checksum,bytes:serialized.length}))}catch{}
 return true;
}
function localStoreError(message,code="LOCAL_ERROR"){return {message,code};}
function makeId(){
 const uuid=globalThis.crypto?.randomUUID?.();
 if(uuid)return uuid;
 const bytes=new Uint8Array(16);
 if(globalThis.crypto?.getRandomValues){globalThis.crypto.getRandomValues(bytes);return [...bytes].map(x=>x.toString(16).padStart(2,"0")).join("");}
 return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}
function localQuery(table,operation="select",payload=null){
 const state=localDbRead();let rows=state[table]||[],filters=[],orderSpec=null,projection=null,single=false,maybeSingle=false;
 const q={
  select(fields="*"){projection=fields;return q},order(field,{ascending=true}={}){orderSpec={field,ascending};return q},eq(field,value){filters.push(r=>r?.[field]===value);return q},in(field,values){const set=new Set(values||[]);filters.push(r=>set.has(r?.[field]));return q},single(){single=true;return q},maybeSingle(){maybeSingle=true;return q},
  then(resolve,reject){Promise.resolve().then(()=>{
   let data=rows.slice();
   if(operation==="insert"){const items=Array.isArray(payload)?payload:[payload],now=new Date().toISOString();const inserted=items.map(item=>({...item,id:item.id||makeId(),created_at:item.created_at||now,updated_at:item.updated_at||now}));if(table==="categories"||table==="site_families"){for(const item of inserted){if(data.some(x=>String(x.name).toLowerCase()===String(item.name).toLowerCase()))return {data:null,error:localStoreError(`A ${table.slice(0,-1)} with this name already exists.` ,"DUPLICATE")}}}state[table]=data.concat(inserted);localDbWrite(state);data=inserted;}
   else if(operation==="update"){data=data.filter(r=>filters.every(f=>f(r)));const now=new Date().toISOString();state[table]=state[table].map(r=>filters.every(f=>f(r))?({...r,...payload,updated_at:payload?.updated_at||now}):r);localDbWrite(state);}
   else if(operation==="delete"){const removed=state[table].filter(r=>filters.every(f=>f(r)));state[table]=state[table].filter(r=>!filters.every(f=>f(r)));localDbWrite(state);data=removed;}
   if(operation==="select")data=data.filter(r=>filters.every(f=>f(r)));else if(operation==="update")data=state[table].filter(r=>filters.every(f=>f(r)));
   if(orderSpec)data.sort((a,b)=>{const av=a?.[orderSpec.field],bv=b?.[orderSpec.field],cmp=av===bv?0:(av>bv?1:-1);return orderSpec.ascending?cmp:-cmp});
   if(projection&&projection!=="*"){const fields=projection.split(",").map(x=>x.trim()).filter(Boolean);data=data.map(r=>Object.fromEntries(fields.map(f=>[f,r?.[f]])))}
   if(single){if(data.length!==1)return {data:null,error:localStoreError(data.length?"Expected one row, found multiple.":"No rows found.","NOT_FOUND")};return {data:data[0],error:null}}
   if(maybeSingle){if(data.length>1)return {data:null,error:localStoreError("Expected zero or one row, found multiple.","NOT_FOUND")};return {data:data[0]||null,error:null}}
   return {data,error:null};
  }).then(resolve,reject)}
 };return q;
}
const store={from:table=>({select:fields=>localQuery(table,"select").select(fields),insert:payload=>localQuery(table,"insert",payload),update:payload=>localQuery(table,"update",payload),delete:()=>localQuery(table,"delete")})};
localStorageInit();
try{navigator.storage?.persist?.().catch?.(()=>{});}catch{}
let bookmarks=[], notes=[], categories=[], siteFamilies=[]; let loadSeq=0; let saving=false;
let selectedBookmarkIds=new Set();
let bookmarkSelectionMode=false;
let suppressNextBookmarkClickUntil=0;
let selectionAnchorId=null;
let selectedCategoryIds=new Set();
function storeGet(key,fallback=""){try{return localStorage.getItem(key)??fallback}catch{return fallback}}
function storeSet(key,value){try{localStorage.setItem(key,value)}catch{}}
let defaultBookmarkCategoryId=storeGet("marknest-default-bookmark-category","");
let loading=false;
let booted=false;
let lastOpener=null;
let lastFocusedScrollY=0;

const $=x=>document.getElementById(x);
const esc=s=>(s??"").toString().replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const domain=u=>{try{return new URL(u).hostname.toLowerCase().replace(/^www\./,"")}catch{return""}};
const normalizeDomain=s=>cleanText(s).toLowerCase().replace(/^[a-z]+:\/\//,"").replace(/^www\./,"").split("/")[0].split(":")[0];
function familyForUrl(u){const d=domain(u);if(!d)return null;return siteFamilies.find(f=>[f.primary_domain,...(f.aliases||[])].some(x=>{const n=normalizeDomain(x);return n&&(d===n||d.endsWith("."+n))}))||null;}
function familyName(id){return siteFamilies.find(f=>f.id===id)?.name||"";}
const EMBEDDED_SITE_CATALOG=[{"domain":"youtube.com","category":"Video & Media","name":"Youtube"},{"domain":"youtu.be","category":"Video & Media","name":"Youtu"},{"domain":"vimeo.com","category":"Video & Media","name":"Vimeo"},{"domain":"dailymotion.com","category":"Video & Media","name":"Dailymotion"},{"domain":"twitch.tv","category":"Video & Media","name":"Twitch"},{"domain":"imdb.com","category":"Video & Media","name":"Imdb"},{"domain":"ted.com","category":"Video & Media","name":"Ted"},{"domain":"netflix.com","category":"Video & Media","name":"Netflix"},{"domain":"spotify.com","category":"Video & Media","name":"Spotify"},{"domain":"soundcloud.com","category":"Video & Media","name":"Soundcloud"},{"domain":"facebook.com","category":"Social","name":"Facebook"},{"domain":"instagram.com","category":"Social","name":"Instagram"},{"domain":"x.com","category":"Social","name":"X"},{"domain":"twitter.com","category":"Social","name":"Twitter"},{"domain":"reddit.com","category":"Social","name":"Reddit"},{"domain":"discord.com","category":"Social","name":"Discord"},{"domain":"discord.gg","category":"Social","name":"Discord"},{"domain":"tiktok.com","category":"Social","name":"Tiktok"},{"domain":"pinterest.com","category":"Social","name":"Pinterest"},{"domain":"quora.com","category":"Social","name":"Quora"},{"domain":"tumblr.com","category":"Social","name":"Tumblr"},{"domain":"linkedin.com","category":"Social","name":"Linkedin"},{"domain":"openai.com","category":"AI","name":"Openai"},{"domain":"chatgpt.com","category":"AI","name":"Chatgpt"},{"domain":"claude.ai","category":"AI","name":"Claude"},{"domain":"gemini.google.com","category":"AI","name":"Gemini"},{"domain":"perplexity.ai","category":"AI","name":"Perplexity"},{"domain":"huggingface.co","category":"AI","name":"Huggingface"},{"domain":"character.ai","category":"AI","name":"Character"},{"domain":"poe.com","category":"AI","name":"Poe"},{"domain":"github.com","category":"Development","name":"Github"},{"domain":"gitlab.com","category":"Development","name":"Gitlab"},{"domain":"stackoverflow.com","category":"Development","name":"Stackoverflow"},{"domain":"stackexchange.com","category":"Development","name":"Stackexchange"},{"domain":"npmjs.com","category":"Development","name":"Npmjs"},{"domain":"pypi.org","category":"Development","name":"Pypi"},{"domain":"crates.io","category":"Development","name":"Crates"},{"domain":"rust-lang.org","category":"Development","name":"Rust Lang"},{"domain":"python.org","category":"Development","name":"Python"},{"domain":"w3.org","category":"Development","name":"W3"},{"domain":"vercel.com","category":"Development","name":"Vercel"},{"domain":"netlify.com","category":"Development","name":"Netlify"},{"domain":"firebase.google.com","category":"Development","name":"Firebase"},{"domain":"docker.com","category":"Development","name":"Docker"},{"domain":"cloudflare.com","category":"Development","name":"Cloudflare"},{"domain":"dev.to","category":"Development","name":"Dev"},{"domain":"hashnode.com","category":"Development","name":"Hashnode"},{"domain":"khanacademy.org","category":"Education","name":"Khanacademy"},{"domain":"coursera.org","category":"Education","name":"Coursera"},{"domain":"edx.org","category":"Education","name":"Edx"},{"domain":"udemy.com","category":"Education","name":"Udemy"},{"domain":"quizlet.com","category":"Education","name":"Quizlet"},{"domain":"duolingo.com","category":"Education","name":"Duolingo"},{"domain":"brilliant.org","category":"Education","name":"Brilliant"},{"domain":"mit.edu","category":"Education","name":"Mit"},{"domain":"stanford.edu","category":"Education","name":"Stanford"},{"domain":"ocw.mit.edu","category":"Education","name":"Ocw"},{"domain":"archive.org","category":"Books & Reading","name":"Archive"},{"domain":"gutenberg.org","category":"Books & Reading","name":"Gutenberg"},{"domain":"standardebooks.org","category":"Books & Reading","name":"Standardebooks"},{"domain":"openlibrary.org","category":"Books & Reading","name":"Openlibrary"},{"domain":"wikipedia.org","category":"Books & Reading","name":"Wikipedia"},{"domain":"wiktionary.org","category":"Books & Reading","name":"Wiktionary"},{"domain":"canva.com","category":"Tools","name":"Canva"},{"domain":"figma.com","category":"Tools","name":"Figma"},{"domain":"grammarly.com","category":"Tools","name":"Grammarly"},{"domain":"trello.com","category":"Tools","name":"Trello"},{"domain":"asana.com","category":"Tools","name":"Asana"},{"domain":"evernote.com","category":"Tools","name":"Evernote"},{"domain":"notion.so","category":"Tools","name":"Notion"},{"domain":"zoom.us","category":"Tools","name":"Zoom"},{"domain":"dropbox.com","category":"Tools","name":"Dropbox"},{"domain":"smallpdf.com","category":"Tools","name":"Smallpdf"},{"domain":"ilovepdf.com","category":"Tools","name":"Ilovepdf"},{"domain":"tinypng.com","category":"Tools","name":"Tinypng"},{"domain":"photopea.com","category":"Tools","name":"Photopea"},{"domain":"drawio.com","category":"Tools","name":"Drawio"},{"domain":"proton.me","category":"Privacy & Security","name":"Proton"},{"domain":"signal.org","category":"Privacy & Security","name":"Signal"},{"domain":"mozilla.org","category":"Privacy & Security","name":"Mozilla"},{"domain":"eff.org","category":"Privacy & Security","name":"Eff"},{"domain":"torproject.org","category":"Privacy & Security","name":"Torproject"},{"domain":"privacyguides.org","category":"Privacy & Security","name":"Privacyguides"},{"domain":"haveibeenpwned.com","category":"Privacy & Security","name":"Haveibeenpwned"},{"domain":"bandcamp.com","category":"Music","name":"Bandcamp"},{"domain":"last.fm","category":"Music","name":"Last"},{"domain":"bbc.com","category":"News","name":"Bbc"},{"domain":"cnn.com","category":"News","name":"Cnn"},{"domain":"nytimes.com","category":"News","name":"Nytimes"},{"domain":"theguardian.com","category":"News","name":"Theguardian"},{"domain":"reuters.com","category":"News","name":"Reuters"},{"domain":"apnews.com","category":"News","name":"Apnews"},{"domain":"npr.org","category":"News","name":"Npr"},{"domain":"amazon.com","category":"Shopping","name":"Amazon"},{"domain":"amazon.in","category":"Shopping","name":"Amazon"},{"domain":"amazon.co.uk","category":"Shopping","name":"Amazon"},{"domain":"ebay.com","category":"Shopping","name":"Ebay"},{"domain":"etsy.com","category":"Shopping","name":"Etsy"},{"domain":"paypal.com","category":"Shopping","name":"Paypal"},{"domain":"stripe.com","category":"Shopping","name":"Stripe"},{"domain":"wise.com","category":"Shopping","name":"Wise"},{"domain":"tripadvisor.com","category":"Travel","name":"Tripadvisor"},{"domain":"booking.com","category":"Travel","name":"Booking"},{"domain":"maps.google.com","category":"Travel","name":"Maps"},{"domain":"google.com","category":"Travel","name":"Google"},{"domain":"gov.uk","category":"Government","name":"Gov"},{"domain":"usa.gov","category":"Government","name":"Usa"},{"domain":"who.int","category":"Government","name":"Who"},{"domain":"un.org","category":"Government","name":"Un"},{"domain":"nasa.gov","category":"Science","name":"Nasa"},{"domain":"arxiv.org","category":"Science","name":"Arxiv"},{"domain":"nature.com","category":"Science","name":"Nature"},{"domain":"science.org","category":"Science","name":"Science"},{"domain":"behance.net","category":"Design","name":"Behance"},{"domain":"dribbble.com","category":"Design","name":"Dribbble"},{"domain":"unsplash.com","category":"Design","name":"Unsplash"},{"domain":"pexels.com","category":"Design","name":"Pexels"},{"domain":"roblox.com","category":"Gaming","name":"Roblox"},{"domain":"minecraft.net","category":"Gaming","name":"Minecraft"},{"domain":"epicgames.com","category":"Gaming","name":"Epicgames"},{"domain":"steampowered.com","category":"Gaming","name":"Steampowered"},{"domain":"playstation.com","category":"Gaming","name":"Playstation"},{"domain":"xbox.com","category":"Gaming","name":"Xbox"},{"domain":"ea.com","category":"Gaming","name":"Ea"},{"domain":"android.com","category":"Mobile","name":"Android"},{"domain":"developer.android.com","category":"Mobile","name":"Developer"},{"domain":"apple.com","category":"Mobile","name":"Apple"},{"domain":"icloud.com","category":"Mobile","name":"Icloud"},{"domain":"ubuntu.com","category":"Linux & macOS","name":"Ubuntu"},{"domain":"debian.org","category":"Linux & macOS","name":"Debian"},{"domain":"archlinux.org","category":"Linux & macOS","name":"Archlinux"},{"domain":"linux.org","category":"Linux & macOS","name":"Linux"},{"domain":"homebrew.sh","category":"Linux & macOS","name":"Homebrew"},{"domain":"mayoclinic.org","category":"Health","name":"Mayoclinic"},{"domain":"nih.gov","category":"Health","name":"Nih"},{"domain":"cdc.gov","category":"Health","name":"Cdc"},{"domain":"myanimelist.net","category":"Anime & Manga","name":"Myanimelist"},{"domain":"anilist.co","category":"Anime & Manga","name":"Anilist"},{"domain":"crunchyroll.com","category":"Anime & Manga","name":"Crunchyroll"},{"domain":"mangadex.org","category":"Anime & Manga","name":"Mangadex"}];
let SITE_CATALOG=EMBEDDED_SITE_CATALOG.slice();
const SAFE_CATEGORY_TAXONOMY=["AI","Anime & Manga","Books & Reading","Development","Design","Education","Gaming","Music","News","Privacy & Security","Productivity","Social","Tools","Video & Media","Mobile","Linux & macOS","Shopping","Travel","Government","Science","Health","Other"];
function loadSiteCatalog(){
 SITE_CATALOG=EMBEDDED_SITE_CATALOG.filter(x=>x&&typeof x.domain==="string");
 fillCatalogCategories();
}
function catalogMatch(u){const d=domain(u);if(!d)return null;let best=null;for(const x of SITE_CATALOG){const h=normalizeDomain(x.domain);if(!h)continue;if(d===h||d.endsWith("."+h)){if(!best||h.length>normalizeDomain(best.domain).length)best=x}}return best;}
function suggestedCategoryForUrl(u){return catalogMatch(u)?.category||""}
function fillCatalogCategories(){const dl=$("cats");if(!dl)return;const names=[...new Set([...categories.map(c=>c.name),...SAFE_CATEGORY_TAXONOMY])].sort((a,b)=>a.localeCompare(b));dl.innerHTML=names.map(x=>`<option value="${esc(x)}"></option>`).join("")}
function applySmartCategory(u,force=false){const suggestion=suggestedCategoryForUrl(u),field=$("category"),hint=$("categorySuggestion");if(!field||!hint)return;if(suggestion&&(!field.value.trim()||force)){field.value=suggestion;hint.textContent=`✨ Suggested category: ${suggestion}`;hint.classList.remove("hidden")}else if(!suggestion){hint.classList.add("hidden")}}
const POPULAR_SITE_LABELS={
 "youtube.com":"YouTube","youtu.be":"YouTube","google.com":"Google","gmail.com":"Gmail","mail.google.com":"Gmail","facebook.com":"Facebook","instagram.com":"Instagram","x.com":"X","twitter.com":"X","reddit.com":"Reddit","github.com":"GitHub","gitlab.com":"GitLab","linkedin.com":"LinkedIn","discord.com":"Discord","discord.gg":"Discord","tiktok.com":"TikTok","pinterest.com":"Pinterest","wikipedia.org":"Wikipedia","amazon.com":"Amazon","amazon.in":"Amazon","amazon.co.uk":"Amazon","microsoft.com":"Microsoft","office.com":"Microsoft 365","outlook.com":"Outlook","apple.com":"Apple","icloud.com":"iCloud","openai.com":"OpenAI","chatgpt.com":"ChatGPT","claude.ai":"Claude","gemini.google.com":"Gemini","notion.so":"Notion","canva.com":"Canva","figma.com":"Figma","slack.com":"Slack","zoom.us":"Zoom","dropbox.com":"Dropbox","drive.google.com":"Google Drive","docs.google.com":"Google Docs","sheets.google.com":"Google Sheets","calendar.google.com":"Google Calendar","maps.google.com":"Google Maps","translate.google.com":"Google Translate","stackoverflow.com":"Stack Overflow","stackexchange.com":"Stack Exchange","npmjs.com":"npm","pypi.org":"PyPI","vercel.com":"Vercel","netlify.com":"Netlify","firebase.google.com":"Firebase","medium.com":"Medium","dev.to":"DEV Community","hashnode.com":"Hashnode","coursera.org":"Coursera","edx.org":"edX","khanacademy.org":"Khan Academy","duolingo.com":"Duolingo","udemy.com":"Udemy","quizlet.com":"Quizlet","twitch.tv":"Twitch","spotify.com":"Spotify","soundcloud.com":"SoundCloud","telegram.org":"Telegram","whatsapp.com":"WhatsApp","web.whatsapp.com":"WhatsApp","signal.org":"Signal","proton.me":"Proton","archive.org":"Internet Archive","imdb.com":"IMDb","crates.io":"crates.io","rust-lang.org":"Rust","python.org":"Python","w3.org":"W3C","mozilla.org":"Mozilla","cloudflare.com":"Cloudflare","docker.com":"Docker","kaggle.com":"Kaggle","huggingface.co":"Hugging Face","perplexity.ai":"Perplexity","grammarly.com":"Grammarly","trello.com":"Trello","asana.com":"Asana","evernote.com":"Evernote","bbc.com":"BBC","cnn.com":"CNN","nytimes.com":"The New York Times","theguardian.com":"The Guardian","espn.com":"ESPN","weather.com":"The Weather Channel","tripadvisor.com":"Tripadvisor","booking.com":"Booking.com","paypal.com":"PayPal","stripe.com":"Stripe","wise.com":"Wise","zoom.us":"Zoom","reddit.com":"Reddit","quora.com":"Quora","tumblr.com":"Tumblr","vimeo.com":"Vimeo","dailymotion.com":"Dailymotion","roblox.com":"Roblox","minecraft.net":"Minecraft","epicgames.com":"Epic Games","steampowered.com":"Steam","ea.com":"EA","playstation.com":"PlayStation","xbox.com":"Xbox","nasa.gov":"NASA","gov.uk":"GOV.UK","usa.gov":"USA.gov","who.int":"WHO","un.org":"United Nations"
};
function labelKey(s){return cleanText(s).toLowerCase();}
function popularLabelForUrl(u){const d=domain(u);if(!d)return"";const exact=POPULAR_SITE_LABELS[d];if(exact)return exact;let best="";for(const [host,label] of Object.entries(POPULAR_SITE_LABELS)){if(d.endsWith("."+host)&&host.length>(best?best.length:0))best=host}return best?POPULAR_SITE_LABELS[best]:"";}
function normalizedBookmarkTitle(title,url){const raw=cleanText(title), preferred=popularLabelForUrl(url);if(!raw)return preferred||"";if(preferred&&labelKey(raw)===labelKey(preferred))return preferred;return raw;}
function domainsForLabel(title,extraUrl=""){const key=labelKey(title);const set=new Set();for(const b of bookmarks){if(labelKey(b.title)!==key)continue;const d=domain(b.url);if(d)set.add(d)}const extra=domain(extraUrl);if(extra)set.add(extra);return [...set];}
async function ensureLabelFamily(title,url,existingFamilyId=null){
 const preferred=popularLabelForUrl(url);const familyKey=labelKey(title);if(!familyKey)return existingFamilyId||null;
 if(existingFamilyId){return existingFamilyId}
 let family=siteFamilies.find(f=>labelKey(f.name)===familyKey);
 const peerBookmarks=bookmarks.filter(b=>labelKey(b.title)===familyKey);
 const domains=domainsForLabel(title,url);
 if(!family && !preferred && domains.length<2)return familyForUrl(url)?.id||null;
 if(!family){
  const preferredDomain=preferred?domain(url):domains[0];
  const primary=preferredDomain||domains[0];
  const aliases=[...new Set(domains.filter(d=>d!==primary))].slice(0,50);
  const r=await store.from("site_families").insert({name:preferred||cleanText(title),primary_domain:primary,aliases}).select().single();
  if(r.error){if(r.error.code==="DUPLICATE"){const again=await store.from("site_families").select("*").eq("name",preferred||cleanText(title)).maybeSingle();if(again.error)throw again.error;family=again.data||null}else throw r.error}else family=r.data;
  if(family){siteFamilies.push(family);if(peerBookmarks.length){const ids=peerBookmarks.map(b=>b.id);const ur=await store.from("bookmarks").update({site_family_id:family.id}).in("id",ids);if(ur.error)throw ur.error;bookmarks=bookmarks.map(b=>ids.includes(b.id)?({...b,site_family_id:family.id}):b)}}
 }
 if(!family)return familyForUrl(url)?.id||null;
 const currentDomain=domain(url);
 const familyDomains=[normalizeDomain(family.primary_domain),...(family.aliases||[]).map(normalizeDomain)].filter(Boolean);
 if(currentDomain&&!familyDomains.some(d=>currentDomain===d||currentDomain.endsWith("."+d))){
  const nextAliases=[...new Set([...(family.aliases||[]).map(normalizeDomain),currentDomain])].filter(d=>d!==normalizeDomain(family.primary_domain)).slice(0,50);
  if(nextAliases.length!==((family.aliases||[]).length)){const ur=await store.from("site_families").update({aliases:nextAliases,updated_at:new Date().toISOString()}).eq("id",family.id);if(ur.error)throw ur.error;family.aliases=nextAliases}
 }
 return family.id;
}

function siteLogoUrl(raw){
  if(storeGet("marknest-load-logos","off")!=="on")return "";
  try{const u=new URL(raw);if(!["http:","https:"].includes(u.protocol)||!u.hostname)return "";return `${u.origin}/favicon.ico`;}catch{return ""}
}
const icon=siteLogoUrl;
const cat=id=>categories.find(x=>x.id===id)?.name||"";
const cleanText=s=>(s??"").toString().trim();
const toBool=v=>typeof v==="boolean"?v:/^(1|true|yes|y)$/i.test(String(v??"").trim());
const tags=a=>(a||[]).map(x=>cleanText(x)).filter(Boolean).slice(0,30).map(x=>`<span class="tag">#${esc(x)}</span>`).join("");

const POPULAR_SITE_CANONICALS={
 "youtube.com":"https://www.youtube.com/", "youtu.be":"https://www.youtube.com/",
 "google.com":"https://www.google.com/", "gmail.com":"https://mail.google.com/", "mail.google.com":"https://mail.google.com/",
 "facebook.com":"https://www.facebook.com/", "instagram.com":"https://www.instagram.com/", "x.com":"https://x.com/", "twitter.com":"https://twitter.com/",
 "reddit.com":"https://www.reddit.com/", "github.com":"https://github.com/", "gitlab.com":"https://gitlab.com/", "linkedin.com":"https://www.linkedin.com/",
 "discord.com":"https://discord.com/", "discord.gg":"https://discord.com/", "tiktok.com":"https://www.tiktok.com/", "pinterest.com":"https://www.pinterest.com/",
 "wikipedia.org":"https://www.wikipedia.org/", "amazon.com":"https://www.amazon.com/", "amazon.in":"https://www.amazon.in/", "amazon.co.uk":"https://www.amazon.co.uk/",
 "microsoft.com":"https://www.microsoft.com/", "office.com":"https://www.office.com/", "outlook.com":"https://outlook.live.com/", "apple.com":"https://www.apple.com/", "icloud.com":"https://www.icloud.com/",
 "openai.com":"https://openai.com/", "chatgpt.com":"https://chatgpt.com/", "claude.ai":"https://claude.ai/", "gemini.google.com":"https://gemini.google.com/",
 "notion.so":"https://www.notion.so/", "canva.com":"https://www.canva.com/", "figma.com":"https://www.figma.com/", "slack.com":"https://slack.com/", "zoom.us":"https://zoom.us/", "dropbox.com":"https://www.dropbox.com/",
 "drive.google.com":"https://drive.google.com/", "docs.google.com":"https://docs.google.com/", "sheets.google.com":"https://sheets.google.com/", "calendar.google.com":"https://calendar.google.com/", "maps.google.com":"https://maps.google.com/", "translate.google.com":"https://translate.google.com/",
 "stackoverflow.com":"https://stackoverflow.com/", "stackexchange.com":"https://stackexchange.com/", "npmjs.com":"https://www.npmjs.com/", "pypi.org":"https://pypi.org/", "vercel.com":"https://vercel.com/", "netlify.com":"https://www.netlify.com/", "firebase.google.com":"https://firebase.google.com/",
 "medium.com":"https://medium.com/", "dev.to":"https://dev.to/", "hashnode.com":"https://hashnode.com/", "coursera.org":"https://www.coursera.org/", "edx.org":"https://www.edx.org/", "khanacademy.org":"https://www.khanacademy.org/", "duolingo.com":"https://www.duolingo.com/", "udemy.com":"https://www.udemy.com/", "quizlet.com":"https://quizlet.com/",
 "twitch.tv":"https://www.twitch.tv/", "spotify.com":"https://open.spotify.com/", "soundcloud.com":"https://soundcloud.com/", "telegram.org":"https://telegram.org/", "whatsapp.com":"https://www.whatsapp.com/", "web.whatsapp.com":"https://web.whatsapp.com/", "signal.org":"https://signal.org/", "proton.me":"https://proton.me/",
 "archive.org":"https://archive.org/", "imdb.com":"https://www.imdb.com/", "crates.io":"https://crates.io/", "rust-lang.org":"https://www.rust-lang.org/", "python.org":"https://www.python.org/", "w3.org":"https://www.w3.org/", "mozilla.org":"https://www.mozilla.org/", "cloudflare.com":"https://www.cloudflare.com/", "docker.com":"https://www.docker.com/", "kaggle.com":"https://www.kaggle.com/", "huggingface.co":"https://huggingface.co/", "perplexity.ai":"https://www.perplexity.ai/",
 "grammarly.com":"https://www.grammarly.com/", "trello.com":"https://trello.com/", "asana.com":"https://asana.com/", "evernote.com":"https://evernote.com/", "bbc.com":"https://www.bbc.com/", "cnn.com":"https://edition.cnn.com/", "nytimes.com":"https://www.nytimes.com/", "theguardian.com":"https://www.theguardian.com/", "espn.com":"https://www.espn.com/", "weather.com":"https://weather.com/", "tripadvisor.com":"https://www.tripadvisor.com/", "booking.com":"https://www.booking.com/"
};
function completeUrl(raw){
 const value=cleanText(raw).replace(/[\u0000-\u001F]/g,"");
 if(!value)return"";
 const bare=value.toLowerCase().replace(/^https?:\/\//,"").replace(/^www\./,"");
 const hostKey=bare.split(/[/?#]/,1)[0];
 const rootOnly=!/[/?#]/.test(bare)||/^\/?$/.test(bare.slice(hostKey.length));
 const known=POPULAR_SITE_CANONICALS[hostKey];
 if(known && rootOnly)return known;
 if(/^https?:\/\//i.test(value)){try{const u=new URL(value);if(!u.pathname)u.pathname="/";return u.href}catch{return""}}
 const candidate="https://"+value;
 try{const u=new URL(candidate);if(!u.hostname.includes("."))return"";if(!u.pathname)u.pathname="/";return u.href}catch{return""}
}
function safeHref(u){try{let x=new URL(u);return ["http:","https:"].includes(x.protocol)?x.href:""}catch{return ""}}
function canonicalUrl(u){const h=safeHref(u);if(!h)return "";try{const x=new URL(h);x.hash="";if((x.protocol==="https:"&&x.port==="443")||(x.protocol==="http:"&&x.port==="80"))x.port="";const rawHost=x.hostname.toLowerCase();const key=rawHost.replace(/^www\./,"");const known=POPULAR_SITE_CANONICALS[key];if(known){const k=new URL(known);x.hostname=k.hostname;x.protocol=k.protocol;if(x.pathname==="/"&&!x.search&&!x.hash){x.pathname="/";}}let out=x.href;if(out.length>8&&out.endsWith("/")&&x.pathname==="/")out=out.slice(0,-1);return out}catch{return h}}
const MAX_URL_LENGTH=2048;
function safeImageSrc(u){try{const x=new URL(u,location.href);if(x.origin===location.origin||x.protocol==="data:")return x.href;if(storeGet("marknest-load-logos","off")==="on"&&x.protocol==="https:"){if(x.pathname==="/favicon.ico"&&x.search==="")return x.href;}return "";}catch{return ""}}
const THEMES=[
{id:"midnight",name:"Midnight",hint:"Sleek dark",swatch:"linear-gradient(135deg,#0b0e14,#8b7cff)"},
{id:"vampire",name:"Vampire",hint:"Dark crimson",swatch:"linear-gradient(135deg,#120b10,#e05278)"},
{id:"ocean",name:"Ocean",hint:"Deep cyan",swatch:"linear-gradient(135deg,#071319,#31c7d8)"},
{id:"forest",name:"Forest",hint:"Emerald dark",swatch:"linear-gradient(135deg,#0b130f,#50c878)"},
{id:"sunset",name:"Sunset",hint:"Warm glow",swatch:"linear-gradient(135deg,#1a1012,#ff9a5c)"},
{id:"amethyst",name:"Amethyst",hint:"Violet night",swatch:"linear-gradient(135deg,#120d1b,#c084fc)"},
{id:"paper",name:"Paper Light",hint:"Warm clean",swatch:"linear-gradient(135deg,#f4f0e8,#3867d6)"},
{id:"arctic",name:"Arctic",hint:"Cool light",swatch:"linear-gradient(135deg,#edf5f8,#147fa1)"},
{id:"terminal",name:"Terminal",hint:"Green screen",swatch:"linear-gradient(135deg,#050805,#4cff70)"},
{id:"m3-blue",name:"Material You • Blue",hint:"Soft indigo",swatch:"linear-gradient(135deg,#f7f9ff,#4f5f92)"},
{id:"m3-green",name:"Material You • Green",hint:"Natural green",swatch:"linear-gradient(135deg,#f5fbf2,#49664b)"},
{id:"m3-purple",name:"Material You • Purple",hint:"Gentle violet",swatch:"linear-gradient(135deg,#fbf8ff,#705575)"},
{id:"m3-rose",name:"Material You • Rose",hint:"Soft rose",swatch:"linear-gradient(135deg,#fff8f8,#8c4a52)"},
{id:"m3-orange",name:"Material You • Orange",hint:"Warm peach",swatch:"linear-gradient(135deg,#fff8f5,#8b4e2f)"},
{id:"m3-monochrome",name:"Material You • Mono",hint:"Neutral minimal",swatch:"linear-gradient(135deg,#f9f9f9,#5f5f5f)"},
{id:"m3-dark",name:"Material You • Dark",hint:"Dark indigo",swatch:"linear-gradient(135deg,#111318,#b9c3ff)"},
{id:"m3-black",name:"Material You • Black",hint:"True black",swatch:"linear-gradient(135deg,#000000,#c4c8ff)"}
];
function applyTheme(id,save=true){const theme=THEMES.some(t=>t.id===id)?id:"midnight";document.documentElement.dataset.theme=theme;const meta=$("themeColorMeta");if(meta){const m={midnight:"#0b0e14",vampire:"#120b10",ocean:"#071319",forest:"#0b130f",sunset:"#1a1012",amethyst:"#120d1b",paper:"#f4f0e8",arctic:"#edf5f8",terminal:"#050805","m3-blue":"#f7f9ff","m3-green":"#f5fbf2","m3-purple":"#fbf8ff","m3-rose":"#fff8f8","m3-orange":"#fff8f5","m3-monochrome":"#f9f9f9","m3-dark":"#111318","m3-black":"#000000"};meta.content=m[theme]||m.midnight;document.documentElement.dataset.scheme=(theme==="m3-dark"||theme==="m3-black"||["midnight","vampire","ocean","forest","sunset","amethyst","terminal"].includes(theme))?"dark":"light"}document.querySelectorAll(".themeChoice").forEach(x=>x.classList.toggle("active",x.dataset.theme===theme));if(save)storeSet("marknest-theme",theme);}
function renderThemes(){const grid=$("themeGrid");if(!grid)return;grid.innerHTML=THEMES.map(t=>`<button type="button" class="themeChoice" data-theme="${t.id}" aria-label="Use ${esc(t.name)} theme"><span class="themeSwatch themeSwatch-${t.id}" aria-hidden="true"></span><span><span class="themeName">${esc(t.name)}</span><span class="themeHint">${esc(t.hint)}</span></span></button>`).join("");applyTheme(storeGet("marknest-theme","midnight"),false);}
function utilityFocusable(){const p=$("utilityPanel");if(!p)return[];return [...p.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled])')].filter(el=>el.getClientRects().length);}
function closeUtilityPanel({restoreFocus=true}={}){const p=$("utilityPanel"),b=$("utilityToggle"),backdrop=$("utilityBackdrop");if(!p)return;p.classList.add("hidden");p.setAttribute("aria-hidden","true");b?.setAttribute("aria-expanded","false");backdrop?.classList.add("hidden");backdrop?.setAttribute("aria-hidden","true");document.body.classList.remove("utilityOpen");if(restoreFocus&&b&&document.contains(b))setTimeout(()=>b.focus(),0);}
function openUtilityPanel(){const p=$("utilityPanel"),b=$("utilityToggle"),backdrop=$("utilityBackdrop");if(!p)return;window.__utilityOpener=document.activeElement||b;p.classList.remove("hidden");p.setAttribute("aria-hidden","false");b?.setAttribute("aria-expanded","true");backdrop?.classList.remove("hidden");backdrop?.setAttribute("aria-hidden","false");document.body.classList.add("utilityOpen");renderThemes();const a=$("utilityAccount");if(a)a.textContent=$("account")?.textContent||"";const current=THEMES.find(t=>t.id===storeGet("marknest-theme","midnight"));const n=$("currentThemeName");if(n)n.textContent=current?.name||"Midnight";setTimeout(()=>{if(p.classList.contains("hidden"))return;const f=utilityFocusable();const active=p.querySelector(".utilityItem.active");(active&&active.getClientRects().length?active:f[0])?.focus();},0);}
function toggleUtilityPanel(){const p=$("utilityPanel");if(!p)return;p.classList.contains("hidden")?openUtilityPanel():closeUtilityPanel();}

function status(msg){const el=$("busy");if(!el)return;el.textContent=msg;el.classList.remove("hidden");clearTimeout(status._t);status._t=setTimeout(()=>el.classList.add("hidden"),1800);}
applyTheme(storeGet("marknest-theme","midnight"),false);
function bookmarkCard(b,selectable=bookmarkSelectionMode){
 const href=safeHref(b.url); const favicon=safeImageSrc(b.favicon_url);
 const selected=selectedBookmarkIds.has(b.id);
 const selector=selectable?`<button type="button" class="selectItem ${selected?"selectChecked":""}" data-select-bookmark="${esc(b.id)}" aria-label="${selected?"Deselect":"Select"} bookmark ${esc(b.title)}" aria-pressed="${selected}"><span aria-hidden="true"></span></button>`:"";
 const actions=bookmarkSelectionMode&&selected?`<div class="itemActions"><button type="button" class="mini" aria-label="Edit bookmark" data-action="edit-bookmark" data-id="${esc(b.id)}">Edit</button><button type="button" class="mini" aria-label="Delete bookmark" data-action="delete-bookmark" data-id="${esc(b.id)}">Delete</button><button type="button" class="mini star" aria-label="Toggle favorite" data-action="favorite" data-id="${esc(b.id)}">${b.is_favorite?"★":"☆"}</button></div>`:"";
 return `<article class="item ${selected?"selectedItem":""}" data-bookmark-id="${esc(b.id)}" aria-selected="${selected}">${selector}<div class="itemHead"><div class="favicon">${favicon?`<img src="${esc(favicon)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" class="faviconImg">`:"🔖"}</div><div class="itemMain"><div class="itemTitle">${esc(b.title)}</div><a class="itemUrl" href="${href?esc(href):"#"}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${esc(b.url)}</a></div></div>
 ${b.description?`<div class="itemDesc">${esc(b.description)}</div>`:""}<div class="tags bookmarkMetaTags"><span class="tag categoryTag">${esc(cat(b.category_id)||"Uncategorized")}</span>${familyName(b.site_family_id)?`<span class="tag familyTag">Family · ${esc(familyName(b.site_family_id))}</span>`:""}${tags(b.tags)}</div>
 ${actions}</article>`;
}
function noteCard(n){
 return `<article class="item"><div class="itemTitle">${n.is_pinned?"📌 ":""}${esc(n.title)}</div><div class="noteContent">${esc(n.content||"")}</div><div class="tags">${cat(n.category_id)?`<span class="tag">${esc(cat(n.category_id))}</span>`:""}${tags(n.tags)}</div><div class="itemActions"><button type="button" class="mini" aria-label="Edit note" data-action="edit-note" data-id="${esc(n.id)}">Edit</button><button type="button" class="mini" aria-label="Delete note" data-action="delete-note" data-id="${esc(n.id)}">Delete</button></div></article>`;
}
function render(){
 fillCatalogCategories();
 $("bookmarkCount").textContent=bookmarks.length;$("noteCount").textContent=notes.length;$("favoriteCount").textContent=bookmarks.filter(x=>x.is_favorite).length;
 fillCats();fillFamilies();renderBookmarks();renderNotes();
 let all=[...bookmarks.map(x=>({...x,t:"b"})),...notes.map(x=>({...x,t:"n"}))].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,6);
 $("recent").innerHTML=all.length?all.map(x=>x.t==="b"?bookmarkCard(x,false):noteCard(x)).join(""):`<div class="empty"><strong>Your MarkNest is empty</strong>Add your first bookmark or note.</div>`;
}
function fillCats(){
 let o=categories.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("");
 const currentBookmarkFilter=$("bookmarkCategory").value;
 const currentNoteFilter=$("noteCategory").value;
 $("bookmarkCategory").innerHTML=`<option value="">All categories</option><option value="__uncategorized__">Uncategorized</option>${o}`;
 $("noteCategory").innerHTML=`<option value="">All categories</option><option value="__uncategorized__">Uncategorized</option>${o}`;
 $("bookmarkCategory").value=(currentBookmarkFilter==="__uncategorized__"||categories.some(c=>c.id===currentBookmarkFilter))?currentBookmarkFilter:"";
 $("noteCategory").value=(currentNoteFilter==="__uncategorized__"||categories.some(c=>c.id===currentNoteFilter))?currentNoteFilter:"";
 const d=$("defaultBookmarkCategory");
 if(d){
   d.innerHTML=`<option value="">Default category: None</option>${o}`;
   if(!categories.some(c=>c.id===defaultBookmarkCategoryId)) defaultBookmarkCategoryId="";
   d.value=defaultBookmarkCategoryId;
 }
 const bulk=$("bulkBookmarkCategory");
 if(bulk){
   const current=bulk.value;
   bulk.innerHTML=`<option value="">No category / Uncategorized</option>${o}`;
   bulk.value=current===""||categories.some(c=>c.id===current)?current:"";
 }
 $("cats").innerHTML=categories.map(c=>`<option value="${esc(c.name)}">`).join("");
}
function renderBookmarks(){
 let a=visibleBookmarks();
 $("bookmarkGrid").innerHTML=a.length?a.map(bookmarkCard).join(""):`<div class="empty"><strong>No bookmarks found</strong>Try another search or add a bookmark.</div>`;
 syncBookmarkSelection();
}
function renderNotes(){
 let q=$("noteSearch").value.toLowerCase(),c=$("noteCategory").value;
 let a=notes.filter(x=>{const categoryMatch=!c||(c==="__uncategorized__"?!x.category_id:x.category_id===c);return categoryMatch&&[x.title,x.content,(x.tags||[]).join(" ")].join(" ").toLowerCase().includes(q)}).sort((a,b)=>Number(b.is_pinned)-Number(a.is_pinned));
 $("noteGrid").innerHTML=a.length?a.map(noteCard).join(""):`<div class="empty"><strong>No notes found</strong>Write something worth remembering.</div>`;
}
async function load(){
 const seq=++loadSeq;
 const [b,n,c,f]=await Promise.all([
  store.from("bookmarks").select("*").order("created_at",{ascending:false}),
  store.from("notes").select("*").order("created_at",{ascending:false}),
  store.from("categories").select("*").order("name"),
  store.from("site_families").select("*").order("name")
 ]);
 if(seq!==loadSeq)return;
 if(b.error)throw b.error;if(n.error)throw n.error;if(c.error)throw c.error;if(f.error)throw f.error;
 bookmarks=b.data||[];notes=n.data||[];categories=c.data||[];siteFamilies=f.data||[];render();
}
async function fillFamilies(){
 const select=$("siteFamily");if(!select)return;
 const current=select.value;
 select.innerHTML='<option value="">No site family</option>'+siteFamilies.slice().sort((a,b)=>a.name.localeCompare(b.name)).map(f=>`<option value="${esc(f.id)}">${esc(f.name)} · ${esc(f.primary_domain)}</option>`).join("");
 select.value=siteFamilies.some(f=>f.id===current)?current:"";
}
function validFamilyDomain(value){const d=normalizeDomain(value);if(!d||d.includes(" ")||!d.includes("."))return"";try{new URL("https://"+d);return d}catch{return""}}
function visibleBookmarks(){
 let q=$("bookmarkSearch")?.value.toLowerCase()||"",c=$("bookmarkCategory")?.value||"";
 return bookmarks.filter(x=>{
  const categoryMatch=!c||(c==="__uncategorized__"?!x.category_id:x.category_id===c);
  return categoryMatch&&[x.title,x.url,x.description,familyName(x.site_family_id),(x.tags||[]).join(" ")].join(" ").toLowerCase().includes(q);
 });
}
function syncBookmarkSelection(){
 const visible=new Set(visibleBookmarks().map(x=>x.id));
 selectedBookmarkIds.forEach(id=>{if(!visible.has(id))selectedBookmarkIds.delete(id)});
 const count=selectedBookmarkIds.size;
 if(count===0&&bookmarkSelectionMode){selectionAnchorId=null;}
 const visibleCount=visible.size;
 const selectedVisible=[...visible].filter(id=>selectedBookmarkIds.has(id)).length;
 const allVisible=visibleCount>0&&selectedVisible===visibleCount;
 $("selectedBookmarkCount").textContent=`${count} selected`;
 const selectionHint=$("selectionHint");
 if(selectionHint) selectionHint.textContent=window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ? "Shift-click = range · Ctrl/Cmd-click = toggle" : "Tap a bookmark to select or deselect";
 $("bookmarkGrid").classList.toggle("selectionMode",bookmarkSelectionMode);
 $("bookmarkGrid").setAttribute("aria-multiselectable","true");
 $("bulkApplyBookmarks").disabled=count===0;
 const selectAll=$("selectAllBookmarks");
 if(selectAll){selectAll.disabled=visibleCount===0;selectAll.textContent=allVisible?"Deselect all":"Select all";selectAll.setAttribute("aria-label",allVisible?"Deselect all visible bookmarks":"Select all visible bookmarks");}
 const invert=$("invertBookmarkSelection");if(invert)invert.disabled=visibleCount===0;
 $("bookmarkBulkBar").classList.toggle("hidden",count===0);
 const selectModeBtn=$("toggleBookmarkSelection");if(selectModeBtn){selectModeBtn.textContent=bookmarkSelectionMode?"Cancel":"Select";selectModeBtn.setAttribute("aria-pressed",String(bookmarkSelectionMode));selectModeBtn.classList.toggle("active",bookmarkSelectionMode);}
}
function renderCategoryManager(){
 const list=$("categoryList");if(!list)return;
 list.innerHTML=categories.length?categories.map(c=>{
   const count=bookmarks.filter(b=>b.category_id===c.id).length;
   return `<label class="categoryRow"><input type="checkbox" class="categorySelect" data-category-select="${esc(c.id)}" ${selectedCategoryIds.has(c.id)?"checked":""} aria-label="Select category ${esc(c.name)}"><span class="categoryRowMain"><strong>${esc(c.name)}</strong><small>${count} bookmark${count===1?"":"s"}</small></span></label>`;
 }).join(""):'<div class="empty"><strong>No categories yet</strong>Create one above.</div>';
 $("selectedCategoryCount").textContent=`${selectedCategoryIds.size} selected`;
 $("bulkDeleteCategories").disabled=selectedCategoryIds.size===0;
 $("selectAllCategories").checked=categories.length>0&&categories.every(c=>selectedCategoryIds.has(c.id));
 $("selectAllCategories").indeterminate=selectedCategoryIds.size>0&&selectedCategoryIds.size<categories.length;
}
function openCategoryManager(){
 lastOpener=document.activeElement;$("categoryModal").classList.remove("hidden");document.body.classList.add("modalOpen");$("app").inert=true;selectedCategoryIds.clear();$("newCategoryName").value="";$("categoryCreateError").classList.add("hidden");renderCategoryManager();setTimeout(()=>$("newCategoryName").focus(),0);
}
function closeCategoryManager(){if(actionBusy)return;$("categoryModal").classList.add("hidden");document.body.classList.remove("modalOpen");$("app").inert=false;if(lastOpener&&document.contains(lastOpener))lastOpener.focus();lastOpener=null}
async function createCategoryFromManager(){
 const name=cleanText($("newCategoryName").value);
 if(!name||name.length>80){$("categoryCreateError").textContent="Enter a category name up to 80 characters.";$("categoryCreateError").classList.remove("hidden");return}
 await runAction("Creating category…",async()=>{await categoryId(name);$("newCategoryName").value="";$("categoryCreateError").classList.add("hidden");render();renderCategoryManager();status("Category created")});
}
async function bulkDeleteCategories(){
 const ids=[...selectedCategoryIds].filter(id=>categories.some(c=>c.id===id));if(!ids.length)return;
 const names=categories.filter(c=>ids.includes(c.id)).map(c=>c.name).join(", ");
 if(!confirm(`Delete ${ids.length} categor${ids.length===1?"y":"ies"}: ${names}? Bookmarks will be kept and become uncategorized.`))return;
 await runAction(`Deleting ${ids.length} categor${ids.length===1?"y":"ies"}…`,async()=>{
   const u=await store.from("bookmarks").update({category_id:null}).in("category_id",ids);if(u.error)throw u.error;
   const n=await store.from("notes").update({category_id:null}).in("category_id",ids);if(n.error)throw n.error;
   const d=await store.from("categories").delete().in("id",ids);if(d.error)throw d.error;
   selectedCategoryIds.clear();if(ids.includes(defaultBookmarkCategoryId)){defaultBookmarkCategoryId="";storeSet("marknest-default-bookmark-category","")}
   await load();renderCategoryManager();status(`Deleted ${ids.length} categor${ids.length===1?"y":"ies"}`);
 });
}
function selectedBookmarks(){return bookmarks.filter(b=>selectedBookmarkIds.has(b.id));}
function updateBulkActionUi(){
 const action=$("bulkBookmarkAction")?.value||"";
 $("bulkBookmarkCategoryWrap")?.classList.toggle("hidden",action!=="move");
}
function selectedExportRows(){
 return selectedBookmarks().map(b=>({
  title:cleanText(b.title),url:safeHref(b.url),description:cleanText(b.description),
  tags:Array.isArray(b.tags)?b.tags.slice(0,30).map(cleanText).filter(Boolean):[],
  category:cat(b.category_id),site_family:familyName(b.site_family_id),site_family_primary:siteFamilies.find(f=>f.id===b.site_family_id)?.primary_domain||"",site_family_aliases:siteFamilies.find(f=>f.id===b.site_family_id)?.aliases||[],is_favorite:toBool(b.is_favorite),is_archived:toBool(b.is_archived)
 })).filter(b=>b.url);
}
function bulkExportSelected(){
 const rows=selectedExportRows();if(!rows.length){status("No selected bookmarks to export");return}
 const fmt=$("bookmarkExportFormat")?.value||"json";const stamp=new Date().toISOString().slice(0,10);let filename,content,mime;
 if(fmt==="json"){filename=`bookmarks-selected-${stamp}.json`;content=JSON.stringify({exported_at:new Date().toISOString(),site_families:siteFamilies,bookmarks:rows},null,2);mime="application/json"}
 else if(fmt==="csv"){filename=`bookmarks-selected-${stamp}.csv`;content=exportCsv(rows,",");mime="text/csv"}
 else if(fmt==="tsv"){filename=`bookmarks-selected-${stamp}.tsv`;content=exportCsv(rows,"\t");mime="text/tab-separated-values"}
 else if(fmt==="html"){filename=`bookmarks-selected-${stamp}.html`;content=exportNetscapeHtml(rows);mime="text/html"}
 else if(fmt==="txt"){filename=`bookmarks-selected-${stamp}.txt`;content=exportTxt(rows);mime="text/plain"}
 else{filename=`bookmarks-selected-${stamp}.md`;content=exportMarkdown(rows);mime="text/markdown"}
 downloadFile(filename,content,mime);status(`Exported ${rows.length} selected bookmark${rows.length===1?"":"s"} as ${fmt.toUpperCase()}`);
}
async function bulkMoveBookmarks(){
 const ids=[...selectedBookmarkIds].filter(id=>bookmarks.some(b=>b.id===id));if(!ids.length)return;
 const categoryId=$("bulkBookmarkCategory").value||null;const target=categoryId?cat(categoryId):"No category / Uncategorized";
 if(!confirm(`Move ${ids.length} selected bookmark${ids.length===1?"":"s"} to ${target}?`))return;
 await runAction(`Moving ${ids.length} bookmarks…`,async()=>{
  const r=await store.from("bookmarks").update({category_id:categoryId,updated_at:new Date().toISOString()}).in("id",ids);if(r.error)throw r.error;
  selectedBookmarkIds.clear();await load();status(`Moved ${ids.length} bookmark${ids.length===1?"":"s"} to ${target}`);
 });
}
async function bulkSetBookmarkField(field,value,verb){
 const ids=[...selectedBookmarkIds].filter(id=>bookmarks.some(b=>b.id===id));if(!ids.length)return;
 await runAction(`${verb} ${ids.length} bookmarks…`,async()=>{
  const r=await store.from("bookmarks").update({[field]:value,updated_at:new Date().toISOString()}).in("id",ids);if(r.error)throw r.error;
  selectedBookmarkIds.clear();await load();status(`${verb} ${ids.length} bookmark${ids.length===1?"":"s"}`);
 });
}
async function applyBulkBookmarkAction(){
 const action=$("bulkBookmarkAction")?.value||"";if(!action)return;
 if(action==="delete")await bulkDeleteBookmarks();
 else if(action==="move")await bulkMoveBookmarks();
 else if(action==="export")bulkExportSelected();
 else if(action==="favorite")await bulkSetBookmarkField("is_favorite",true,"Added to favorites:");
 else if(action==="unfavorite")await bulkSetBookmarkField("is_favorite",false,"Removed from favorites:");
 else if(action==="archive")await bulkSetBookmarkField("is_archived",true,"Archived");
 else if(action==="unarchive")await bulkSetBookmarkField("is_archived",false,"Unarchived");
 if($("bulkBookmarkAction"))$("bulkBookmarkAction").value="";updateBulkActionUi();
}

async function bulkDeleteBookmarks(){
 const ids=[...selectedBookmarkIds].filter(id=>bookmarks.some(b=>b.id===id));if(!ids.length)return;
 if(!confirm(`Delete ${ids.length} selected bookmark${ids.length===1?"":"s"}? This cannot be undone.`))return;
 await runAction(`Deleting ${ids.length} bookmarks…`,async()=>{
   const r=await store.from("bookmarks").delete().in("id",ids);if(r.error)throw r.error;
   selectedBookmarkIds.clear();await load();status(`Deleted ${ids.length} bookmark${ids.length===1?"":"s"}`);
 });
}
function renderFamilies(){
 const list=$("familyList");if(!list)return;
 list.innerHTML=siteFamilies.length?siteFamilies.map(f=>`<article class="familyCard"><h3>${esc(f.name)}</h3><div class="familyPrimary">Primary: ${esc(f.primary_domain)} · ${bookmarks.filter(b=>b.site_family_id===f.id).length} bookmark${bookmarks.filter(b=>b.site_family_id===f.id).length===1?"":"s"}</div><div class="familyAliases">${(f.aliases||[]).map(a=>`<span class="familyAlias">${esc(a)}</span>`).join("")||'<span class="familyAlias">No aliases</span>'}</div><div class="familyCardActions"><button type="button" class="secondary" data-family-edit="${esc(f.id)}">Edit</button><button type="button" class="danger" data-family-delete="${esc(f.id)}">Delete</button></div></article>`).join(""):'<div class="familyEmpty">No site families yet.<br>Create one for sites with multiple domains.</div>';
}
function resetFamilyEditor(){
 $("familyId").value="";$("familyName").value="";$("familyPrimary").value="";$("familyAliases").value="";$("familyEditorTitle").textContent="Add site family";$("familyError").classList.add("hidden");
}
function editFamily(id){const f=siteFamilies.find(x=>x.id===id);if(!f)return;$("familyId").value=f.id;$("familyName").value=f.name;$("familyPrimary").value=f.primary_domain;$("familyAliases").value=(f.aliases||[]).join("\n");$("familyEditorTitle").textContent="Edit site family";$("familyError").classList.add("hidden");$("familyName").focus()}
async function saveFamily(){
 const id=$("familyId").value;const name=cleanText($("familyName").value);const primary=validFamilyDomain($("familyPrimary").value);const aliases=[...new Set($("familyAliases").value.split(/\r?\n|,/).map(validFamilyDomain).filter(Boolean))].filter(x=>x!==primary);
 if(!name||name.length>80){$("familyError").textContent="Enter a family name up to 80 characters.";$("familyError").classList.remove("hidden");return}
 if(!primary){$("familyError").textContent="Enter a valid primary domain, such as example.com.";$("familyError").classList.remove("hidden");return}
 if(aliases.some(a=>a.length>255)||primary.length>255){$("familyError").textContent="Domain names must be 255 characters or fewer.";$("familyError").classList.remove("hidden");return}
 if(siteFamilies.some(f=>f.id!==id&&f.name.toLowerCase()===name.toLowerCase())){ $("familyError").textContent="A site family with that name already exists.";$("familyError").classList.remove("hidden");return }
 const proposed=[primary,...aliases];
 const overlaps=(a,b)=>a===b||a.endsWith("."+b)||b.endsWith("."+a);
 const conflict=siteFamilies.find(f=>f.id!==id&&[f.primary_domain,...(f.aliases||[])].some(x=>{const other=normalizeDomain(x);return proposed.some(p=>overlaps(p,other))}));
 if(conflict){$("familyError").textContent=`A domain overlaps the site family “${conflict.name}”. Remove the overlapping domain there first.`;$("familyError").classList.remove("hidden");return}
 const payload={name,primary_domain:primary,aliases};
 await runAction(id?"Updating site family…":"Creating site family…",async()=>{
  const r=id?await store.from("site_families").update(payload).eq("id",id).select().single():await store.from("site_families").insert(payload).select().single();
  if(r.error)throw r.error;
  const old=siteFamilies.findIndex(x=>x.id===r.data.id);if(old>=0)siteFamilies[old]=r.data;else siteFamilies.push(r.data);
  renderFamilies();fillFamilies();resetFamilyEditor();status("Site family saved");
 });
}
async function deleteFamily(id){const f=siteFamilies.find(x=>x.id===id);if(!f)return;if(!confirm(`Delete the site family “${f.name}”? Bookmarks will stay, but their family link will be removed.`))return;await runAction("Deleting site family…",async()=>{const r=await store.from("site_families").delete().eq("id",id);if(r.error)throw r.error;siteFamilies=siteFamilies.filter(x=>x.id!==id);bookmarks=bookmarks.map(b=>b.site_family_id===id?({...b,site_family_id:null}):b);render();resetFamilyEditor();renderFamilies();status("Site family deleted")})}
function openFamilyManager(){lastOpener=document.activeElement;$("familyModal").classList.remove("hidden");document.body.classList.add("modalOpen");$("app").inert=true;resetFamilyEditor();renderFamilies();setTimeout(()=>$('familyName').focus(),0)}
function closeFamilyManager(){$("familyModal").classList.add("hidden");document.body.classList.remove("modalOpen");$("app").inert=false;if(lastOpener&&document.contains(lastOpener))lastOpener.focus();lastOpener=null}
async function categoryId(name){
 name=name.trim();if(!name)return null;
 if(name.length>80) throw new Error("Category name must be 80 characters or fewer.");let old=categories.find(x=>x.name.toLowerCase()===name.toLowerCase());if(old)return old.id;
 let r=await store.from("categories").insert({name}).select().single();
 if(r.error){
  if(r.error.code==="DUPLICATE"){
   let again=await store.from("categories").select("*").eq("name",name).maybeSingle();
   if(again.data){categories.push(again.data);return again.data.id;}
  }
  throw r.error;
 }
 categories.push(r.data);return r.data.id;
}
function updateFamilySuggestion(url){
 const el=$("familySuggestion");if(!el)return;const f=familyForUrl(completeUrl(url)||url);if(f){el.textContent=`Matched site family: ${f.name}`;el.classList.remove("hidden")}else{el.textContent="";el.classList.add("hidden")}}
function autoCompleteUrlInput(){
 const input=$("url");if(!input||!input.value.trim())return;
 const completed=completeUrl(input.value);
 if(completed && completed!==input.value.trim()){input.value=completed;updateFamilySuggestion(completed);}
}
function open(type,item){
 lastOpener=document.activeElement;lastFocusedScrollY=window.scrollY;document.body.classList.add("modalOpen");
 $("app").inert=true;
 $("modal").classList.remove("hidden");$("modal").setAttribute("aria-hidden","false");$("type").value=type;$("id").value=item?.id||"";$("modalTitle").textContent=item?(type==="bookmark"?"Edit bookmark":"Edit note"):(type==="bookmark"?"New bookmark":"New note");
 const defaultCategoryName=categories.find(c=>c.id===defaultBookmarkCategoryId)?.name||"";
 $("title").value=item?.title||"";$("url").value=item?.url||"";$("description").value=item?.description||"";$("content").value=item?.content||"";$("category").value=item?cat(item.category_id):(type==="bookmark"?defaultCategoryName:"");
 $("tags").value=(item?.tags||[]).join(", ");fillFamilies();$("siteFamily").value=item?.site_family_id||familyForUrl(item?.url||"")?.id||"";updateFamilySuggestion(item?.url||"");if(type==="bookmark"){const existingCategory=item?cat(item.category_id):"";if(!existingCategory)applySmartCategory(item?.url||"",false);else $("categorySuggestion").classList.add("hidden");}$("favorite").checked=!!item?.is_favorite;$("pinned").checked=!!item?.is_pinned;
 $("urlField").classList.toggle("hidden",type!=="bookmark");$("descField").classList.toggle("hidden",type!=="bookmark");$("familyField").classList.toggle("hidden",type!=="bookmark");$("contentField").classList.toggle("hidden",type!=="note");$("favField").classList.toggle("hidden",type!=="bookmark");$("pinField").classList.toggle("hidden",type!=="note");$("saveError").classList.add("hidden");
 setTimeout(()=>{ $("title").focus(); const box=$("modal").querySelector(".modalBox"); if(box) box.scrollTop=0; const form=$("form"); if(form) form.scrollTop=0; },0);
}
function closeBookmarkModal(force=false){
 if(saving&&!force)return;
 $("modal").classList.add("hidden");$("modal").setAttribute("aria-hidden","true"); $("saveError").classList.add("hidden"); $("form").classList.remove("busy");
 document.body.classList.remove("modalOpen");
 $("app").inert=false;
 window.scrollTo(0,lastFocusedScrollY);
 if(lastOpener&&document.contains(lastOpener))lastOpener.focus();
 lastOpener=null;
}
window.editBookmark=id=>open("bookmark",bookmarks.find(x=>x.id===id));window.editNote=id=>open("note",notes.find(x=>x.id===id));
let actionBusy=false;
async function runAction(label,fn){if(actionBusy)return;actionBusy=true;status(label);try{await fn()}catch(err){alert(err?.message||"Something went wrong.")}finally{actionBusy=false}}
window.delBookmark=id=>{if(!confirm("Delete this bookmark?"))return;runAction("Deleting…",async()=>{let r=await store.from("bookmarks").delete().eq("id",id);if(r.error)throw r.error;await load()})};
window.delNote=id=>{if(!confirm("Delete this note?"))return;runAction("Deleting…",async()=>{let r=await store.from("notes").delete().eq("id",id);if(r.error)throw r.error;await load()})};
window.favorite=id=>{let b=bookmarks.find(x=>x.id===id);if(!b)return;runAction(b.is_favorite?"Removing favorite…":"Adding favorite…",async()=>{let r=await store.from("bookmarks").update({is_favorite:!b.is_favorite}).eq("id",id);if(r.error)throw r.error;await load()})};

$("url").addEventListener("input",()=>{if($("type").value!=="bookmark")return;const raw=$("url").value.trim();if(!raw)return;const completed=completeUrl(raw);applySmartCategory(completed,false);updateFamilySuggestion(completed);});
$("url").addEventListener("blur",()=>{if($("type").value!=="bookmark")return;const raw=$("url").value.trim();if(raw){const completed=completeUrl(raw);if(completed){$("url").value=completed;applySmartCategory(completed,false);updateFamilySuggestion(completed);}}});
$("category").addEventListener("input",()=>{if($("category").value.trim())$("categorySuggestion").classList.add("hidden")});

$("form").addEventListener("submit",async e=>{
 e.preventDefault();
 if(saving)return;
 saving=true;let saveCompleted=false;$("busy").textContent="Saving…";$("busy").classList.remove("hidden");$("form").classList.add("busy");$("saveError").classList.add("hidden");$("saveButton").disabled=true;
 try{
  let type=$("type").value,id=$("id").value,t=$("tags").value.split(",").map(x=>x.trim()).filter(Boolean).slice(0,30),r;
  let categoryName=$("category").value.trim();
  if(categoryName.length>80)throw new Error("Category name must be 80 characters or fewer.");
  if(type==="bookmark"){
   autoCompleteUrlInput();
   let rawUrl=$("url").value.trim();
   let completedUrl=completeUrl(rawUrl);
   if(completedUrl) rawUrl=completedUrl;
   if(!$("category").value.trim())applySmartCategory(rawUrl,false);
   if(rawUrl.length>MAX_URL_LENGTH)throw new Error(`Website URL must be ${MAX_URL_LENGTH} characters or fewer.`);
   let parsed;try{parsed=new URL(rawUrl)}catch{throw new Error("Please enter a valid website URL.")}
   if(!["http:","https:"].includes(parsed.protocol))throw new Error("Only http:// and https:// website links are allowed.");
   if(parsed.username||parsed.password)throw new Error("Website URLs containing usernames or passwords are not allowed.");
   let title=$("title").value.trim();if(!title)throw new Error("Please enter a title.");if(title.length>200)throw new Error("Title must be 200 characters or fewer.");
   title=normalizedBookmarkTitle(title,parsed.href);if(title.length>200)throw new Error("Title must be 200 characters or fewer.");
   let description=$("description").value.trim();if(description.length>1000)throw new Error("Description must be 1000 characters or fewer.");
   const canonical=canonicalUrl(parsed.href);
   const duplicate=bookmarks.find(b=>b.id!==id&&canonicalUrl(b.url)===canonical);
   if(duplicate)throw new Error(`This URL is already saved as “${duplicate.title||"Untitled bookmark"}”. Open or edit the existing bookmark instead.`);
   let cid=await categoryId(categoryName);
   let fid=$("siteFamily").value||null;
   if(!fid){const matched=familyForUrl(parsed.href);fid=matched?.id||null;}
   if(!fid)fid=await ensureLabelFamily(title,parsed.href,null);
   let p={category_id:cid,site_family_id:fid,title,url:parsed.href,description,tags:t.slice(0,30),favicon_url:icon(parsed.href),is_favorite:$("favorite").checked};
   r=id?await store.from("bookmarks").update(p).eq("id",id):await store.from("bookmarks").insert(p)
  }else{
   let title=$("title").value.trim();if(!title)throw new Error("Please enter a title.");if(title.length>200)throw new Error("Title must be 200 characters or fewer.");
   let content=$("content").value;if(content.length>20000)throw new Error("Note must be 20,000 characters or fewer.");
   let cid=await categoryId(categoryName);
   let p={category_id:cid,title,content,tags:t.slice(0,30),is_pinned:$("pinned").checked};
   r=id?await store.from("notes").update(p).eq("id",id):await store.from("notes").insert(p)
  }
  if(r.error)throw r.error;
  saveCompleted=true;
  closeBookmarkModal(true);
  await load();
 }catch(err){$("saveError").textContent=err.message||"Could not save.";$("saveError").classList.remove("hidden")}
 finally{if(saveCompleted)closeBookmarkModal(true);saving=false;$("busy").classList.add("hidden");$("form").classList.remove("busy");$("saveButton").disabled=false}
});

function downloadFile(filename,content,mime){
 const blob=new Blob([content],{type:mime});
 const url=URL.createObjectURL(blob);const a=document.createElement("a");
 a.href=url;a.download=filename;a.rel="noopener";document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportDataRows(){
 return bookmarks.map(b=>({
  title:cleanText(b.title),url:safeHref(b.url),description:cleanText(b.description),
  tags:Array.isArray(b.tags)?b.tags.slice(0,30).map(cleanText).filter(Boolean):[],
  category:cat(b.category_id),site_family:familyName(b.site_family_id),site_family_primary:siteFamilies.find(f=>f.id===b.site_family_id)?.primary_domain||"",site_family_aliases:siteFamilies.find(f=>f.id===b.site_family_id)?.aliases||[],is_favorite:toBool(b.is_favorite),is_archived:toBool(b.is_archived)
 })).filter(b=>b.url);
}
function csvCell(v){return `"${String(v??"").replace(/"/g,'""')}"`}
function exportCsv(rows,delimiter){
 const lines=[["Title","URL","Description","Tags","Category","Site Family","Site Family Primary","Site Family Aliases","Favorite","Archived"],...rows.map(b=>[b.title,b.url,b.description,b.tags.join(", "),b.category,b.site_family,b.site_family_primary,b.site_family_aliases.join(", "),b.is_favorite?"true":"false",b.is_archived?"true":"false"])];
 return lines.map(r=>r.map(v=>csvCell(v)).join(delimiter)).join("\r\n")+"\r\n";
}
function exportNetscapeHtml(rows){
 const groups=new Map();for(const b of rows){const key=b.category||"Uncategorized";(groups.get(key)||groups.set(key,[]).get(key)).push(b)}
 const escHtml=v=>esc(v);
 let out='<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">\n<title>Bookmarks</title>\n<h1>Bookmarks</h1>\n<DL><p>\n';
 for(const [name,list] of groups){out+=`  <DT><H3>${escHtml(name)}</H3></DT>\n  <DL><p>\n`;for(const b of list)out+=`    <DT><A HREF="${escHtml(b.url)}">${escHtml(b.title)}</A>\n`;out+='  </DL><p>\n'}
 return out+'</DL><p>\n';
}
function exportTxt(rows){return rows.map(b=>`${b.title}\t${b.url}`).join("\n")+"\n"}
function exportMarkdown(rows){
 const byCat=new Map();for(const b of rows){const key=b.category||"Uncategorized";(byCat.get(key)||byCat.set(key,[]).get(key)).push(b)}
 let out="# Bookmarks\n\n";for(const [name,list] of byCat){out+=`## ${name.replace(/[#\\]/g," ").trim()||"Uncategorized"}\n\n`;for(const b of list)out+=`- [${b.title.replace(/[\\[\\]]/g," ")}](${b.url})${b.description?` — ${b.description.replace(/\n/g," ")}`:""}\n`;out+='\n'}return out;
}
function exportBookmarks(){
 const rows=exportDataRows();if(!rows.length){status("No bookmarks to export");return}
 const fmt=$("bookmarkExportFormat")?.value||"json";const stamp=new Date().toISOString().slice(0,10);let filename,content,mime;
 if(fmt==="html"){filename=`marknest-bookmarks-${stamp}.html`;content=exportNetscapeHtml(rows);mime="text/html;charset=utf-8"}
 else if(fmt==="csv"){filename=`marknest-bookmarks-${stamp}.csv`;content=exportCsv(rows,",");mime="text/csv;charset=utf-8"}
 else if(fmt==="tsv"){filename=`marknest-bookmarks-${stamp}.tsv`;content=exportCsv(rows,"\t");mime="text/tab-separated-values;charset=utf-8"}
 else if(fmt==="txt"){filename=`marknest-bookmarks-${stamp}.txt`;content=exportTxt(rows);mime="text/plain;charset=utf-8"}
 else if(fmt==="md"){filename=`marknest-bookmarks-${stamp}.md`;content=exportMarkdown(rows);mime="text/markdown;charset=utf-8"}
 else {filename=`marknest-bookmarks-${stamp}.json`;content=JSON.stringify({format:"marknest-bookmarks",version:3,exported_at:new Date().toISOString(),site_families:siteFamilies.map(f=>({name:f.name,primary_domain:f.primary_domain,aliases:f.aliases||[]})),bookmarks:rows},null,2);mime="application/json;charset=utf-8"}
 downloadFile(filename,content,mime);status(`Exported ${rows.length} bookmark${rows.length===1?"":"s"} as ${fmt.toUpperCase()}`);
}
function parseCsv(text,delimiter=","){
 const rows=[];let row=[],cell="",quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++}else if(ch==='"'){quoted=false}else cell+=ch}else if(ch==='"'){quoted=true}else if(ch===delimiter){row.push(cell);cell=""}else if(ch==='\n'){row.push(cell.replace(/\r$/,""));rows.push(row);row=[];cell=""}else cell+=ch}
 if(quoted)throw new Error("The CSV file has an unclosed quote.");if(cell!==""||row.length){row.push(cell);rows.push(row)}return rows.filter(r=>r.some(x=>String(x).trim()!==""));
}
function rowsFromCsv(text,delimiter){
 const rows=parseCsv(text,delimiter);if(!rows.length)return[];const header=rows[0].map(x=>String(x).trim().toLowerCase());const hasHeader=header.some(x=>["title","name","url","href","description","tags","category","folder","favorite","archived","site family","site_family","site family primary","site_family_primary","site family aliases","site_family_aliases"].includes(x));const data=hasHeader?rows.slice(1):rows;
 const idx=(...names)=>{for(const n of names){const i=header.indexOf(n);if(i>=0)return i}return -1};
 const ti=hasHeader?idx("title","name") : 0, ui=hasHeader?idx("url","href") : 1, di=hasHeader?idx("description") : 2, gi=hasHeader?idx("tags") : 3, ci=hasHeader?idx("category","folder") : 4, si=hasHeader?idx("site family","site_family") : 5, spi=hasHeader?idx("site family primary","site_family_primary") : 6, sai=hasHeader?idx("site family aliases","site_family_aliases") : 7, fi=hasHeader?idx("favorite") : 8, ai=hasHeader?idx("archived") : 9;
 return data.map(r=>({title:r[ti]||"",url:r[ui]||"",description:r[di]||"",tags:gi>=0?(r[gi]||"").split(/[,;|]/):[],category:r[ci]||"",site_family:r[si]||"",site_family_primary:r[spi]||"",site_family_aliases:(r[sai]||"").split(/[,;|]/).map(x=>x.trim()).filter(Boolean),is_favorite:/^(1|true|yes|y)$/i.test(r[fi]||""),is_archived:/^(1|true|yes|y)$/i.test(r[ai]||"")}));
}
function parseNetscapeHtml(text){
 const doc=new DOMParser().parseFromString(text,"text/html");const out=[];
 for(const a of doc.querySelectorAll("a[href]")){
  const href=a.getAttribute("href")||"";let category="";let node=a.parentElement;
  while(node&&node!==doc.body){
   const prev=node.previousElementSibling;
   const h=prev?.matches?.("h3")?prev:prev?.querySelector?.("h3");
   if(h){category=h.textContent.trim();break}
   const ownH3=node.querySelector?.(":scope > h3");
   if(ownH3&&node.tagName==="DT"){category=ownH3.textContent.trim();}
   node=node.parentElement;
  }
  out.push({title:a.textContent.trim()||href,url:href,description:"",tags:[],category,is_favorite:false,is_archived:false});
 }
 return out;
}
function parseTextLinks(text){
 const out=[];for(const raw of text.split(/\r?\n/)){const line=raw.trim();if(!line||line.startsWith("#"))continue;let m=line.match(/^(.+?)\s*\t\s*(https?:\/\/\S+)$/i);if(!m)m=line.match(/^(.+?)\s*[|]\s*(https?:\/\/\S+)$/i);if(m)out.push({title:m[1].trim(),url:m[2].trim(),description:"",tags:[],category:"",is_favorite:false,is_archived:false});else {const urlMatch=line.match(/https?:\/\/\S+/i);if(urlMatch){const url=urlMatch[0].replace(/[),.;]+$/g,"");out.push({title:url, url, description:"",tags:[],category:"",is_favorite:false,is_archived:false})}}}return out;
}
function parseMarkdown(text){
 const out=[];let category="";for(const raw of text.split(/\r?\n/)){const line=raw.trim();const h=line.match(/^#{1,6}\s+(.+)$/);if(h){category=h[1].trim();continue}const m=line.match(/^[-*]\s*\[([^\]]+)\]\((https?:\/\/[^)]+)\)(?:\s*[—-]\s*(.*))?$/i);if(m)out.push({title:m[1].trim(),url:m[2].trim(),description:(m[3]||"").trim(),tags:[],category,is_favorite:false,is_archived:false})}return out;
}
function parseImport(text,name){
 const lower=(name||"").toLowerCase();
 if(/\.html?$/.test(lower)||/^\s*<!doctype\s+netscape-bookmark/i.test(text)||/<a\b/i.test(text))return parseNetscapeHtml(text);
 if(/\.csv$/.test(lower))return rowsFromCsv(text,",");
 if(/\.tsv$/.test(lower))return rowsFromCsv(text,"\t");
 if(/\.md$|\.markdown$/.test(lower)||/\[[^\]]+\]\(https?:\/\//i.test(text))return parseMarkdown(text);
 if(/\.json$/.test(lower)||/^\s*[\[{]/.test(text)){let raw;try{raw=JSON.parse(text)}catch{raw=null}if(raw){const list=Array.isArray(raw)?raw:(Array.isArray(raw.bookmarks)?raw.bookmarks:(Array.isArray(raw.items)?raw.items:(Array.isArray(raw.links)?raw.links:null)));if(list){const mapped=list.map(x=>({title:x.title||x.name||x.text||x.url||"",url:x.url||x.href||"",description:x.description||x.note||"",tags:Array.isArray(x.tags)?x.tags:(typeof x.tags==="string"?x.tags.split(/[,;|]/):[]),category:x.category||x.folder||"",site_family:x.site_family||x.siteFamily||x.family||"",site_family_primary:x.site_family_primary||x.family_primary||"",site_family_aliases:Array.isArray(x.site_family_aliases)?x.site_family_aliases:(Array.isArray(x.family_aliases)?x.family_aliases:[]),is_favorite:toBool(x.is_favorite??x.favorite),is_archived:toBool(x.is_archived)}));mapped._siteFamilies=Array.isArray(raw.site_families)?raw.site_families:[];return mapped}}}
 return parseTextLinks(text);
}
function normalizedImportItems(rawItems){
 if(!Array.isArray(rawItems))throw new Error("No bookmarks were found in that file.");if(rawItems.length>5000)throw new Error("The file contains too many bookmarks (maximum 5,000).");
 const result=rawItems.map((b,i)=>{if(!b||typeof b!=="object")throw new Error(`Invalid bookmark at item ${i+1}.`);const title=cleanText(b.title)||safeHref(cleanText(b.url))||"Untitled bookmark";if(title.length>200)throw new Error(`Title is too long at item ${i+1}.`);const url=completeUrl(cleanText(b.url));if(!url||!safeHref(url))throw new Error(`Invalid website URL at item ${i+1}.`);if(url.length>MAX_URL_LENGTH)throw new Error(`Website URL is too long at item ${i+1}.`);const description=cleanText(b.description);if(description.length>1000)throw new Error(`Description is too long at item ${i+1}.`);const tagList=Array.isArray(b.tags)?b.tags.map(cleanText).filter(Boolean).slice(0,30).map(x=>x.slice(0,50)):[];const category=cleanText(b.category||b.folder).slice(0,80);const site_family=cleanText(b.site_family||b.siteFamily||b.family).slice(0,80);const site_family_primary=cleanText(b.site_family_primary||b.family_primary).slice(0,255);const site_family_aliases=Array.isArray(b.site_family_aliases)?b.site_family_aliases.map(cleanText).filter(Boolean).slice(0,50):[];return{title,url,description,tags:tagList,category,site_family,site_family_primary,site_family_aliases,is_favorite:toBool(b.is_favorite),is_archived:toBool(b.is_archived)}}).filter(x=>x.url);result._siteFamilies=Array.isArray(rawItems._siteFamilies)?rawItems._siteFamilies:[];return result;
}
let pendingImportItems=null;let pendingImportFileName="";let importDialogOpener=null;
function openImportCategoryDialog(items,fileName){
 pendingImportItems=items;pendingImportFileName=fileName||"";importDialogOpener=document.activeElement;
 const counts=new Map();let uncategorized=0;for(const item of items){if(item.category)counts.set(item.category,(counts.get(item.category)||0)+1);else uncategorized++;}
 const existing=new Set(bookmarks.map(x=>canonicalUrl(x.url)).filter(Boolean));const seen=new Set();let duplicates=0;
 for(const item of items){const k=canonicalUrl(item.url);if(!k)continue;if(existing.has(k)||seen.has(k))duplicates++;seen.add(k);}
 const categoryCount=counts.size;const familyCount=new Set(items.map(x=>x.site_family).filter(Boolean)).size;
 const familyMeta=Array.isArray(items._siteFamilies)?items._siteFamilies:[];const totalFamilyCount=new Set([...items.map(x=>x.site_family).filter(Boolean),...familyMeta.map(x=>cleanText(x?.name)).filter(Boolean)]).size;
 $("importSummary").textContent=`${items.length} bookmark${items.length===1?"":"s"} found · ${categoryCount} categor${categoryCount===1?"y":"ies"} in file · ${uncategorized} uncategorized · ${totalFamilyCount} site famil${totalFamilyCount===1?"y":"ies"}`;
 $("importDuplicateSummary").textContent=duplicates?`${duplicates} duplicate${duplicates===1?"":"s"} detected in the existing MarkNest or within this file.`:"No duplicates detected.";
 $("importSkipDuplicates").checked=true;
 const select=$("importFallbackCategory");select.innerHTML='<option value="">Choose an existing category…</option>';for(const c of categories.slice().sort((a,b)=>a.name.localeCompare(b.name))){const o=document.createElement("option");o.value=c.id;o.textContent=c.name;select.appendChild(o)}
 document.querySelectorAll('input[name="importCategoryMode"]').forEach(x=>x.checked=x.value==="file");$("importFallbackWrap").classList.add("hidden");$("importCategoryModal").classList.remove("hidden");document.body.classList.add("modalOpen");$("app").inert=true;setTimeout(()=>document.querySelector('input[name="importCategoryMode"]:checked')?.focus(),0);
}
function closeImportCategoryDialog(){
 pendingImportItems=null;pendingImportFileName="";$("importCategoryModal").classList.add("hidden");document.body.classList.remove("modalOpen");$("app").inert=false;if(importDialogOpener&&document.contains(importDialogOpener))importDialogOpener.focus();importDialogOpener=null;
}
async function performImport(items,mode,fallbackCategoryId,skipDuplicates){
 await runAction(`Importing ${items.length} bookmarks…`,async()=>{
  const categoryCache=new Map(categories.map(c=>[c.name.toLowerCase(),c.id]));
  const familyCache=new Map(siteFamilies.map(f=>[f.name.toLowerCase(),f.id]));
  const familyMeta=Array.isArray(items._siteFamilies)?items._siteFamilies:[];
  for(const f of familyMeta){
   const name=cleanText(f?.name).slice(0,80), primary=validFamilyDomain(f?.primary_domain);
   if(!name||!primary||familyCache.has(name.toLowerCase())) continue;
   const aliases=[...new Set((Array.isArray(f?.aliases)?f.aliases:[]).map(validFamilyDomain).filter(Boolean))].filter(x=>x!==primary).slice(0,50);
   const r=await store.from("site_families").insert({name,primary_domain:primary,aliases}).select().single();
   if(r.error&&r.error.code==="DUPLICATE"){const again=await store.from("site_families").select("*").eq("name",name).maybeSingle();if(again.error)throw again.error;if(again.data){siteFamilies.push(again.data);familyCache.set(name.toLowerCase(),again.data.id)}}
   else if(r.error)throw r.error;
   else{siteFamilies.push(r.data);familyCache.set(name.toLowerCase(),r.data.id)}
  }
  for(const item of items){
   if(!item.category)continue;
   const key=item.category.toLowerCase();if(categoryCache.has(key))continue;
   const r=await store.from("categories").insert({name:item.category}).select("id,name").single();
   if(r.error&&r.error.code==="DUPLICATE"){const again=await store.from("categories").select("id,name").eq("name",item.category).maybeSingle();if(again.error)throw again.error;if(again.data){categories.push(again.data);categoryCache.set(key,again.data.id)}}
   else if(r.error)throw r.error;
   else{categories.push(r.data);categoryCache.set(key,r.data.id)}
  }
  for(const item of items){
   if(!item.site_family)continue;
   const key=item.site_family.toLowerCase();
   if(familyCache.has(key))continue;
   const importedDomain=validFamilyDomain(item.site_family_primary)||validFamilyDomain(domain(item.url));
   const aliases=[...new Set((item.site_family_aliases||[]).map(validFamilyDomain).filter(Boolean))].filter(x=>x!==importedDomain).slice(0,50);
   if(!importedDomain) continue;
   const r=await store.from("site_families").insert({name:item.site_family,primary_domain:importedDomain,aliases}).select().single();
   if(r.error&&r.error.code==="DUPLICATE")continue;
   if(r.error)throw r.error;
   siteFamilies.push(r.data);familyCache.set(key,r.data.id);
  }
  const existingUrls=new Set(bookmarks.map(x=>canonicalUrl(x.url)).filter(Boolean));
  const seenUrls=new Set();
  const freshItems=[];
  let skipped=0;
  for(const item of items){
   const key=canonicalUrl(item.url);
   if(skipDuplicates&&(existingUrls.has(key)||seenUrls.has(key))){skipped++;continue}
   seenUrls.add(key);freshItems.push(item);
  }
  const payload=freshItems.map(item=>({category_id:item.category?(categoryCache.get(item.category.toLowerCase())||null):(mode==="fallback"?fallbackCategoryId:null),site_family_id:item.site_family?(familyCache.get(item.site_family.toLowerCase())||familyForUrl(item.url)?.id||null):(familyForUrl(item.url)?.id||null),title:item.title,url:item.url,description:item.description,tags:item.tags,is_favorite:item.is_favorite,is_archived:item.is_archived,favicon_url:icon(item.url)}));
  for(let i=0;i<payload.length;i+=250){const r=await store.from("bookmarks").insert(payload.slice(i,i+250));if(r.error)throw r.error}
  closeImportCategoryDialog();await load();status(`Imported ${payload.length} bookmark${payload.length===1?"":"s"}${skipped?` · skipped ${skipped} duplicate${skipped===1?"":"s"}`:""}`);
 });
}
async function importBookmarks(file){
 if(!file)return;if(file.size>5*1024*1024)throw new Error("Import file is too large. Maximum size is 5 MB.");
 const text=await file.text();const rawItems=parseImport(text,file.name);const items=normalizedImportItems(rawItems);if(!items.length){status("No bookmarks found in that file");return}
 openImportCategoryDialog(items,file.name);
}

function view(v){
 document.querySelectorAll("[data-view]").forEach(x=>{let on=x.dataset.view===v;x.classList.toggle("active",on);if(x.classList.contains("mobileNav")===false)x.setAttribute("aria-current",on?"page":"false")});
 ["dashboard","bookmarks","notes"].forEach(x=>$(`${x}View`).classList.toggle("hidden",x!==v));
}
document.querySelectorAll("[data-view]").forEach(x=>x.onclick=()=>{view(x.dataset.view);closeUtilityPanel({restoreFocus:true})});
$("addBookmark").onclick=$("dashAdd").onclick=()=>open("bookmark");
$("addNote").onclick=()=>open("note");
$("close").onclick=$("cancel").onclick=()=>closeBookmarkModal();
$("modal").addEventListener("click",e=>{if(e.target===$("modal"))closeBookmarkModal()});
document.addEventListener("keydown",e=>{
 if(e.key==="Escape"&&!$("utilityPanel").classList.contains("hidden")){e.preventDefault();closeUtilityPanel();$("utilityToggle").focus();return}
 if($("modal").classList.contains("hidden"))return;
 if(e.key==="Escape"){e.preventDefault();closeBookmarkModal();return}
 if(e.key==="Tab"){
  const focusables=[...$("modal").querySelectorAll('button:not([disabled]),input:not([disabled]):not([type=hidden]),textarea:not([disabled]),select:not([disabled]),a[href]')].filter(x=>x.getClientRects().length);
  if(!focusables.length)return;
  const first=focusables[0],last=focusables[focusables.length-1];
  if(!$('modal').contains(document.activeElement)){e.preventDefault();first.focus();return}
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
 }
});
document.addEventListener("click",e=>{const b=e.target.closest("[data-action]");if(!b)return;const id=b.dataset.id;switch(b.dataset.action){case "edit-bookmark":editBookmark(id);break;case "delete-bookmark":delBookmark(id);break;case "favorite":favorite(id);break;case "edit-note":editNote(id);break;case "delete-note":delNote(id);break;}});
let searchTimer=0;
function enterSelectionMode(initialId=null){
 bookmarkSelectionMode=true;
 if(initialId) selectedBookmarkIds.add(initialId);
 selectionAnchorId=initialId||selectionAnchorId;
 renderBookmarks();
 setTimeout(()=>$('toggleBookmarkSelection')?.focus(),0);
}
function exitSelectionMode(){
 selectedBookmarkIds.clear();bookmarkSelectionMode=false;selectionAnchorId=null;renderBookmarks();
}
function toggleBookmarkSelection(id){
 if(selectedBookmarkIds.has(id)) selectedBookmarkIds.delete(id);
 else selectedBookmarkIds.add(id);
 selectionAnchorId=id;
}
function selectBookmarkRange(toId,additive=false){
 const rows=visibleBookmarks();
 const fromId=selectionAnchorId&&rows.some(x=>x.id===selectionAnchorId)?selectionAnchorId:toId;
 const a=rows.findIndex(x=>x.id===fromId),b=rows.findIndex(x=>x.id===toId);
 if(a<0||b<0){toggleBookmarkSelection(toId);bookmarkSelectionMode=true;return}
 if(!additive)selectedBookmarkIds.clear();
 const [lo,hi]=a<b?[a,b]:[b,a];
 for(let i=lo;i<=hi;i++)selectedBookmarkIds.add(rows[i].id);
 bookmarkSelectionMode=true;
}
$('toggleBookmarkSelection').onclick=()=>{
 if(bookmarkSelectionMode) exitSelectionMode(); else enterSelectionMode();
};
$('bookmarkGrid').addEventListener('click',e=>{
 const selector=e.target.closest?.('[data-select-bookmark]');
 if(selector){
  e.preventDefault();e.stopPropagation();
  const id=selector.dataset.selectBookmark;
  if(e.shiftKey)selectBookmarkRange(id,e.ctrlKey||e.metaKey); else toggleBookmarkSelection(id);
  renderBookmarks();return;
 }
 const card=e.target.closest?.('.item[data-bookmark-id]');
 if(!card||e.target.closest?.('a,button,input,select,textarea'))return;
 const id=card.dataset.bookmarkId;
 if(bookmarkSelectionMode){
  if(e.shiftKey)selectBookmarkRange(id,e.ctrlKey||e.metaKey);
  else toggleBookmarkSelection(id);
  renderBookmarks();
  return;
 }
 if(e.ctrlKey||e.metaKey){enterSelectionMode(id);return;}
});
$('bookmarkGrid').addEventListener('keydown',e=>{
 const card=e.target.closest?.('.item[data-bookmark-id]');
 if(!card||!bookmarkSelectionMode||e.target.closest?.('a,button,input,select,textarea'))return;
 if(e.key==='Enter'||e.key===' '){e.preventDefault();toggleBookmarkSelection(card.dataset.bookmarkId);renderBookmarks();}
});

document.addEventListener("change",e=>{
 const c=e.target.closest?.("[data-category-select]");
 if(c){if(e.target.checked)selectedCategoryIds.add(c.dataset.categorySelect);else selectedCategoryIds.delete(c.dataset.categorySelect);renderCategoryManager()}
});
$("selectAllBookmarks").onclick=()=>{
 const visible=visibleBookmarks().map(x=>x.id);
 const all=visible.length>0&&visible.every(id=>selectedBookmarkIds.has(id));
 if(all)visible.forEach(id=>selectedBookmarkIds.delete(id));else{bookmarkSelectionMode=true;visible.forEach(id=>selectedBookmarkIds.add(id));selectionAnchorId=visible[0]||null;}
 renderBookmarks();
};
$("invertBookmarkSelection").onclick=()=>{
 const visible=visibleBookmarks().map(x=>x.id);const next=new Set();
 visible.forEach(id=>{if(!selectedBookmarkIds.has(id))next.add(id)});
 selectedBookmarkIds=next;bookmarkSelectionMode=next.size>0;selectionAnchorId=visible.find(id=>next.has(id))||null;renderBookmarks();
};
$("clearBookmarkSelection").onclick=()=>{selectedBookmarkIds.clear();renderBookmarks()};
$("bulkBookmarkAction").onchange=updateBulkActionUi;
$("bulkApplyBookmarks").onclick=applyBulkBookmarkAction;

function scheduleSearch(fn){clearTimeout(searchTimer);searchTimer=setTimeout(fn,90)}
$("bookmarkSearch").oninput=()=>scheduleSearch(renderBookmarks);$("noteSearch").oninput=()=>scheduleSearch(renderNotes);$("bookmarkCategory").onchange=renderBookmarks;$("noteCategory").onchange=renderNotes;
$("defaultBookmarkCategory").onchange=e=>{defaultBookmarkCategoryId=e.target.value;storeSet("marknest-default-bookmark-category",defaultBookmarkCategoryId);status(defaultBookmarkCategoryId?`Default: ${cat(defaultBookmarkCategoryId)}`:"Default category cleared")};
$("globalSearch").oninput=e=>{
 const q=e.target.value.toLowerCase();$("bookmarkSearch").value=q;$("noteSearch").value=q;
 scheduleSearch(()=>{
  renderBookmarks();renderNotes();
  if(q && bookmarks.some(x=>[x.title,x.url,x.description,familyName(x.site_family_id),(x.tags||[]).join(" ")].join(" ").toLowerCase().includes(q))) view("bookmarks");
  else if(q && notes.some(x=>[x.title,x.content,(x.tags||[]).join(" ")].join(" ").toLowerCase().includes(q))) view("notes");
 });
};
document.addEventListener("keydown",e=>{
 if(storeGet("marknest-shortcuts","on")==="off")return;
 const tag=(document.activeElement?.tagName||"").toLowerCase();
 const editable=["input","textarea","select"].includes(tag)||document.activeElement?.isContentEditable;
 const bookmarksActive=!$("bookmarksView").classList.contains("hidden")&&!editable;
 if(bookmarksActive&&bookmarkSelectionMode&&selectedBookmarkIds.size&&e.key==="Delete"){e.preventDefault();bulkDeleteBookmarks();return}
 if(bookmarksActive&&((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="a")){e.preventDefault();const visible=visibleBookmarks().map(x=>x.id);bookmarkSelectionMode=true;visible.forEach(id=>selectedBookmarkIds.add(id));selectionAnchorId=visible[0]||null;renderBookmarks();return}
 if(bookmarksActive&&e.key==="Escape"&&selectedBookmarkIds.size){e.preventDefault();selectedBookmarkIds.clear();bookmarkSelectionMode=false;selectionAnchorId=null;renderBookmarks();return}
 if(e.ctrlKey||e.metaKey||e.altKey) return;
 if(editable) return;
 if(e.key==="/"){e.preventDefault();$("globalSearch").focus();return}
 if(e.key.toLowerCase()==="n"){e.preventDefault();open(e.shiftKey?"note":"bookmark");return}
});
$("themeGrid").addEventListener("click",e=>{const b=e.target.closest(".themeChoice");if(!b)return;applyTheme(b.dataset.theme);const current=THEMES.find(t=>t.id===b.dataset.theme);const n=$("currentThemeName");if(n)n.textContent=current?.name||"Midnight";});
document.addEventListener("error",e=>{if(e.target.matches?.(".faviconImg")){e.target.hidden=true}},true);
$("utilityToggle").onclick=toggleUtilityPanel;$("closeUtility").onclick=closeUtilityPanel;
$("utilityNewBookmark").onclick=()=>{closeUtilityPanel();open("bookmark")};
$("utilityNewNote").onclick=()=>{closeUtilityPanel();open("note")};
$("utilityExport").onclick=()=>{closeUtilityPanel();exportBookmarks()};
$("utilityImport").onclick=()=>{closeUtilityPanel();$("bookmarkImportFile").click()};
$("utilityFamilies").onclick=()=>{closeUtilityPanel();openFamilyManager()};
$("utilityCategories").onclick=()=>{closeUtilityPanel();$("manageCategories").click()};
$("shortcutToggle").checked=storeGet("marknest-shortcuts","on")==="on";$("shortcutToggle").onchange=e=>storeSet("marknest-shortcuts",e.target.checked?"on":"off");
const logoToggle=$("logoToggle");if(logoToggle){logoToggle.checked=storeGet("marknest-load-logos","off")==="on";logoToggle.onchange=e=>{storeSet("marknest-load-logos",e.target.checked?"on":"off");render();status(e.target.checked?"Site logos enabled. Online requests may occur.":"Site logos disabled. Offline-only mode restored.");};}
document.addEventListener("pointerdown",e=>{const p=$("utilityPanel"),b=$("utilityToggle");if(!p||p.classList.contains("hidden"))return;if(e.target===p||p.contains(e.target)||e.target===b||b?.contains(e.target))return;closeUtilityPanel();});
$("utilityBackdrop")?.addEventListener("click",()=>closeUtilityPanel());
$("utilityPanel")?.addEventListener("keydown",e=>{if(e.key!=="Tab")return;const f=utilityFocusable();if(!f.length)return;const first=f[0],last=f[f.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}});
renderThemes();
if("serviceWorker" in navigator){
 window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(()=>{}),{once:true});
}
async function boot(){
  $("auth")?.classList.add("hidden");
 $("app")?.classList.remove("hidden");
 $("account") && ($("account").textContent="Local MarkNest");
 $("utilityAccount") && ($("utilityAccount").textContent="Local MarkNest");
 $("loadErrorPanel")?.classList.add("hidden");
 try{await load()}catch(e){
  console.error(e);
  const p=$("loadErrorPanel"),t=$("loadErrorText");
  if(t)t.textContent=`${e?.message||"The MarkNest data could not be loaded."} Your data is stored locally in this browser.`;
  p?.classList.remove("hidden");
 }
}
loadSiteCatalog();
boot();
window.addEventListener("pageshow",()=>{try{if(document.activeElement?.blur)document.activeElement.blur()}catch{}});

$("manageCategories").onclick=openCategoryManager;
$("closeCategoryModal").onclick=closeCategoryManager;
$("createCategory").onclick=async()=>{try{await createCategoryFromManager()}catch(e){$("categoryCreateError").textContent=e?.message||"Could not create category.";$("categoryCreateError").classList.remove("hidden")}};
$("bulkDeleteCategories").onclick=bulkDeleteCategories;
$("selectAllCategories").onchange=e=>{if(e.target.checked)categories.forEach(c=>selectedCategoryIds.add(c.id));else selectedCategoryIds.clear();renderCategoryManager()};
$("categoryModal").addEventListener("click",e=>{if(e.target===$("categoryModal"))closeCategoryManager()});
document.addEventListener("keydown",e=>{
 if($("categoryModal")&&!$("categoryModal").classList.contains("hidden")){
  if(e.key==="Escape"){e.preventDefault();closeCategoryManager();return}
  if(e.key==="Tab"){
   const f=[...$("categoryModal").querySelectorAll('button:not([disabled]),input:not([disabled]):not([type=hidden]),textarea:not([disabled]),select:not([disabled]),a[href]')].filter(x=>x.getClientRects().length);
   if(f.length){const first=f[0],last=f[f.length-1];if(!$("categoryModal").contains(document.activeElement)){e.preventDefault();first.focus()}else if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}}
 }
});

$("retryLoad").onclick=async()=>{$("loadErrorPanel")?.classList.add("hidden");try{await load()}catch(e){const t=$("loadErrorText");if(t)t.textContent=e?.message||"The MarkNest data could not be loaded.";$("loadErrorPanel")?.classList.remove("hidden")}};
