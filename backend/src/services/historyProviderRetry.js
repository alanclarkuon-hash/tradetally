const {createHash}=require('crypto');
const attempts=new Map();
const RETRY_MS=6*60*60*1000,MAX_KEYS=2048;
// Provider attempts are process-local, bounded, and separate from price evidence.
// A new range, user or changed verified evidence bypasses the cooldown. Restart
// clears it; explicit recovery remains possible without modifying saved prices.
function begin(identity,evidence) {
 const key=createHash('sha256').update(JSON.stringify([identity,evidence])).digest('hex');
 if(Date.now()<(attempts.get(key)||0))return false;
 attempts.delete(key);attempts.set(key,Date.now()+RETRY_MS);
 while(attempts.size>MAX_KEYS)attempts.delete(attempts.keys().next().value);
 return true;
}
module.exports={begin};
