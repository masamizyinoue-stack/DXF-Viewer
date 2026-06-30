// layer.js — レイヤ管理モジュール
// DXF Viewer V0_64
// 依存グローバル: doc, aci() (viewer.js), buildSnapCache, scheduleDraw, scheduleSave
// ※ このファイルは viewer.js より先にロードすること（hiddenLayers を先に宣言するため）

// =========================================================
// hiddenLayers — 非表示レイヤーの管理
// =========================================================
var hiddenLayers=new Set();

// =========================================================
// レイヤ一覧生成・表示切替
// =========================================================
function buildLayerModal(){
  const ll=document.getElementById('layerList');ll.innerHTML='';
  if(!doc) return;
  for(const lname of Object.keys(doc.usedLayers).sort()){
    const info=doc.layerMap[lname]||{color:7};
    const c=aci(info.color||7);
    const row=document.createElement('div');row.className='layer-row';
    const cb=document.createElement('input');cb.type='checkbox';cb.checked=!hiddenLayers.has(lname);
    cb.addEventListener('change',()=>{if(cb.checked)hiddenLayers.delete(lname);else hiddenLayers.add(lname);buildSnapCache();scheduleDraw();scheduleSave();if(typeof verify==='function')verify('hiddenLayers変更',{size:hiddenLayers.size});});
    const box=document.createElement('div');box.className='layer-color-box';box.style.background=`rgb(${c.r},${c.g},${c.b})`;
    const label=document.createElement('span');label.textContent=lname;
    row.append(cb,box,label);ll.appendChild(row);
  }
}

// =========================================================
// レイヤモーダル 開閉イベントリスナー
// =========================================================
document.getElementById('layerBtn').addEventListener('click',()=>document.getElementById('layerModal').classList.add('open'));
document.getElementById('layerClose').addEventListener('click',()=>document.getElementById('layerModal').classList.remove('open'));
document.getElementById('layerModal').addEventListener('click',e=>{if(e.target===document.getElementById('layerModal'))document.getElementById('layerModal').classList.remove('open');});
