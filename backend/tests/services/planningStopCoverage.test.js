const {recorded}=require('../../src/services/planningStopCoverage');
const lot=(q,stop,currency='USD')=>({quantity:q,entry_price:100,stop_loss:stop,original_currency:currency,side:'long'});
const pos=trades=>({instrumentType:'stock',trades,side:'long',currency:'USD',totalQuantity:3});
test('each lot needs its own stop; one lot cannot cover an entire broker holding',()=>{expect(recorded(pos([lot(1,90),lot(2,null)])).risk).toBeNull();expect(recorded(pos([lot(1,90),lot(2,95)])).risk).toBe(20);expect(recorded(pos([lot(1,90)])).risk).toBeNull()});
test('currency conflicts, unknown direction and missing quantities do not imply zero risk',()=>{expect(recorded(pos([lot(3,90,'GBP')])).risk).toBeNull();expect(recorded(pos([{...lot(3,90),side:'short'}])).risk).toBeNull();expect(recorded(pos([])).risk).toBeNull()});
test('protected positions can have confirmed zero risk without claiming a broker working stop',()=>{expect(recorded(pos([lot(3,110)]))).toMatchObject({risk:0,coveredQuantity:3,source:'Recorded manual trade stops'})});
