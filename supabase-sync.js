// supabase-sync.js — 図面ごとの注記(strokes/dims)をSupabaseへ自動保存・自動復元する（V1_05）
// 依存: <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script> をindex.htmlで先に読み込むこと
// 依存グローバル: strokes, dims, currentFileIdx, openFiles, currentFileName, currentFileSize (viewer.js/HTML)
//
// 設計方針（安全側）:
// ・ネットワークが無い/失敗しても既存のローカル保存(localStorage/IndexedDB)には一切影響を与えない
//   （すべてtry/catchで囲み、失敗時はconsole.warnのみでUIを止めない）
// ・自動保存: 既存のdoSave()実行のたびに、現在開いているファイルのstrokes/dimsを
//   Supabaseへ非同期でupsert（file_key + device_idで1レコード）
// ・自動復元: ファイルを新しく開いた際、ローカルに注記(strokes/dims)が無い場合のみ
//   Supabaseから復元を試みる（ローカルに既にある注記をクラウドの古いデータで
//   上書きしてしまわないようにするため）
// ・V1_02: 「人・端末ごとに注記を分離したい」という要望により、file_keyだけでなく
//   端末固有のdevice_idも複合キーに含めるよう変更。他の人・他のiPadで同じ図面を
//   開いても、device_idが異なるため別レコードとして扱われ、互いの注記を
//   上書きしない。
//   ※device_idはこのブラウザのlocalStorageに保存される「自己申告のID」であり、
//   Supabase側のRLSはこのIDを検証していない（真の認証ではない）。社内の
//   通常利用では他人のdevice_idを偽装される想定は低いが、厳密なアクセス制御
//   （なりすまし防止）が必要な場合はSupabase Authの導入が別途必要になる。
// ・V1_04: 「端末が変わっても氏名・合言葉で復元したい」という要望により、
//   ランダムなdevice_idの代わりに「氏名+合言葉」から生成した固定キー(user_key)を
//   使えるように拡張。設定画面で氏名・合言葉を登録すると、以後はそのキーで
//   保存・復元される。別の端末で同じ氏名・合言葉を登録すれば同じキーになり、
//   クラウド上の同じデータへ接続できる。未登録の場合は従来通りランダムな
//   device_id（端末ごとに自動分離）のまま動作する。
//   ※合言葉はSHA-256でハッシュ化してから使うが、サーバー側（RLS）では
//   合言葉の正しさを検証していない（anon全開放のため）。これは真のログイン
//   認証ではなく「知っていれば入れる合言葉」程度の簡易的な識別である旨、
//   ユーザーに開示済み。
// ・V1_05: 「複数人が使うとデータ量が増えて困る。データを必ず残す必要がある人だけ
//   Supabaseを使えるようにしたい」という要望により、氏名・合言葉が未登録の場合は
//   Supabaseへ一切保存・復元を行わない（ローカルのlocalStorage/IndexedDB保存の
//   みで動作する）仕様に変更。従来のランダムなdevice_idによる自動同期は廃止し、
//   「登録した人だけがクラウド同期を使う」オプトイン方式に一本化した。
//   設定画面に「登録解除」ボタンも追加し、不要になった時点でクラウド同期を
//   オフに戻せるようにした（解除してもクラウド上の既存データは削除されず、
//   ローカルのlocalStorage/IndexedDBへの影響も一切ない）。

const _SB_URL='https://opuylmqrsovtemygouwe.supabase.co';
const _SB_ANON_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wdXlsbXFyc292dGVteWdvdXdlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2NjM4NDMsImV4cCI6MjEwMDIzOTg0M30.cECPW5u5FCPOlmyCWGaJi_PbaizKB2vQbsmQaOJZ5bM';
const _SB_DEVICE_ID_KEY='dxfv_device_id'; // V1_02
const _SB_USER_KEY_STORAGE='dxfv_user_key'; // V1_04: 氏名+合言葉から生成したキー
const _SB_USER_NAME_STORAGE='dxfv_user_name'; // V1_04: 表示用（平文の氏名のみ保存。合言葉は保存しない）

let _sbClient=null;
try{
  if(window.supabase&&typeof window.supabase.createClient==='function'){
    _sbClient=window.supabase.createClient(_SB_URL,_SB_ANON_KEY);
  }
}catch(e){console.warn('[SupabaseSync] クライアント初期化失敗',e);}

// アプリ内部のfileKeyは "name\x00size" だが、PostgreSQLのtext列はNUL文字(\x00)を
// 格納できず保存が必ず失敗するため、Supabase送信専用に安全な区切り文字へ変換する
function _sbSafeKey(fk){ return (fk==null)?fk:String(fk).split('\x00').join('::'); }

// V1_05: 氏名・合言葉による固定キー(user_key)が登録されている場合のみ値を返す。
// 未登録ならnullを返し、Supabaseへは一切保存・復元を行わない（オプトイン方式）。
// ※旧device_id方式(ランダムID自動生成)はV1_05で廃止。
function _sbGetDeviceId(){
  try{
    return localStorage.getItem(_SB_USER_KEY_STORAGE)||null;
  }catch(e){
    return null;
  }
}
let _SB_DEVICE_ID=_sbGetDeviceId(); // V1_04: user_key登録後に差し替えるためconst→let

// V1_04: 文字列をSHA-256でハッシュ化しhex文字列で返す（Web Crypto非対応時は簡易フォールバック）
async function _sbHashString(str){
  try{
    if(typeof crypto!=='undefined'&&crypto.subtle&&crypto.subtle.digest){
      var enc=new TextEncoder().encode(str);
      var buf=await crypto.subtle.digest('SHA-256',enc);
      return Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,'0');}).join('');
    }
  }catch(e){console.warn('[SupabaseSync] ハッシュ化失敗、簡易方式に切替',e);}
  var h=0;
  for(var i=0;i<str.length;i++){ h=(h*31+str.charCodeAt(i))|0; }
  return 'fb'+(h>>>0).toString(16);
}

// V1_04: 氏名・合言葉からuser_keyを生成しlocalStorageへ登録。以後はこのキーで保存・復元する
async function _sbSetUserCredentials(name,pass){
  try{
    var n=String(name||'').trim();
    var p=String(pass||'');
    if(!n||!p) return {ok:false,error:'お名前と合言葉の両方を入力してください'};
    var hash=await _sbHashString(n.toLowerCase()+'::'+p);
    var key='u_'+hash;
    localStorage.setItem(_SB_USER_KEY_STORAGE,key);
    localStorage.setItem(_SB_USER_NAME_STORAGE,n);
    _SB_DEVICE_ID=key;
    return {ok:true,name:n};
  }catch(e){
    console.warn('[SupabaseSync] 認証設定例外',e);
    return {ok:false,error:'設定に失敗しました（localStorageが使用できない可能性があります）'};
  }
}

// V1_05: 登録を解除する（クラウド同期をオフに戻す）。クラウド上の既存データは
// 削除しない。ローカルのlocalStorage/IndexedDBのデータにも一切影響しない。
function _sbClearUserCredentials(){
  try{
    localStorage.removeItem(_SB_USER_KEY_STORAGE);
    localStorage.removeItem(_SB_USER_NAME_STORAGE);
    _SB_DEVICE_ID=null;
    return {ok:true};
  }catch(e){
    console.warn('[SupabaseSync] 解除例外',e);
    return {ok:false,error:'解除に失敗しました'};
  }
}

// V1_04: 現在の同期識別状態を返す（設定画面表示用）
// V1_05: 未登録時は'device'ではなく'none'（クラウド同期オフ）を返すよう変更
function _sbGetAuthStatus(){
  try{
    var name=localStorage.getItem(_SB_USER_NAME_STORAGE);
    var key=localStorage.getItem(_SB_USER_KEY_STORAGE);
    if(name&&key) return {mode:'user',name:name};
  }catch(e){}
  return {mode:'none',name:null};
}

// 現在のファイルの注記をSupabaseへ保存（非同期・失敗しても無視）
// V1_05: 氏名・合言葉が未登録（_SB_DEVICE_ID===null）の場合はSupabaseへ一切保存しない
function _sbPushCurrentAnnotations(){
  if(!_sbClient||!_SB_DEVICE_ID) return;
  try{
    if(typeof currentFileIdx==='undefined'||currentFileIdx<0||!openFiles[currentFileIdx]) return;
    var _f=openFiles[currentFileIdx];
    var _fk=_sbSafeKey(_f.fileKey||(typeof _fileKey==='function'?_fileKey(currentFileName,currentFileSize):null));
    if(!_fk) return;
    _sbClient.from('dxf_annotations').upsert({
      file_key:_fk,
      device_id:_SB_DEVICE_ID, // V1_02: 端末ごとに別レコードにする
      file_name:currentFileName||_f.currentFileName||_f.name||'',
      strokes:strokes||[],
      dims:dims||[]
    },{onConflict:'file_key,device_id'}).then(function(res){
      if(res&&res.error) console.warn('[SupabaseSync] 保存失敗',res.error.message);
    });
  }catch(e){console.warn('[SupabaseSync] 保存例外',e);}
}

// 指定fileKeyの注記をSupabaseから取得（この端末が過去に保存した分のみ）。無い/失敗時はnullを返す
// V1_05: 氏名・合言葉が未登録（_SB_DEVICE_ID===null）の場合はSupabaseへ問い合わせない
async function _sbPullAnnotations(fileKey){
  if(!_sbClient||!fileKey||!_SB_DEVICE_ID) return null;
  try{
    var res=await _sbClient.from('dxf_annotations')
      .select('strokes,dims')
      .eq('file_key',_sbSafeKey(fileKey))
      .eq('device_id',_SB_DEVICE_ID) // V1_02: 自分の端末が保存したものだけを復元
      .maybeSingle();
    if(res.error){console.warn('[SupabaseSync] 復元失敗',res.error.message);return null;}
    return res.data||null;
  }catch(e){console.warn('[SupabaseSync] 復元例外',e);return null;}
}

// V1_03: 設定画面の「クラウド保存状況」表示用。dxf_annotations_stats() RPCを呼び、
// 全体の保存件数・概算サイズ・Free枠(500MB)に対する使用率を返す。失敗時はnull
async function _sbGetUsageStats(){
  if(!_sbClient) return null;
  try{
    var res=await _sbClient.rpc('dxf_annotations_stats');
    if(res.error){console.warn('[SupabaseSync] 使用状況取得失敗',res.error.message);return null;}
    var row=(res.data&&res.data[0])?res.data[0]:null;
    if(!row) return null;
    var FREE_LIMIT_BYTES=500*1024*1024; // Supabase Free Planのデータベースサイズ上限(500MB)
    return {
      rowCount:row.row_count||0,
      tableBytes:row.table_bytes||0,
      totalBytes:row.total_bytes||0,
      freeLimitBytes:FREE_LIMIT_BYTES,
      usedRatio:FREE_LIMIT_BYTES>0?(row.table_bytes||0)/FREE_LIMIT_BYTES:0
    };
  }catch(e){console.warn('[SupabaseSync] 使用状況取得例外',e);return null;}
}

window._sbPushCurrentAnnotations=_sbPushCurrentAnnotations;
window._sbPullAnnotations=_sbPullAnnotations;
window._sbGetUsageStats=_sbGetUsageStats;
window._sbSetUserCredentials=_sbSetUserCredentials; // V1_04
window._sbGetAuthStatus=_sbGetAuthStatus; // V1_04
window._sbClearUserCredentials=_sbClearUserCredentials; // V1_05
