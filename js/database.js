const DB_NAME = "kerala_mobile_erp";
const DB_VERSION = 2;
const STORES = [
  "shop_settings","categories","brands","products","customers","suppliers","staff",
  "financial_accounts","expense_categories","service_catalog","stock_lots","stock_movements",
  "product_serials","sales","sale_items","sale_returns","sale_return_items","purchases",
  "purchase_items","purchase_returns","payments","payment_allocations","recharge_platforms",
  "recharge_operators","recharge_wallets","recharge_commission_rules","recharge_topups",
  "recharge_wallet_transactions","recharge_transactions","recharge_agents","agent_collections",
  "repair_jobs","repair_job_services","repair_job_parts","repair_status_history","repair_payments",
  "repair_warranties","expenses","recurring_expenses","wages","wage_advances","attendance",
  "accounts","journal_entries","journal_lines","reminders","audit_logs","app_settings","backup_history"
];

let connection;

export function db() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const name of STORES) {
        if (!database.objectStoreNames.contains(name)) {
          const store = database.createObjectStore(name, { keyPath: "id" });
          store.createIndex("createdAt", "createdAt", { unique: false });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Close other Mobile Shop ERP tabs, then reload."));
  });
  return connection;
}

export function uid() {
  return (globalThis.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

export async function add(storeName, value) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, "readwrite");
    tx.objectStore(storeName).add(value);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Transaction cancelled"));
  });
}

export async function put(storeName, value) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve(value);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Transaction cancelled"));
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
    const request = database.transaction(storeName, "readonly").objectStore(storeName).count();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/* Provider settings are stored separately from recharge entry. Wallet balance is kept
   in its own store so each top-up and recharge is auditable. */
export async function saveRechargeProvider(providerData) {
  const database = await db();
  const provider = {
    ...providerData,
    id: providerData.id || uid(),
    name: String(providerData.name || "").trim(),
    active: providerData.active !== false,
    updatedAt: new Date().toISOString()
  };
  if (!provider.name) throw new Error("Enter a provider name.");

  return new Promise((resolve, reject) => {
    const tx = database.transaction(["recharge_platforms", "recharge_wallets"], "readwrite");
    const providers = tx.objectStore("recharge_platforms");
    const wallets = tx.objectStore("recharge_wallets");
    const walletRequest = wallets.get(provider.id);
    walletRequest.onsuccess = () => {
      const currentWallet = walletRequest.result;
      providers.put(provider);
      if (!currentWallet) {
        wallets.put({
          id: provider.id,
          providerId: provider.id,
          providerName: provider.name,
          balancePaise: Math.max(0, Number(provider.openingBalancePaise || 0)),
          updatedAt: new Date().toISOString()
        });
      } else {
        currentWallet.providerName = provider.name;
        currentWallet.updatedAt = new Date().toISOString();
        wallets.put(currentWallet);
      }
    };
    tx.oncomplete = () => resolve(provider);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Could not save provider."));
  });
}

export async function topupRechargeWallet(providerId, amountPaise, agentName = "", note = "") {
  const database = await db();
  const amount = Math.round(Number(amountPaise));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid top-up amount.");

  return new Promise((resolve, reject) => {
    const tx = database.transaction(["recharge_platforms", "recharge_wallets", "recharge_wallet_transactions"], "readwrite");
    const providers = tx.objectStore("recharge_platforms");
    const wallets = tx.objectStore("recharge_wallets");
    const providerReq = providers.get(providerId);
    const walletReq = wallets.get(providerId);
    let provider = null;
    let wallet = null;
    let providerReady = false;
    let walletReady = false;
    let output = null;
    let appError = null;

    const apply = () => {
      if (!providerReady || !walletReady || appError) return;
      if (!provider || !wallet) {
        appError = new Error("Provider wallet was not found.");
        tx.abort();
        return;
      }
      const before = Number(wallet.balancePaise || 0);
      const after = before + amount;
      const now = new Date().toISOString();
      wallet.balancePaise = after;
      wallet.updatedAt = now;
      wallets.put(wallet);
      output = {
        id: uid(), providerId, providerName: provider.name, entryType: "CREDIT",
        amountPaise: amount, balanceBeforePaise: before, balanceAfterPaise: after,
        agentName: String(agentName || "").trim(),
        settlementStatus: agentName ? "pending" : "not-tracked",
        note: String(note || "").trim(), createdAt: now
      };
      tx.objectStore("recharge_wallet_transactions").add(output);
      tx.objectStore("recharge_topups").add({ ...output, id: uid() });
    };

    providerReq.onsuccess = () => { provider = providerReq.result; providerReady = true; apply(); };
    walletReq.onsuccess = () => { wallet = walletReq.result; walletReady = true; apply(); };
    tx.oncomplete = () => resolve(output);
    tx.onerror = () => reject(appError || tx.error);
    tx.onabort = () => reject(appError || tx.error || new Error("Wallet top-up cancelled."));
  });
}

function calculateRecharge(provider, faceValuePaise) {
  const amount = Math.round(Number(faceValuePaise));
  const commissionValue = Number(provider.commissionValue || 0);
  let commissionPaise = 0;

  if (provider.commissionType === "fixed") {
    commissionPaise = Math.round(commissionValue * 100);
  } else {
    commissionPaise = Math.round(amount * commissionValue / 100);
  }

  let walletDebitPaise;
  if (provider.deductionType === "fixed") {
    walletDebitPaise = Math.round(Number(provider.deductionValue || 0) * 100);
  } else if (provider.deductionType === "percentage") {
    walletDebitPaise = Math.round(amount * Number(provider.deductionValue || 0) / 100);
  } else {
    walletDebitPaise = amount - commissionPaise;
  }

  if (commissionPaise < 0 || walletDebitPaise < 0) throw new Error("Provider rules produce a negative amount.");
  if (walletDebitPaise > amount * 5) throw new Error("Configured wallet deduction looks too high. Check provider settings.");
  return { commissionPaise, walletDebitPaise };
}

/* Save recharge, deduct the configured wallet debit and write the wallet history in
   one IndexedDB transaction. The cashier never enters commission or debit manually. */
export async function completeRecharge({ providerId, serviceType, recipient = "", amountPaise }) {
  const database = await db();
  const amount = Math.round(Number(amountPaise));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a valid recharge amount.");
  if (serviceType === "mobile" && !/^[0-9]{10}$/.test(String(recipient).replace(/\D/g, ""))) {
    throw new Error("Enter a valid 10-digit mobile number.");
  }

  return new Promise((resolve, reject) => {
    const tx = database.transaction(
      ["recharge_platforms", "recharge_wallets", "recharge_transactions", "recharge_wallet_transactions"],
      "readwrite"
    );
    const providerReq = tx.objectStore("recharge_platforms").get(providerId);
    const walletReq = tx.objectStore("recharge_wallets").get(providerId);
    let provider = null;
    let wallet = null;
    let providerReady = false;
    let walletReady = false;
    let output = null;
    let appError = null;

    const apply = () => {
      if (!providerReady || !walletReady || appError) return;
      if (!provider || provider.active === false) {
        appError = new Error("Select an active recharge provider.");
        tx.abort();
        return;
      }
      if (!wallet) {
        appError = new Error("This provider has no wallet yet. Add its opening balance in Settings → Recharge providers.");
        tx.abort();
        return;
      }

      let calc;
      try { calc = calculateRecharge(provider, amount); }
      catch (error) { appError = error; tx.abort(); return; }

      const before = Number(wallet.balancePaise || 0);
      if (before < calc.walletDebitPaise) {
        appError = new Error("Insufficient provider wallet balance. Available: ₹" + (before / 100).toFixed(2));
        tx.abort();
        return;
      }

      const now = new Date().toISOString();
      const after = before - calc.walletDebitPaise;
      const rechargeId = uid();
      wallet.balancePaise = after;
      wallet.updatedAt = now;
      tx.objectStore("recharge_wallets").put(wallet);

      output = {
        id: rechargeId, providerId, providerName: provider.name,
        serviceType, recipient: String(recipient || "").trim(),
        amountPaise: amount, customerChargePaise: amount,
        commissionPaise: calc.commissionPaise,
        walletDebitPaise: calc.walletDebitPaise,
        walletBalanceBeforePaise: before, walletBalanceAfterPaise: after,
        commissionRule: provider.commissionType,
        deductionRule: provider.deductionType || "after-commission",
        status: "recorded", paymentStatus: "received",
        createdAt: now
      };

      tx.objectStore("recharge_transactions").add(output);
      tx.objectStore("recharge_wallet_transactions").add({
        id: uid(), providerId, providerName: provider.name, entryType: "DEBIT",
        amountPaise: calc.walletDebitPaise, balanceBeforePaise: before,
        balanceAfterPaise: after, rechargeId, note: serviceType + " recharge",
        createdAt: now
      });
    };

    providerReq.onsuccess = () => { provider = providerReq.result; providerReady = true; apply(); };
    walletReq.onsuccess = () => { wallet = walletReq.result; walletReady = true; apply(); };
    tx.oncomplete = () => resolve(output);
    tx.onerror = () => reject(appError || tx.error);
    tx.onabort = () => reject(appError || tx.error || new Error("Recharge could not be saved."));
  });
}

export async function exportAll() {
  const database = await db();
  const names = Array.from(database.objectStoreNames);
  const tx = database.transaction(names, "readonly");
  const output = { schemaVersion: DB_VERSION, exportedAt: new Date().toISOString(), data: {} };
  await Promise.all(names.map(name => new Promise((resolve, reject) => {
    const request = tx.objectStore(name).getAll();
    request.onsuccess = () => { output.data[name] = request.result || []; resolve(); };
    request.onerror = () => reject(request.error);
  })));
  return output;
}

export async function restoreAll(payload) {
  if (!payload || !payload.data || !payload.schemaVersion) throw new Error("This is not a valid Mobile Shop ERP backup.");
  if (Number(payload.schemaVersion) > DB_VERSION) throw new Error("This backup was made by a newer app version.");
  const database = await db();
  const names = Object.keys(payload.data).filter(name => database.objectStoreNames.contains(name));
  return new Promise((resolve, reject) => {
    const tx = database.transaction(names, "readwrite");
    for (const name of names) {
      const store = tx.objectStore(name);
      store.clear();
      for (const row of payload.data[name] || []) store.put(row);
    }
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Restore cancelled."));
  });
}
