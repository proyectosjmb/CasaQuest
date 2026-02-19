// cloud.js (ESM module)
// Source: Firebase Web SDK via CDN (official alt-setup docs)
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  doc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

let _app = null;
let _auth = null;
let _db = null;
let _houseId = null;

function isEnabled(cloudCfg){
  return !!(cloudCfg && cloudCfg.enabled && cloudCfg.houseId && cloudCfg.firebaseConfig);
}

async function init(cloudCfg, onLogs){
  if(!isEnabled(cloudCfg)) throw new Error("Cloud disabled or missing config");

  _houseId = cloudCfg.houseId;

  _app = initializeApp(cloudCfg.firebaseConfig);
  _auth = getAuth(_app);
  _db = getFirestore(_app);

  // Auth anónimo
  await signInAnonymously(_auth);

  // Escuchar logs en tiempo real
  const q = query(
    collection(_db, "houses", _houseId, "logs"),
    orderBy("createdAt", "asc")
  );

  onSnapshot(q, (snap)=>{
    const logs = snap.docs.map(d=>({ id: d.id, ...d.data() }));
    if(typeof onLogs === "function") onLogs(logs);
  });

  return true;
}

async function addLog(log){
  if(!_db || !_houseId) throw new Error("Cloud not initialized");
  const payload = {
    ...log,
    createdAt: Date.now(),
    ts: serverTimestamp()
  };
  const ref = await addDoc(collection(_db, "houses", _houseId, "logs"), payload);
  return ref.id;
}

async function deleteLog(logId){
  if(!_db || !_houseId) throw new Error("Cloud not initialized");
  await deleteDoc(doc(_db, "houses", _houseId, "logs", logId));
  return true;
}

// Exponer a app.js (que NO es módulo)
window.CQCloud = { isEnabled, init, addLog, deleteLog };
