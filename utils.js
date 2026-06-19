// utils.js — ユーティリティ関数
// DXF Viewer V0_63
// 依存なし（純粋関数）

// ArrayBuffer → Base64変換
function arrayBufferToB64(buf){
  const bytes=new Uint8Array(buf);let bin='';const CH=8192;
  for(let i=0;i<bytes.length;i+=CH)bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+CH));
  return btoa(bin);
}

// 非ASCII文字をDXF Unicodeエスケープ \U+XXXX に変換
function dxfEncText(s){
  return (s||'').replace(/[^\x00-\x7F]/g,
    c=>'\\U+'+c.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0'));
}

// RGB → ACI（AutoCAD Color Index）変換
function rgbToAci(r,g,b){
  const aci=[
    {i:1,r:255,g:0,b:0},{i:2,r:255,g:255,b:0},{i:3,r:0,g:255,b:0},
    {i:4,r:0,g:255,b:255},{i:5,r:0,g:0,b:255},{i:6,r:255,g:0,b:255},
    {i:7,r:255,g:255,b:255},{i:30,r:255,g:165,b:0},{i:40,r:255,g:200,b:100}
  ];
  let best=7,bestD=Infinity;
  for(const c of aci){
    const d=Math.hypot(r-c.r,g-c.g,b-c.b);
    if(d<bestD){bestD=d;best=c.i;}
  }
  return best;
}
