#!/usr/bin/env python3
"""Score arbitrary queries with the production retriever. candidates.json -> scores.json.

Split out of the validator so the eval set can be assembled from queries that have
ALREADY been measured, instead of written first and audited afterwards.
"""
import sys, json, base64, importlib, time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, ".")
T = importlib.import_module("tl_common")
tok = T.ptoken()
C = "rantai-agents-mockup"


def ex(cmd, to=1800):
    for a in range(3):
        try:
            e = T._p(f"/api/endpoints/3/docker/containers/{C}/exec", "POST",
                     b={"AttachStdout": True, "AttachStderr": True, "Tty": True,
                        "Cmd": ["sh", "-c", cmd]}, tok=tok)
            return T._p(f"/api/endpoints/3/docker/exec/{e['Id']}/start", "POST",
                        b={"Detach": False, "Tty": True}, raw=True, to=to,
                        tok=tok).decode("utf-8", "ignore")
        except Exception as err:
            print(f"    (retry {a+1}: {str(err)[:40]})", flush=True)
            time.sleep(8)
    return ""


def put(remote, data: bytes, chunk=40000):
    """base64 rather than a heredoc: a heredoc once wrote a NUL byte into a source file."""
    b = base64.b64encode(data).decode()
    ex(f"rm -f {remote}.b64")
    for i in range(0, len(b), chunk):
        ex(f"printf %s '{b[i:i+chunk]}' >> {remote}.b64")
    ex(f"base64 -d {remote}.b64 > {remote} && rm -f {remote}.b64")


JS = r"""
const fs=require('fs');
const chunks=JSON.parse(fs.readFileSync('/app/data/chunks.json','utf8'));
const qs=JSON.parse(fs.readFileSync('/tmp/q.json','utf8'));
const nrm=v=>{let s=0;for(const x of v)s+=x*x;const n=Math.sqrt(s)||1;return v.map(x=>x/n);};
const idx=chunks.filter(c=>Array.isArray(c.embedding)&&c.embedding.length).map(c=>({c,v:nrm(c.embedding)}));
const dot=(a,b)=>{let s=0;const L=Math.min(a.length,b.length);for(let i=0;i<L;i++)s+=a[i]*b[i];return s;};
(async()=>{
 const out=[]; let n=0;
 for(const it of qs){
  let qv=null;
  for(let a=0;a<3&&!qv;a++){
   try{ const r=await fetch('http://ollama:11434/api/embed',{method:'POST',
     headers:{'content-type':'application/json'},
     body:JSON.stringify({model:'bge-m3',input:[it.q]})});
    qv=((await r.json()).embeddings||[])[0]||null;
   }catch(e){ await new Promise(r=>setTimeout(r,1500)); } }
  if(!qv){out.push(Object.assign({},it,{score:-1,src:'EMBED_FAIL'}));continue;}
  const q=nrm(qv); let best=-1,src='';
  for(const x of idx){ if(x.c.jenjang!==it.jen) continue;
    const s=dot(q,x.v); if(s>best){best=s;src=x.c.source;} }
  out.push(Object.assign({},it,{score:Number(best.toFixed(3)),src:src.slice(0,80)}));
  if(++n%150===0) console.error('  '+n+'/'+qs.length);
 }
 fs.writeFileSync('/tmp/scores.json',JSON.stringify(out));
 console.log('OK '+out.length);
})();
"""

cands = json.load(open("candidates.json", encoding="utf-8"))
print(f"menyekor {len(cands)} kandidat...", flush=True)
put("/tmp/q.json", json.dumps(cands, ensure_ascii=False).encode())
put("/tmp/score.js", JS.encode())
t0 = time.time()
print(" ", ex("cd /app && node /tmp/score.js 2>&1 | tail -2").strip(),
      f"({time.time()-t0:.0f}s)", flush=True)
raw = ex("cat /tmp/scores.json", to=600)
raw = raw[raw.index("["):raw.rindex("]") + 1]
json.dump(json.loads(raw), open("scores.json", "w", encoding="utf-8"), ensure_ascii=False)
print("-> scores.json", flush=True)
