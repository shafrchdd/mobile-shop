const DB_NAME = "kerala_mobile_erp";
const DB_VERSION = 3;
const STORES = [
  "shop_settings","categories","brands","products","customers","suppliers","staff",
  "financial_accounts","expense_categories","service_catalog","stock_lots","stock_movements",
  "product_serials","sales","sale_items","sale_returns","sale_return_items","purchases",
  "purchase_items","purchase_returns","payments","payment_allocations","purchase_payments",
  "recharge_platforms","recharge_operators","recharge_wallets","recharge_commission_rules",
  "recharge_topups","recharge_wallet_transactions","recharge_transactions","recharge_agents",
  "agent_collections","collection_agents","supplier_agent_links","supplier_ledger_entries",
  "supplier_payments","customer_ledger_entries","customer_payments","repair_jobs",
  "repair_job_services","repair_job_parts","repair_status_history","repair_payments",
  "repair_warranties","expenses","recurring_expenses","wages","wage_advances","attendance",
  "accounts","journal_entries","journal_lines","reminders","audit_logs","app_settings",
  "backup_history","reorder_requests"
];

let connection;
export function uid() {
  return globalThis.crypto?.randomUUID ? crypto.randomUUID() :
    "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}
export function db() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const name of STORES) {
        let store;
        if (!database.objectStoreNames.contains(name)) store = database.createObjectStore(name, { keyPath: "id" });
        else store = request.transaction.objectStore(name);
        if (!store.indexNames.contains("createdAt")) store.createIndex("createdAt", "createdAt", { unique: false });
        if (!store.indexNames.contains("updatedAt")) store.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { connection = null; reject(request.error); };
    request.onblocked = () => reject(new Error("Close other Mobile Shop ERP tabs, then reload."));
  });
  return connection;
}
export async function add(storeName, value) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, "readwrite");
    tx.objectStore(storeName).add(value);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Transaction cancelled."));
  });
}
export async function put(storeName, value) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Transaction cancelled."));
  });
}
export async function get(storeName, id) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, "readonly").objectStore(storeName).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}
export async function all(storeName) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}
export async function count(storeName) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction(storeName).objectStore(storeName).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveProduct(data) {
  const database = await db();
  const id = data.id || uid();
  const qty = Math.max(0, Number(data.qty || 0));
  return new Promise((resolve, reject) => {
    const tx = database.transaction(["products","stock_movements"], "readwrite");
    const products = tx.objectStore("products");
    const movements = tx.objectStore("stock_movements");
    const req = products.get(id);
    let saved;
    let failure = null;
    req.onsuccess = () => {
      const old = req.result;
      const now = new Date().toISOString();
      saved = {
        ...(old || {}), ...data, id,
        name: String(data.name || "").trim(),
        category: String(data.category || "General").trim(),
        qty, updatedAt: now, createdAt: old?.createdAt || now
      };
      if (!saved.name) { failure = new Error("Product name is required."); tx.abort(); return; }
      products.put(saved);
      const oldQty = Number(old?.qty || 0);
      const delta = old ? qty - oldQty : qty;
      if (delta) movements.add({
        id: uid(), productId: id, productName: saved.name,
        movementType: old ? "ADJUSTMENT" : "OPENING_STOCK",
        quantityDelta: delta, balanceAfter: qty,
        note: old ? "Manual inventory adjustment" : "Opening stock",
        createdAt: now
      });
    };
    tx.oncomplete = () => resolve(saved);
    tx.onerror = () => reject(failure || tx.error);
    tx.onabort = () => reject(failure || tx.error || new Error("Could not save product."));
  });
}

export async function saveSupplier(data) {
  const database = await db();
  const id = data.id || uid();
  const now = new Date().toISOString();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(["suppliers","supplier_agent_links"], "readwrite");
    const suppliers = tx.objectStore("suppliers");
    const links = tx.objectStore("supplier_agent_links");
    const req = suppliers.get(id);
    let saved;
    req.onsuccess = () => {
      const old = req.result;
      saved = { ...(old || {}), ...data, id, name: String(data.name || "").trim(), updatedAt: now, createdAt: old?.createdAt || now };
      if (!saved.name) { tx.abort(); return; }
      suppliers.put(saved);
      const cursorReq = links.indexNames.contains("supplierId")
        ? links.index("supplierId").openCursor(IDBKeyRange.only(id)) : null;
      const removeOld = () => {
        (data.agentIds || []).forEach(agentId => links.put({ id: id + "::" + agentId, supplierId: id, agentId, createdAt: now }));
      };
      if (cursorReq) {
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) { cursor.delete(); cursor.continue(); }
          else removeOld();
        };
      } else {
        // Fallback when a legacy browser database lacks the index.
        const allReq = links.getAll();
        allReq.onsuccess = () => {
          allReq.result.filter(row => row.supplierId === id).forEach(row => links.delete(row.id));
          removeOld();
        };
      }
    };
    tx.oncomplete = () => resolve(saved);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Could not save supplier."));
  });
}
export async function saveCollectionAgent(data) {
  const id = data.id || uid();
  const now = new Date().toISOString();
  const agent = { ...data, id, name: String(data.name || "").trim(), phone: String(data.phone || "").trim(), updatedAt: now, createdAt: data.createdAt || now };
  if (!agent.name) throw new Error("Agent name is required.");
  await put("collection_agents", agent);
  return agent;
}

export async function saveRechargeProvider(data) {
  const database = await db();
  const id = data.id || uid();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(["recharge_platforms","recharge_wallets"], "readwrite");
    const providers = tx.objectStore("recharge_platforms");
    const wallets = tx.objectStore("recharge_wallets");
    const req = wallets.get(id);
    const now = new Date().toISOString();
    const provider = {
      ...data, id, name: String(data.name || "").trim(),
      commissionType: data.commissionType || "percentage",
      commissionValue: Math.max(0, Number(data.commissionValue || 0)),
      amountRules: Array.isArray(data.amountRules) ? data.amountRules : [],
      active: data.active !== false, updatedAt: now, createdAt: data.createdAt || now
    };
    req.onsuccess = () => {
      providers.put(provider);
      if (!req.result) wallets.put({
        id, providerId: id, providerName: provider.name,
        balancePaise: Math.max(0, Math.round(Number(data.openingBalancePaise || 0))),
        updatedAt: now
      });
      else {
        const wallet = req.result;
        wallet.providerName = provider.name;
        wallet.updatedAt = now;
        wallets.put(wallet);
      }
    };
    tx.oncomplete = () => resolve(provider);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Could not save recharge provider."));
  });
}

function resolveCommission(provider, amountPaise) {
  const rules = (provider.amountRules || []).filter(rule => rule.active !== false).slice().sort((a,b) => {
    const aMin=Number(a.minAmountPaise||0), bMin=Number(b.minAmountPaise||0);
    const aMax=a.maxAmountPaise==null||a.maxAmountPaise===""?aMin:Number(a.maxAmountPaise);
    const bMax=b.maxAmountPaise==null||b.maxAmountPaise===""?bMin:Number(b.maxAmountPaise);
    return (aMax-aMin)-(bMax-bMin);
  });
  const matched = rules.find(rule => {
    const min = Number(rule.minAmountPaise || 0);
    const max = rule.maxAmountPaise == null || rule.maxAmountPaise === "" ? min : Number(rule.maxAmountPaise);
    return amountPaise >= min && amountPaise <= max;
  });
  const type = matched?.commissionType || provider.commissionType || "percentage";
  const value = Number(matched?.commissionValue ?? provider.commissionValue ?? 0);
  const commissionPaise = type === "fixed" ? Math.round(value * 100) : Math.round(amountPaise * value / 100);
  if (!Number.isFinite(commissionPaise) || commissionPaise < 0 || commissionPaise > amountPaise) {
    throw new Error("This provider's commission rule is invalid for the entered amount. Check Settings → Recharge providers.");
  }
  return { commissionPaise, walletDebitPaise: amountPaise - commissionPaise, matchedRule: matched || null };
}

export async function topupRechargeWallet({ providerId, amountPaise, supplierId = null, note = "" }) {
  const database = await db();
  const amount = Math.round(Number(amountPaise));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Enter a valid wallet credit amount.");
  return new Promise((resolve, reject) => {
    const stores = ["recharge_platforms","recharge_wallets","recharge_wallet_transactions","recharge_topups","supplier_ledger_entries","suppliers"];
    const tx = database.transaction(stores, "readwrite");
    const providerReq = tx.objectStore("recharge_platforms").get(providerId);
    const walletReq = tx.objectStore("recharge_wallets").get(providerId);
    let provider, wallet, supplier, pReady=false, wReady=false, sReady=false, result, failure=null;
    const apply = () => {
      if (!pReady || !wReady || !sReady || failure) return;
      if (!provider || !wallet) { failure = new Error("Provider wallet not found."); tx.abort(); return; }
      if (!supplierId) { failure = new Error("Select the recharge distributor supplier. Wallet credits must appear in supplier outstanding."); tx.abort(); return; }
      if (!supplier || supplier.supplierType !== "recharge_distributor") {
        failure = new Error("Choose a supplier marked as Recharge distributor.");
        tx.abort();
        return;
      }
      const now = new Date().toISOString();
      const before = Number(wallet.balancePaise || 0);
      wallet.balancePaise = before + amount;
      wallet.updatedAt = now;
      tx.objectStore("recharge_wallets").put(wallet);
      result = {
        id: uid(), providerId, providerName: provider.name, supplierId,
        entryType:"CREDIT", amountPaise:amount, balanceBeforePaise:before,
        balanceAfterPaise:before+amount, note:String(note || "").trim(), createdAt:now
      };
      tx.objectStore("recharge_wallet_transactions").add(result);
      tx.objectStore("recharge_topups").add({ ...result, id: uid() });
      // The whole credit becomes payable to the distributor. It is not reduced by recharge usage.
      tx.objectStore("supplier_ledger_entries").add({
        id:uid(), supplierId, entryType:"RECHARGE_WALLET_CREDIT",
        amountPaise:amount, balanceDeltaPaise:amount, referenceId:result.id,
        note:"Recharge wallet funded: " + provider.name, createdAt:now
      });
    };
    providerReq.onsuccess=()=>{provider=providerReq.result;pReady=true;apply();};
    walletReq.onsuccess=()=>{wallet=walletReq.result;wReady=true;apply();};
    const actualSupplierId = supplierId;
    const supplierReq = tx.objectStore("suppliers").get(actualSupplierId);
    supplierReq.onsuccess=()=>{supplier=supplierReq.result;sReady=true;apply();};
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>reject(failure || tx.error);
    tx.onabort=()=>reject(failure || tx.error || new Error("Wallet credit failed."));
  });
}
export async function completeRecharge({ providerId, serviceType, recipient="", customerId=null, amountPaise }) {
  const database = await db();
  const amount = Math.round(Number(amountPaise));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Enter a valid recharge amount.");
  if (serviceType === "mobile" && !/^[0-9]{10}$/.test(String(recipient).replace(/\D/g,""))) throw new Error("Enter a valid 10-digit mobile number.");
  return new Promise((resolve,reject)=>{
    const tx=database.transaction(["recharge_platforms","recharge_wallets","recharge_transactions","recharge_wallet_transactions"],"readwrite");
    const providerReq=tx.objectStore("recharge_platforms").get(providerId);
    const walletReq=tx.objectStore("recharge_wallets").get(providerId);
    let provider,wallet,pReady=false,wReady=false,result,failure=null;
    const apply=()=>{
      if(!pReady||!wReady||failure)return;
      if(!provider||provider.active===false){failure=new Error("Choose an active recharge provider.");tx.abort();return;}
      if(!wallet){failure=new Error("Provider wallet not found. Add an opening balance in Settings.");tx.abort();return;}
      let calculation;
      try{calculation=resolveCommission(provider,amount);}catch(error){failure=error;tx.abort();return;}
      const before=Number(wallet.balancePaise||0);
      if(before<calculation.walletDebitPaise){failure=new Error("Insufficient provider balance. Available: ₹"+(before/100).toFixed(2));tx.abort();return;}
      const now=new Date().toISOString(),after=before-calculation.walletDebitPaise,id=uid();
      wallet.balancePaise=after;wallet.updatedAt=now;tx.objectStore("recharge_wallets").put(wallet);
      result={
        id,providerId,providerName:provider.name,supplierId:provider.supplierId||null,
        serviceType,recipient:String(recipient||"").trim(),customerId,
        amountPaise:amount,customerChargePaise:amount,
        commissionPaise:calculation.commissionPaise,walletDebitPaise:calculation.walletDebitPaise,
        walletBalanceBeforePaise:before,walletBalanceAfterPaise:after,
        matchedRuleId:calculation.matchedRule?.id||null,status:"recorded",paymentStatus:"received",createdAt:now
      };
      tx.objectStore("recharge_transactions").add(result);
      tx.objectStore("recharge_wallet_transactions").add({
        id:uid(),providerId,providerName:provider.name,entryType:"DEBIT",
        amountPaise:calculation.walletDebitPaise,balanceBeforePaise:before,
        balanceAfterPaise:after,rechargeId:id,note:serviceType+" recharge",createdAt:now
      });
    };
    providerReq.onsuccess=()=>{provider=providerReq.result;pReady=true;apply();};
    walletReq.onsuccess=()=>{wallet=walletReq.result;wReady=true;apply();};
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>reject(failure||tx.error);
    tx.onabort=()=>reject(failure||tx.error||new Error("Recharge could not be saved."));
  });
}

export async function recordPurchase({ supplierId=null, purchaseType="line_supply", items=[], payments=[], invoiceNumber="", note="" }) {
  if (!items.length) throw new Error("Add at least one product to the purchase.");
  const database=await db();
  const id=uid(),now=new Date().toISOString();
  const normalized=items.map(item=>({
    productId:item.productId,quantity:Number(item.quantity),
    unitCostPaise:Math.round(Number(item.unitCostPaise)),
    lineTotalPaise:Math.round(Number(item.quantity)*Number(item.unitCostPaise))
  }));
  if(normalized.some(item=>!item.productId||!Number.isFinite(item.quantity)||item.quantity<=0||!Number.isSafeInteger(item.unitCostPaise)||item.unitCostPaise<0)) throw new Error("Check each purchase product, quantity and cost.");
  const totalPaise=normalized.reduce((sum,item)=>sum+item.lineTotalPaise,0);
  const paymentTotal=payments.reduce((sum,p)=>sum+Math.round(Number(p.amountPaise||0)),0);
  if(paymentTotal>totalPaise) throw new Error("Payments cannot exceed the purchase total.");
  return new Promise((resolve,reject)=>{
    const tx=database.transaction(["products","purchases","purchase_items","purchase_payments","stock_movements","supplier_ledger_entries","payments"],"readwrite");
    const products=tx.objectStore("products"),purchase={id,supplierId,purchaseType,invoiceNumber:String(invoiceNumber||"").trim(),totalPaise,paidPaise:paymentTotal,duePaise:totalPaise-paymentTotal,status:paymentTotal>=totalPaise?"paid":paymentTotal>0?"partial":"unpaid",note,createdAt:now};
    let pending=normalized.length,failure=null;
    const finishIfReady=()=>{
      if(failure)return;
      if(pending!==0)return;
      tx.objectStore("purchases").add(purchase);
      normalized.forEach((item,index)=>{
        const productId=item.productId;
        const productReq=products.get(productId);
        productReq.onsuccess=()=>{
          const product=productReq.result;
          if(!product){failure=new Error("A selected product no longer exists.");tx.abort();return;}
          const oldQty=Number(product.qty||0),newQty=oldQty+item.quantity;
          const oldCost=Number(product.costPaise||0);
          const weightedCost=newQty>0?Math.round((oldQty*oldCost+item.quantity*item.unitCostPaise)/newQty):item.unitCostPaise;
          product.qty=newQty;product.costPaise=weightedCost;product.updatedAt=now;products.put(product);
          const purchaseItem={id:uid(),purchaseId:id,productId,productName:product.name,quantity:item.quantity,unitCostPaise:item.unitCostPaise,lineTotalPaise:item.lineTotalPaise};
          tx.objectStore("purchase_items").add(purchaseItem);
          tx.objectStore("stock_movements").add({id:uid(),productId,productName:product.name,movementType:"PURCHASE",quantityDelta:item.quantity,balanceAfter:newQty,referenceId:id,note:"Purchase stock received",createdAt:now});
        };
      });
      payments.forEach(payment=>{
        const paymentId=uid(),amount=Math.round(Number(payment.amountPaise||0));
        tx.objectStore("purchase_payments").add({id:paymentId,purchaseId:id,supplierId,amountPaise:amount,paymentMethod:payment.paymentMethod||"Cash",note:payment.note||"",createdAt:now});
        tx.objectStore("payments").add({id:paymentId,direction:"out",partyType:"supplier",partyId:supplierId,referenceId:id,amountPaise:amount,paymentMethod:payment.paymentMethod||"Cash",note:"Purchase payment",createdAt:now});
      });
      if(supplierId&&totalPaise)tx.objectStore("supplier_ledger_entries").add({id:uid(),supplierId,entryType:"PURCHASE_BILL",amountPaise:totalPaise,balanceDeltaPaise:totalPaise,referenceId:id,note:"Purchase "+(purchase.invoiceNumber||""),createdAt:now});
      if(supplierId&&paymentTotal)tx.objectStore("supplier_ledger_entries").add({id:uid(),supplierId,entryType:"PURCHASE_PAYMENT",amountPaise:paymentTotal,balanceDeltaPaise:-paymentTotal,referenceId:id,note:"Payment at purchase",createdAt:now});
    };
    normalized.forEach(()=>{pending--;});
    finishIfReady();
    tx.oncomplete=()=>resolve(purchase);
    tx.onerror=()=>reject(failure||tx.error);
    tx.onabort=()=>reject(failure||tx.error||new Error("Purchase could not be saved."));
  });
}

export async function recordSale({ customerId=null, items=[], paidPaise=0, paymentMethod="Cash", note="" }) {
  if(!items.length)throw new Error("Add at least one product to the sale.");
  const database=await db(),id=uid(),now=new Date().toISOString();
  const normalized=items.map(item=>({productId:item.productId,quantity:Number(item.quantity),unitPricePaise:Math.round(Number(item.unitPricePaise))}));
  const totalPaise=normalized.reduce((sum,item)=>sum+Math.round(item.quantity*item.unitPricePaise),0);
  const paid=Math.max(0,Math.round(Number(paidPaise||0)));
  if(normalized.some(item=>!item.productId||!Number.isFinite(item.quantity)||item.quantity<=0||!Number.isSafeInteger(item.unitPricePaise)||item.unitPricePaise<0))throw new Error("Check sale products, quantities and prices.");
  if(paid>totalPaise)throw new Error("Received amount cannot exceed the invoice total.");
  return new Promise((resolve,reject)=>{
    const tx=database.transaction(["products","sales","sale_items","stock_movements","customer_ledger_entries","payments"],"readwrite");
    const products=tx.objectStore("products"),itemsStore=tx.objectStore("sale_items"),movements=tx.objectStore("stock_movements");
    const sale={id,customerId,totalPaise,paidPaise:paid,duePaise:totalPaise-paid,paymentMethod,status:paid>=totalPaise?"paid":paid>0?"partial":"credit",note,createdAt:now};
    let pending=normalized.length,failure=null;
    normalized.forEach(item=>{
      const req=products.get(item.productId);
      req.onsuccess=()=>{
        const product=req.result;
        if(!product){failure=new Error("A selected product no longer exists.");tx.abort();return;}
        const qty=Number(product.qty||0);
        if(qty<item.quantity){failure=new Error("Not enough stock for "+product.name+". Available: "+qty);tx.abort();return;}
        const after=qty-item.quantity;product.qty=after;product.updatedAt=now;products.put(product);
        const lineTotalPaise=Math.round(item.quantity*item.unitPricePaise);
        itemsStore.add({id:uid(),saleId:id,productId:item.productId,productName:product.name,quantity:item.quantity,unitCostPaise:Number(product.costPaise||0),unitPricePaise:item.unitPricePaise,lineTotalPaise});
        movements.add({id:uid(),productId:item.productId,productName:product.name,movementType:"SALE",quantityDelta:-item.quantity,balanceAfter:after,referenceId:id,note:"POS sale",createdAt:now});
        pending--;
        if(pending===0&&!failure){
          tx.objectStore("sales").add(sale);
          if(sale.duePaise>0&&customerId)tx.objectStore("customer_ledger_entries").add({id:uid(),customerId,entryType:"SALE_DUE",amountPaise:sale.duePaise,balanceDeltaPaise:sale.duePaise,referenceId:id,note:"POS sale due",createdAt:now});
          if(paid>0)tx.objectStore("payments").add({id:uid(),direction:"in",partyType:"sale",partyId:customerId,referenceId:id,amountPaise:paid,paymentMethod,note:"Sale payment",createdAt:now});
        }
      };
    });
    tx.oncomplete=()=>resolve(sale);
    tx.onerror=()=>reject(failure||tx.error);
    tx.onabort=()=>reject(failure||tx.error||new Error("Sale could not be saved."));
  });
}

export async function recordSupplierPayment({ supplierId, amountPaise, paymentMethod="Cash", agentId=null, note="" }) {
  const amount=Math.round(Number(amountPaise));
  if(!Number.isSafeInteger(amount)||amount<=0)throw new Error("Enter a valid payment amount.");
  const database=await db(),now=new Date().toISOString(),id=uid();
  return new Promise((resolve,reject)=>{
    const stores=["suppliers","supplier_ledger_entries","supplier_payments","agent_collections"];
    const tx=database.transaction([...stores,"payments"],"readwrite");
    const req=tx.objectStore("suppliers").get(supplierId);
    let result,failure=null;
    req.onsuccess=()=>{
      if(!req.result){failure=new Error("Supplier not found.");tx.abort();return;}
      result={id,supplierId,amountPaise:amount,paymentMethod,agentId,note,createdAt:now};
      tx.objectStore("supplier_payments").add(result);
      tx.objectStore("supplier_ledger_entries").add({id:uid(),supplierId,entryType:"SUPPLIER_PAYMENT",amountPaise:amount,balanceDeltaPaise:-amount,referenceId:id,agentId,note:String(note||"Supplier payment"),createdAt:now});
      if(agentId)tx.objectStore("agent_collections").add({id:uid(),supplierId,agentId,amountPaise:amount,paymentMethod,note,referenceId:id,createdAt:now});
      tx.objectStore("payments").add({id,direction:"out",partyType:"supplier",partyId:supplierId,amountPaise:amount,paymentMethod,note,referenceId:id,createdAt:now});
    };
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>reject(failure||tx.error);
    tx.onabort=()=>reject(failure||tx.error||new Error("Payment could not be saved."));
  });
}

export async function recordPurchasePayment({ purchaseId, supplierId, amountPaise, paymentMethod="Cash", agentId=null, note="" }) {
  const amount=Math.round(Number(amountPaise));
  if(!Number.isSafeInteger(amount)||amount<=0)throw new Error("Enter a valid payment amount.");
  const database=await db(),now=new Date().toISOString(),id=uid();
  return new Promise((resolve,reject)=>{
    const tx=database.transaction(["purchases","purchase_payments","supplier_ledger_entries","agent_collections","payments"],"readwrite");
    const req=tx.objectStore("purchases").get(purchaseId);let result,failure=null;
    req.onsuccess=()=>{
      const purchase=req.result;
      if(!purchase){failure=new Error("Purchase invoice not found.");tx.abort();return;}
      const due=Math.max(0,Number(purchase.duePaise||0));
      if(amount>due){failure=new Error("Payment is higher than the invoice outstanding amount.");tx.abort();return;}
      result={id,purchaseId,supplierId:supplierId||purchase.supplierId||null,amountPaise:amount,paymentMethod,agentId,note,createdAt:now};
      purchase.paidPaise=Number(purchase.paidPaise||0)+amount;
      purchase.duePaise=Math.max(0,Number(purchase.totalPaise||0)-purchase.paidPaise);
      purchase.status=purchase.duePaise===0?"paid":"partial";
      purchase.updatedAt=now;
      tx.objectStore("purchases").put(purchase);
      tx.objectStore("purchase_payments").add(result);
      if(result.supplierId)tx.objectStore("supplier_ledger_entries").add({id:uid(),supplierId:result.supplierId,entryType:"PURCHASE_PAYMENT",amountPaise:amount,balanceDeltaPaise:-amount,referenceId:purchaseId,agentId,note,createdAt:now});
      if(agentId)tx.objectStore("agent_collections").add({id:uid(),supplierId:result.supplierId,agentId,amountPaise:amount,paymentMethod,note,referenceId:purchaseId,createdAt:now});
      tx.objectStore("payments").add({id,direction:"out",partyType:"supplier",partyId:result.supplierId,amountPaise:amount,paymentMethod,note,referenceId:purchaseId,createdAt:now});
    };
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>reject(failure||tx.error);
    tx.onabort=()=>reject(failure||tx.error||new Error("Purchase payment failed."));
  });
}

export async function recordCustomerPayment({ customerId, amountPaise, paymentMethod="Cash", note="" }) {
  const amount=Math.round(Number(amountPaise));
  if(!Number.isSafeInteger(amount)||amount<=0)throw new Error("Enter a valid payment amount.");
  const database=await db(),now=new Date().toISOString(),id=uid();
  return new Promise((resolve,reject)=>{
    const tx=database.transaction(["customer_ledger_entries","customer_payments","payments"],"readwrite");
    const payment={id,customerId,amountPaise:amount,paymentMethod,note,createdAt:now};
    tx.objectStore("customer_payments").add(payment);
    tx.objectStore("customer_ledger_entries").add({id:uid(),customerId,entryType:"CUSTOMER_PAYMENT",amountPaise:amount,balanceDeltaPaise:-amount,referenceId:id,note,createdAt:now});
    tx.objectStore("payments").add({id,direction:"in",partyType:"customer",partyId:customerId,amountPaise:amount,paymentMethod,note,createdAt:now});
    tx.oncomplete=()=>resolve(payment);
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error||new Error("Customer payment failed."));
  });
}

export async function createRepairJob(data) {
  const database=await db(),id=uid(),now=new Date().toISOString();
  const job={...data,id,status:"pending",createdAt:now,updatedAt:now};
  await add("repair_jobs",job);
  await add("repair_status_history",{id:uid(),repairJobId:id,status:"pending",note:"Device received",createdAt:now});
  return job;
}
export async function updateRepairStatus(repairJobId,status,note="") {
  const database=await db(),now=new Date().toISOString();
  return new Promise((resolve,reject)=>{
    const tx=database.transaction(["repair_jobs","repair_status_history"],"readwrite");
    const req=tx.objectStore("repair_jobs").get(repairJobId);let result;
    req.onsuccess=()=>{if(!req.result){tx.abort();return;}result={...req.result,status,updatedAt:now};tx.objectStore("repair_jobs").put(result);tx.objectStore("repair_status_history").add({id:uid(),repairJobId,status,note,createdAt:now});};
    tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("Could not update repair status."));
  });
}
export async function addRepairPart({ repairJobId,productId,quantity,customerUnitPricePaise }) {
  const qty=Number(quantity),database=await db(),id=uid(),now=new Date().toISOString();
  if(!Number.isFinite(qty)||qty<=0)throw new Error("Enter a valid component quantity.");
  return new Promise((resolve,reject)=>{
    const tx=database.transaction(["products","repair_jobs","repair_job_parts","stock_movements"],"readwrite");
    const productReq=tx.objectStore("products").get(productId);let result,failure=null;
    productReq.onsuccess=()=>{
      const product=productReq.result;if(!product){failure=new Error("Component product not found.");tx.abort();return;}
      const jobReq=tx.objectStore("repair_jobs").get(repairJobId);
      jobReq.onsuccess=()=>{
        const job=jobReq.result;if(!job){failure=new Error("Repair job not found.");tx.abort();return;}
        const available=Number(product.qty||0);if(available<qty){failure=new Error("Insufficient component stock. Available: "+available);tx.abort();return;}
        const cost=Number(product.costPaise||0),charge=Math.round(Number(customerUnitPricePaise));
        if(!Number.isSafeInteger(charge)||charge<0){failure=new Error("Enter a valid customer price.");tx.abort();return;}
        product.qty=available-qty;product.updatedAt=now;tx.objectStore("products").put(product);
        result={id,repairJobId,productId,productName:product.name,quantity:qty,unitCostPaise:cost,customerUnitPricePaise:charge,costTotalPaise:Math.round(cost*qty),customerTotalPaise:Math.round(charge*qty),createdAt:now};
        tx.objectStore("repair_job_parts").add(result);
        tx.objectStore("stock_movements").add({id:uid(),productId,productName:product.name,movementType:"REPAIR_USE",quantityDelta:-qty,balanceAfter:product.qty,referenceId:repairJobId,note:"Consumed for repair",createdAt:now});
      };
    };
    tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(failure||tx.error);tx.onabort=()=>reject(failure||tx.error||new Error("Could not add component."));
  });
}
export async function addRepairService({repairJobId,description,customerChargePaise,costBreakdown={}}) {
  const charge=Math.round(Number(customerChargePaise));
  if(!Number.isSafeInteger(charge)||charge<0)throw new Error("Enter a valid service charge.");
  const internalCostPaise=Object.values(costBreakdown).reduce((sum,value)=>sum+Math.max(0,Math.round(Number(value||0))),0);
  const row={id:uid(),repairJobId,description:String(description||"Repair service").trim(),customerChargePaise:charge,costBreakdown,internalCostPaise,createdAt:new Date().toISOString()};
  await add("repair_job_services",row);return row;
}

export async function recordRepairPayment({repairJobId,customerId=null,amountPaise,paymentMethod="Cash",note=""}) {
  const amount=Math.round(Number(amountPaise));
  if(!Number.isSafeInteger(amount)||amount<=0)throw new Error("Enter a valid repair payment.");
  const database=await db(),now=new Date().toISOString(),id=uid();
  const payment={id,repairJobId,customerId,amountPaise:amount,paymentMethod,note,createdAt:now};
  await add("repair_payments",payment);
  await add("payments",{...payment,direction:"in",partyType:"repair",partyId:customerId});
  return payment;
}

export async function exportAll() {
  const database=await db(),names=Array.from(database.objectStoreNames),tx=database.transaction(names,"readonly");
  const output={schemaVersion:DB_VERSION,exportedAt:new Date().toISOString(),data:{}};
  await Promise.all(names.map(name=>new Promise((resolve,reject)=>{
    const request=tx.objectStore(name).getAll();
    request.onsuccess=()=>{output.data[name]=request.result||[];resolve();};
    request.onerror=()=>reject(request.error);
  })));
  return output;
}
export async function restoreAll(payload) {
  if(!payload?.data||!payload.schemaVersion)throw new Error("This is not a valid Mobile Shop ERP backup.");
  if(Number(payload.schemaVersion)>DB_VERSION)throw new Error("This backup was made by a newer app version.");
  const database=await db(),names=Object.keys(payload.data).filter(name=>database.objectStoreNames.contains(name));
  return new Promise((resolve,reject)=>{
    const tx=database.transaction(names,"readwrite");
    for(const name of names){const store=tx.objectStore(name);store.clear();for(const row of payload.data[name]||[])store.put(row);}
    tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("Restore cancelled."));
  });
}
