// Client-side offline download. The server stays light: it only proxies HLS
// segments (as it already does for streaming). The browser does the work —
// it fetches every segment through the addon proxy and muxes them into a
// single mp4 with ffmpeg.wasm (single-threaded core, no COOP/COEP needed).
//
// Route GET /download/:type/:id serves this self-contained page. The page
// calls the addon's own /stream endpoint to get the proxied master playlist,
// then fetches + muxes locally. ffmpeg core files are served from the addon
// (see /dl-assets in index.ts) so no external CDN is required.

import path from 'node:path';

/// Absolute dirs of the ffmpeg.wasm UMD bundles, served statically by the addon.
/// The package `exports` maps block require.resolve of internal paths, so we
/// locate them under node_modules relative to the working dir (cwd=/app in the
/// image, the addon dir in dev — both have node_modules alongside).
export function ffmpegAssetDirs(): { ffmpeg: string; core: string } {
  const base = path.join(process.cwd(), 'node_modules', '@ffmpeg');
  return {
    ffmpeg: path.join(base, 'ffmpeg', 'dist', 'umd'),
    core: path.join(base, 'core', 'dist', 'umd')
  };
}

export function downloadPageHTML(type: string, id: string): string {
  // type/id are echoed into a JS string literal; JSON.stringify escapes them.
  const safeType = JSON.stringify(type);
  const safeId = JSON.stringify(id);
  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Download — Streamo</title>
<style>
  :root { color-scheme: dark; }
  body { font-family: -apple-system, system-ui, sans-serif; background:#0f1115; color:#e8eaed; margin:0; padding:24px; }
  .card { max-width:680px; margin:40px auto; background:#171a21; border:1px solid #262b36; border-radius:14px; padding:28px; }
  h1 { font-size:18px; margin:0 0 4px; }
  .sub { color:#9aa0aa; font-size:13px; margin-bottom:20px; word-break:break-all; }
  button { background:#3a7afe; color:#fff; border:0; border-radius:9px; padding:11px 18px; font-size:14px; font-weight:600; cursor:pointer; }
  button:disabled { background:#2a2f3a; color:#6b7280; cursor:default; }
  .row { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
  select { background:#0f1115; color:#e8eaed; border:1px solid #2a2f3a; border-radius:8px; padding:9px; font-size:14px; }
  .bar { height:8px; background:#262b36; border-radius:6px; overflow:hidden; margin:18px 0 8px; }
  .fill { height:100%; width:0%; background:#3a7afe; transition:width .2s; }
  .log { font-size:12px; color:#9aa0aa; white-space:pre-wrap; margin-top:8px; min-height:20px; }
  .err { color:#ff6b6b; }
  .warn { color:#f5c451; font-size:12px; margin-top:14px; }
  a.dl { display:inline-block; margin-top:8px; }
</style>
</head>
<body>
<div class="card">
  <h1>Download offline</h1>
  <div class="sub" id="meta">Risoluzione sorgente…</div>
  <div class="row">
    <select id="quality" disabled></select>
    <button id="go" disabled>Scarica MP4</button>
  </div>
  <div class="bar"><div class="fill" id="fill"></div></div>
  <div class="log" id="log"></div>
  <div class="warn">Il muxing avviene nel browser (ffmpeg.wasm). Film interi in alta qualità possono saturare la RAM — se fallisce, scegli una qualità più bassa.</div>
</div>

<script src="/dl-assets/ffmpeg/ffmpeg.js"></script>
<script>
const TYPE = ${safeType};
const ID = ${safeId};
const $ = (id) => document.getElementById(id);
const log = (m, cls) => { const e=$('log'); e.className='log'+(cls?' '+cls:''); e.textContent=m; };
const setProgress = (p) => { $('fill').style.width = Math.max(0,Math.min(100,p)).toFixed(1)+'%'; };

let masterURL = null;
let variants = [];   // {height, bandwidth, uri}
let audioURI = null; // default audio media playlist

// Resolve URLs relative to a base (the proxied playlist lives on this addon).
const abs = (uri, base) => new URL(uri, base).toString();

function parseAttrs(line) {
  const out = {}; const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g; let m;
  while ((m = re.exec(line))) out[m[1]] = m[2].replace(/^"|"$/g,'');
  return out;
}

async function init() {
  try {
    const r = await fetch('/stream/'+TYPE+'/'+encodeURIComponent(ID)+'.json');
    const data = await r.json();
    const stream = (data.streams || [])[0];
    if (!stream) { log('Stream non disponibile (SC non ha questo titolo).', 'err'); return; }
    masterURL = stream.url;

    const master = await (await fetch(masterURL)).text();
    const lines = master.split('\\n');
    for (let i=0;i<lines.length;i++) {
      const l = lines[i].trim();
      if (l.startsWith('#EXT-X-MEDIA') && /TYPE=AUDIO/.test(l)) {
        const a = parseAttrs(l);
        if (!audioURI || /DEFAULT=YES/.test(l)) audioURI = a.URI ? abs(a.URI, masterURL) : audioURI;
      } else if (l.startsWith('#EXT-X-STREAM-INF')) {
        const a = parseAttrs(l);
        const uri = (lines[++i]||'').trim();
        if (uri) {
          const res = (a.RESOLUTION||'').split('x');
          variants.push({ height: parseInt(res[1]||'0',10), bandwidth: parseInt(a.BANDWIDTH||'0',10), uri: abs(uri, masterURL) });
        }
      }
    }
    if (!variants.length) { log('Nessuna variante video trovata.', 'err'); return; }
    variants.sort((a,b)=> (b.height-a.height) || (b.bandwidth-a.bandwidth));

    const sel = $('quality'); sel.innerHTML='';
    variants.forEach((v,idx)=>{ const o=document.createElement('option'); o.value=idx; o.textContent=(v.height?v.height+'p':Math.round(v.bandwidth/1000)+'kbps'); sel.appendChild(o); });
    sel.disabled=false; $('go').disabled=false;
    $('meta').textContent = (data.streams[0].title||'Streamo')+' — '+variants.length+' qualità, audio '+(audioURI?'separato':'incluso');
    log('Pronto.');
  } catch (e) {
    log('Errore init: '+e.message, 'err');
  }
}

let ffmpeg = null;
async function loadFFmpeg() {
  if (ffmpeg) return ffmpeg;
  const { FFmpeg } = FFmpegWASM;
  ffmpeg = new FFmpeg();
  await ffmpeg.load({ coreURL: '/dl-assets/core/ffmpeg-core.js', wasmURL: '/dl-assets/core/ffmpeg-core.wasm' });
  return ffmpeg;
}

// Parse a media playlist into {key:{uri,iv}|null, segments:[uri]}.
async function parseMedia(url) {
  const text = await (await fetch(url)).text();
  const lines = text.split('\\n');
  let key = null; const segments = [];
  for (const raw of lines) {
    const l = raw.trim();
    if (l.startsWith('#EXT-X-KEY')) {
      const a = parseAttrs(l);
      if (a.METHOD && a.METHOD !== 'NONE') key = { uri: abs(a.URI, url), iv: a.IV || null };
    } else if (l && !l.startsWith('#')) {
      segments.push(abs(l, url));
    }
  }
  return { key, segments };
}

async function fetchBuf(url) { const r = await fetch(url); if(!r.ok) throw new Error('HTTP '+r.status+' '+url); return new Uint8Array(await r.arrayBuffer()); }

async function run() {
  $('go').disabled=true; $('quality').disabled=true;
  try {
    const v = variants[parseInt($('quality').value,10)];
    log('Carico ffmpeg.wasm…'); setProgress(0);
    const ff = await loadFFmpeg();

    log('Leggo le playlist…');
    const video = await parseMedia(v.uri);
    const audio = audioURI ? await parseMedia(audioURI) : null;

    const allKeys = [video.key, audio && audio.key].filter(Boolean);
    for (let k=0;k<allKeys.length;k++) {
      const buf = await fetchBuf(allKeys[k].uri);
      await ff.writeFile('key'+k+'.bin', buf);
      allKeys[k].local = 'key'+k+'.bin';
    }

    const total = video.segments.length + (audio?audio.segments.length:0);
    let done = 0;

    async function ingest(media, prefix) {
      const names = [];
      for (let i=0;i<media.segments.length;i++) {
        const name = prefix+i+'.ts';
        await ff.writeFile(name, await fetchBuf(media.segments[i]));
        names.push(name); done++; setProgress(done/total*70);
        if (i%10===0) log('Scarico segmenti '+done+'/'+total+'…');
      }
      // Build a local media playlist referencing the downloaded files.
      let m = '#EXTM3U\\n#EXT-X-VERSION:3\\n#EXT-X-TARGETDURATION:10\\n#EXT-X-MEDIA-SEQUENCE:0\\n';
      if (media.key) m += '#EXT-X-KEY:METHOD=AES-128,URI="'+media.key.local+'"'+(media.key.iv?',IV='+media.key.iv:'')+'\\n';
      for (const n of names) m += '#EXTINF:10,\\n'+n+'\\n';
      m += '#EXT-X-ENDLIST\\n';
      const pl = prefix+'.m3u8';
      await ff.writeFile(pl, new TextEncoder().encode(m));
      return pl;
    }

    const vPl = await ingest(video, 'v');
    const aPl = audio ? await ingest(audio, 'a') : null;

    log('Muxing in mp4…'); setProgress(72);
    const args = ['-allowed_extensions','ALL','-i',vPl];
    if (aPl) args.push('-i',aPl);
    args.push('-c','copy');
    if (aPl) args.push('-map','0:v:0','-map','1:a:0');
    args.push('-movflags','+faststart','out.mp4');
    await ff.exec(args);
    setProgress(96);

    const out = await ff.readFile('out.mp4');
    const blob = new Blob([out.buffer], { type:'video/mp4' });
    const url = URL.createObjectURL(blob);
    const name = (ID.replace(/[^\\w.-]+/g,'_'))+'_'+(v.height||'')+'p.mp4';
    const a = document.createElement('a'); a.href=url; a.download=name; a.className='dl'; a.textContent='Salva '+name;
    a.click();
    $('log').innerHTML=''; $('log').appendChild(a);
    setProgress(100);
  } catch (e) {
    log('Errore: '+(e&&e.message||e), 'err');
    $('go').disabled=false; $('quality').disabled=false;
  }
}

$('go').addEventListener('click', run);
init();
</script>
</body>
</html>`;
}
