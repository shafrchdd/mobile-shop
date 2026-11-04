import {
  all, add, uid, exportAll, restoreAll,
  saveRechargeProvider, topupRechargeWallet, completeRecharge
} from "./database.js";

const $ = (selector, root = document) => root.querySelector(selector);
const navItems = [
  ["home","Home","layout-dashboard"],
  ["sales","Sales & POS","shopping-cart"],
  ["recharge","Recharge","smartphone"],
  ["inventory","Inventory","package"],
  ["customers","Customers","users"],
  ["repairs","Repairs","wrench"],
  ["purchases","Purchases","truck"],
  ["agents","Collection agents","hand-coins"],
  ["accounts","Money & day book","wallet"],
  ["reports","Reports","chart-no-axes-combined"],
  ["settings","Settings","settings"]
];
const mobileItems = [
  ["home","Home","house"],
  ["sales","Sell","shopping-cart"],
  ["recharge","Recharge","smartphone"],
  ["repairs","Repairs","wrench"],
  ["more","More","grid-2x2"]
];
let current = "home";
let rechargeService = "mobile";
let installPrompt = null;

const money = paise => "₹" + (Number(paise || 0) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const rupees = value => "₹" + Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const todayKey = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const todayLabel = () => new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" }).format(new Date());
const safe = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const icon = (name, size = "") => '<i data-lucide="' + name + '" class="' + size + '"></i>';

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("show"), 2600);
}
function refreshIcons() {
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons({ attrs: { "stroke-width": 1.8 } });
  }
}
window.addEventListener("load", refreshIcons, { once: true });
function navButton(item, mobile = false) {
  const active = current === item[0] || (mobile && item[0] === "more" && !mobileItems.some(x => x[0] === current));
  return '<button type="button" data-page="' + item[0] + '" class="' + (mobile ? "mobile-nav-button " : "side-nav-button ") + (active ? "active" : "") + '">' +
    (mobile ? '<span class="nav-icon-wrap">' + icon(item[2]) + '</span><span>' + item[1] + '</span>' : icon(item[2]) + '<span>' + item[1] + '</span>') + '</button>';
}
function renderNav() {
  $("#sideNav").innerHTML = navItems.map(item => navButton(item)).join("");
  $("#mobileNav").innerHTML = mobileItems.map(item => navButton(item, true)).join("");
  document.querySelectorAll("[data-page]").forEach(button => {
    button.onclick = () => go(button.dataset.page);
  });
}
function setTitle(title) {
  $("#pageTitle").textContent = title;
  $("#todayLabel").textContent = todayLabel();
}
async function go(page) {
  current = page;
  await render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function statCard(label, value, iconName, note) {
  return '<article class="stat-card"><div class="stat-head"><span>' + label + '</span><span class="stat-icon">' + icon(iconName) + '</span></div><strong class="stat-value">' + value + '</strong><span class="stat-note">' + (note || "") + '</span></article>';
}
function quickAction(page, label, iconName) {
  return '<button class="quick-action" type="button" data-page="' + page + '"><span class="quick-icon">' + icon(iconName) + '</span><b>' + label + '</b></button>';
}
function sectionHeading(title, subtitle, action, page) {
  return '<div class="section-heading"><div><h2>' + title + '</h2>' + (subtitle ? '<p>' + subtitle + '</p>' : '') + '</div>' +
    (action ? '<button class="text-link" type="button" data-page="' + page + '">' + action + '</button>' : '') + '</div>';
}
function listRow(title, subtitle, amount, amountNote, iconName) {
  return '<div class="list-row"><span class="list-avatar">' + icon(iconName || "receipt") + '</span><div class="list-main"><b>' + safe(title) + '</b><small>' + safe(subtitle || "") + '</small></div><div class="list-value"><b>' + safe(amount || "") + '</b><small>' + safe(amountNote || "") + '</small></div></div>';
}
function recordCard(title, subtitle, value, note, iconName) {
  return '<article class="record-card"><span class="list-avatar">' + icon(iconName || "file-text") + '</span><div class="record-info"><b>' + safe(title) + '</b><small>' + safe(subtitle || "") + '</small></div><div class="record-end">' + safe(value || "") + '<small>' + safe(note || "") + '</small></div></article>';
}
function commissionFor(provider, amountPaise) {
  const value = Number(provider.commissionValue || 0);
  return provider.commissionType === "fixed" ? Math.round(value * 100) : Math.round(amountPaise * value / 100);
}
function deductionFor(provider, amountPaise) {
  if ((provider.deductionType || "after_commission") === "fixed") return Math.round(Number(provider.deductionValue || 0) * 100);
  if (provider.deductionType === "percentage") return Math.round(amountPaise * Number(provider.deductionValue || 0) / 100);
  return amountPaise - commissionFor(provider, amountPaise);
}
function providerRuleText(provider) {
  const commission = provider.commissionType === "fixed"
    ? rupees(provider.commissionValue) + " fixed"
    : Number(provider.commissionValue || 0) + "% commission";
  let deduction = "Recharge amount − commission";
  if (provider.deductionType === "percentage") deduction = Number(provider.deductionValue || 0) + "% wallet debit";
  if (provider.deductionType === "fixed") deduction = rupees(provider.deductionValue) + " fixed wallet debit";
  return commission + " · " + deduction;
}

async function renderHome() {
  const [products, customers, sales, repairs, providers, wallets, recharges, expenses] = await Promise.all([
    all("products"), all("customers"), all("sales"), all("repair_jobs"),
    all("recharge_platforms"), all("recharge_wallets"), all("recharge_transactions"), all("expenses")
  ]);
  const today = todayKey();
  const daySales = sales.filter(row => String(row.createdAt || "").slice(0, 10) === today);
  const dayRecharge = recharges.filter(row => String(row.createdAt || "").slice(0, 10) === today);
  const salesTotal = daySales.reduce((sum, row) => sum + Number(row.totalPaise || 0), 0);
  const rechargeTotal = dayRecharge.reduce((sum, row) => sum + Number(row.amountPaise || 0), 0);
  const commissionTotal = dayRecharge.reduce((sum, row) => sum + Number(row.commissionPaise || 0), 0);
  const openRepairs = repairs.filter(row => !["delivered", "cancelled"].includes(row.status));
  const walletTotal = wallets.reduce((sum, row) => sum + Number(row.balancePaise || 0), 0);
  const activeProviders = providers.filter(row => row.active !== false);
  const lowStock = products.filter(row => Number(row.qty || 0) <= Number(row.minStock || 0) && row.minStock != null);
  const latest = dayRecharge.slice().sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,4);

  let html = '<section class="welcome"><h2>Your shop, in control.</h2><p>' +
    'A quick view of today’s business. Add a sale, recharge or repair without digging through menus.</p>' +
    '<span class="welcome-meta">' + icon("wifi-off") + ' Offline-ready · ' + todayLabel() + '</span></section>';

  html += '<div class="stats-grid">';
  html += statCard("Sales today", money(salesTotal), "shopping-bag", daySales.length + " invoices");
  html += statCard("Recharge today", money(rechargeTotal), "smartphone", money(commissionTotal) + " commission");
  html += statCard("Recharge wallets", money(walletTotal), "wallet", activeProviders.length + " active providers");
  html += statCard("Open repairs", String(openRepairs.length), "wrench", "Jobs not yet delivered");
  html += '</div>';

  html += sectionHeading("Quick actions", "Common tasks are one tap away");
  html += '<div class="quick-grid">' +
    quickAction("sales", "New sale", "shopping-cart") +
    quickAction("recharge", "Recharge", "smartphone") +
    quickAction("repairs", "New repair", "wrench") +
    quickAction("expenses", "Add expense", "receipt") +
    quickAction("purchases", "Add purchase", "package-plus") +
    quickAction("customers", "Add customer", "user-round-plus") +
    '</div>';

  html += '<div class="content-grid">';
  html += '<div class="stack">' + sectionHeading("Recent recharges", "Latest recharge entries", "View all", "recharge") +
    '<div class="card">' + (latest.length ? '<div class="list-stack">' + latest.map(row =>
      listRow(row.providerName || "Recharge", (row.serviceType || "service").toUpperCase() + (row.recipient ? " · " + row.recipient : ""), money(row.amountPaise), money(row.commissionPaise) + " commission", "smartphone")
    ).join("") + '</div>' : '<div class="empty-state">Your recent recharge activity will appear here.</div>') + '</div></div>';
  html += '<div class="stack">' + sectionHeading("Shop overview", "Useful totals", "Inventory", "inventory") +
    '<div class="card"><div class="wallet-mini-grid">' +
      '<div class="wallet-mini"><small>Products</small><strong>' + products.length + '</strong></div>' +
      '<div class="wallet-mini"><small>Customers</small><strong>' + customers.length + '</strong></div>' +
      '<div class="wallet-mini"><small>Low stock</small><strong>' + lowStock.length + '</strong></div>' +
      '<div class="wallet-mini"><small>Expenses today</small><strong>' + money(expenses.filter(row => String(row.createdAt || "").slice(0,10) === today).reduce((s,row)=>s+Number(row.amountPaise||0),0)) + '</strong></div>' +
    '</div></div></div></div>';
  return html;
}

async function renderRecharge() {
  const [providers, wallets, transactions] = await Promise.all([
    all("recharge_platforms"), all("recharge_wallets"), all("recharge_transactions")
  ]);
  const active = providers.filter(row => row.active !== false);
  const walletMap = new Map(wallets.map(wallet => [wallet.providerId || wallet.id, wallet]));
  const latest = transactions.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,8);
  setTitle("Recharge");
  let html = '<div class="page-intro"><div><h2>Quick recharge</h2><p>Select the recharge provider and amount. Commission and wallet deduction are calculated for you.</p></div></div>';

  if (!active.length) {
    html += '<div class="card provider-empty"><span class="empty-icon">' + icon("wallet-cards") + '</span><h3>Set up a recharge provider first</h3><p>Add your recharge app/provider and save its commission and wallet deduction rules once. After that, recharge entry stays simple.</p><button class="btn btn-primary" type="button" data-page="providers">' + icon("plus") + ' Add recharge provider</button></div>';
  } else {
    html += '<div class="recharge-layout"><section class="card recharge-card">';
    html += '<div class="service-switch" role="group" aria-label="Recharge service">';
    html += '<button type="button" class="service-option ' + (rechargeService === "mobile" ? "active" : "") + '" data-service="mobile">' + icon("smartphone") + ' Mobile</button>';
    html += '<button type="button" class="service-option ' + (rechargeService === "dth" ? "active" : "") + '" data-service="dth">' + icon("tv") + ' DTH</button>';
    html += '<button type="button" class="service-option ' + (rechargeService === "other" ? "active" : "") + '" data-service="other">' + icon("zap") + ' Other</button>';
    html += '</div>';
    html += '<form id="rechargeForm" class="recharge-form" novalidate>';
    html += '<div class="field"><label for="rechargeProvider">Recharge provider</label><select id="rechargeProvider" name="providerId" required>' +
      active.map(provider => '<option value="' + safe(provider.id) + '">' + safe(provider.name) + '</option>').join("") +
      '</select></div>';
    html += '<div class="field" id="recipientField"><label for="rechargeRecipient" id="recipientLabel">Mobile number</label><input id="rechargeRecipient" name="recipient" type="tel" inputmode="numeric" autocomplete="tel" maxlength="18" placeholder="Enter 10-digit mobile number" required><span class="field-hint" id="recipientHint">Customer mobile number is required for mobile recharge.</span></div>';
    html += '<div class="field"><label for="rechargeAmount">Recharge amount</label><div class="amount-field"><span class="currency">₹</span><input id="rechargeAmount" name="amount" type="number" inputmode="decimal" min="1" step="0.01" placeholder="0.00" required></div></div>';
    html += '<div class="recharge-summary" id="rechargePreview"><div class="summary-line"><span>Provider commission</span><strong>—</strong></div><div class="summary-line"><span>Wallet deduction</span><strong>—</strong></div><div class="summary-line total"><span>Wallet balance after recharge</span><strong>—</strong></div></div>';
    html += '<button type="submit" class="btn btn-primary btn-block" id="rechargeSubmit">' + icon("check-circle") + ' Record recharge</button>';
    html += '<p class="recharge-submit-note">Recharge is recorded in this ERP. Complete the actual recharge in your provider app.</p>';
    html += '</form></section>';

    const walletCards = active.map(provider => {
      const wallet = walletMap.get(provider.id);
      return '<div class="wallet-mini"><small>' + safe(provider.name) + '</small><strong>' + money(wallet ? wallet.balancePaise : 0) + '</strong></div>';
    }).join("");
    html += '<aside class="stack"><section class="card"><h3 class="card-title">Provider wallet balances</h3><p class="card-subtitle">Add balance and edit commission rules in Settings.</p><div class="wallet-mini-grid">' + walletCards + '</div><button class="btn btn-secondary btn-block" style="margin-top:12px" type="button" data-page="providers">' + icon("settings-2") + ' Manage providers</button></section>';
    html += '<section class="card"><h3 class="card-title">Recent transactions</h3>' + (latest.length ? '<div class="list-stack">' + latest.map(row =>
      listRow(row.providerName || "Provider", (row.serviceType || "service").toUpperCase() + (row.recipient ? " · " + row.recipient : ""), money(row.amountPaise), "Wallet −" + money(row.walletDebitPaise) + " · " + money(row.commissionPaise) + " comm.", "smartphone")
    ).join("") + '</div>' : '<div class="empty-state">No recharge entries yet.</div>') + '</section></aside></div>';
  }

  $("#view").innerHTML = html;
  bindPageActions();
  if (active.length) bindRechargeForm(active, walletMap);
  refreshIcons();
}

function previewRecharge(active, walletMap) {
  const select = $("#rechargeProvider");
  const amountInput = $("#rechargeAmount");
  const provider = active.find(item => item.id === select.value);
  const amountPaise = Math.round(Number(amountInput.value || 0) * 100);
  const preview = $("#rechargePreview");
  const submit = $("#rechargeSubmit");
  if (!provider || !amountPaise || amountPaise <= 0) {
    preview.innerHTML = '<div class="summary-line"><span>Provider commission</span><strong>—</strong></div><div class="summary-line"><span>Wallet deduction</span><strong>—</strong></div><div class="summary-line total"><span>Wallet balance after recharge</span><strong>Enter amount</strong></div>';
    submit.disabled = false;
    return;
  }
  const wallet = walletMap.get(provider.id);
  const before = Number(wallet ? wallet.balancePaise : 0);
  const commission = commissionFor(provider, amountPaise);
  const debit = deductionFor(provider, amountPaise);
  const after = before - debit;
  const enough = after >= 0;
  preview.innerHTML =
    '<div class="summary-line"><span>Provider commission</span><strong>' + money(commission) + '</strong></div>' +
    '<div class="summary-line"><span>Wallet deduction</span><strong>' + money(debit) + '</strong></div>' +
    '<div class="summary-line"><span>Current wallet balance</span><strong>' + money(before) + '</strong></div>' +
    '<div class="summary-line total"><span>Balance after recharge</span><strong>' + money(after) + '</strong></div>' +
    (!enough ? '<div class="form-error">Insufficient wallet balance. Add funds in Settings → Recharge providers.</div>' : '');
  submit.disabled = !enough || debit < 0 || commission < 0;
  submit.innerHTML = icon("check-circle") + (enough ? " Record recharge · " + money(debit) + " wallet debit" : " Insufficient wallet balance");
  refreshIcons();
}
function bindRechargeForm(active, walletMap) {
  document.querySelectorAll("[data-service]").forEach(button => button.onclick = () => {
    rechargeService = button.dataset.service;
    document.querySelectorAll("[data-service]").forEach(item => item.classList.toggle("active", item === button));
    const input = $("#rechargeRecipient");
    const label = $("#recipientLabel");
    const hint = $("#recipientHint");
    if (rechargeService === "mobile") {
      label.textContent = "Mobile number";
      input.type = "tel"; input.inputMode = "numeric"; input.maxLength = 10;
      input.placeholder = "Enter 10-digit mobile number"; input.required = true;
      hint.textContent = "Required for mobile recharge.";
    } else if (rechargeService === "dth") {
      label.textContent = "DTH subscriber ID / phone (optional)";
      input.type = "text"; input.inputMode = "text"; input.maxLength = 32;
      input.placeholder = "Subscriber ID (optional)"; input.required = false;
      hint.textContent = "You can leave this empty if the provider does not require a reference.";
    } else {
      label.textContent = "Phone / reference number (optional)";
      input.type = "text"; input.inputMode = "text"; input.maxLength = 32;
      input.placeholder = "Reference or phone number (optional)"; input.required = false;
      hint.textContent = "Optional for other services.";
    }
  });
  $("#rechargeProvider").onchange = () => previewRecharge(active, walletMap);
  $("#rechargeAmount").oninput = () => previewRecharge(active, walletMap);
  $("#rechargeForm").onsubmit = async event => {
    event.preventDefault();
    const providerId = $("#rechargeProvider").value;
    const provider = active.find(item => item.id === providerId);
    const amountPaise = Math.round(Number($("#rechargeAmount").value || 0) * 100);
    const recipient = $("#rechargeRecipient").value.trim();
    if (!provider) return toast("Choose a recharge provider.");
    if (!amountPaise || amountPaise <= 0) return toast("Enter a valid recharge amount.");
    if (rechargeService === "mobile" && !/^[0-9]{10}$/.test(recipient.replace(/\D/g, ""))) return toast("Enter a valid 10-digit mobile number.");
    try {
      $("#rechargeSubmit").disabled = true;
      const result = await completeRecharge({ providerId, serviceType: rechargeService, recipient, amountPaise });
      toast("Recharge recorded. Wallet balance: " + money(result.walletBalanceAfterPaise));
      await renderRecharge();
    } catch (error) {
      toast(error.message || "Could not record recharge.");
      previewRecharge(active, walletMap);
    }
  };
  previewRecharge(active, walletMap);
}

async function renderProviders() {
  setTitle("Recharge providers");
  const [providers, wallets, entries] = await Promise.all([all("recharge_platforms"), all("recharge_wallets"), all("recharge_wallet_transactions")]);
  const walletMap = new Map(wallets.map(wallet => [wallet.providerId || wallet.id, wallet]));
  const pending = entries.filter(row => row.entryType === "CREDIT" && row.settlementStatus === "pending");
  let html = '<div class="page-intro"><div><h2>Recharge providers</h2><p>Set commission and wallet deduction rules once. Recharge entry will calculate everything automatically.</p></div><button class="btn btn-primary" id="addProvider">' + icon("plus") + '<span class="desktop-only">Add</span></button></div>';
  html += '<div class="card" style="margin-bottom:13px"><div class="wallet-mini-grid"><div class="wallet-mini"><small>Provider accounts</small><strong>' + providers.length + '</strong></div><div class="wallet-mini"><small>Pending agent-funded credits</small><strong>' + money(pending.reduce((sum,row)=>sum+Number(row.amountPaise||0),0)) + '</strong></div></div></div>';
  if (!providers.length) {
    html += '<div class="card provider-empty"><span class="empty-icon">' + icon("wallet") + '</span><h3>No providers configured</h3><p>Add each recharge app/distributor account. Configure commission type and wallet deduction here, not at the counter.</p><button class="btn btn-primary" id="addProviderEmpty">' + icon("plus") + ' Add first provider</button></div>';
  } else {
    html += '<div class="settings-grid">' + providers.map(provider => {
      const wallet = walletMap.get(provider.id);
      return '<article class="card provider-card"><div class="provider-top"><span class="provider-logo">' + icon("radio-tower") + '</span><div class="provider-info"><h3>' + safe(provider.name) + '</h3><p>' + (provider.active === false ? '<span class="pill danger">Inactive</span>' : '<span class="pill">Active</span>') + '</p></div></div>' +
        '<div class="provider-balance">' + money(wallet ? wallet.balancePaise : 0) + '</div><div class="provider-meta">Available provider wallet balance<br>' + safe(providerRuleText(provider)) + '</div>' +
        '<div class="provider-actions"><button class="btn btn-secondary btn-sm" type="button" data-topup="' + safe(provider.id) + '">' + icon("plus-circle") + ' Add balance</button><button class="btn btn-quiet btn-sm" type="button" data-edit-provider="' + safe(provider.id) + '">' + icon("pencil") + ' Edit rules</button></div></article>';
    }).join("") + '</div>';
  }
  $("#view").innerHTML = html;
  bindPageActions();
  const addButton = $("#addProvider") || $("#addProviderEmpty");
  if (addButton) addButton.onclick = () => openProviderEditor(null);
  document.querySelectorAll("[data-edit-provider]").forEach(button => button.onclick = () => openProviderEditor(providers.find(item => item.id === button.dataset.editProvider)));
  document.querySelectorAll("[data-topup]").forEach(button => button.onclick = () => openTopup(button.dataset.topup, providers.find(item => item.id === button.dataset.topup)));
  refreshIcons();
}

function openProviderEditor(provider) {
  const editing = !!provider;
  const item = provider || { commissionType: "percentage", commissionValue: 4, deductionType: "after_commission", deductionValue: 0, active: true };
  $("#modalKicker").textContent = "SETTINGS · RECHARGE";
  $("#modalTitle").textContent = editing ? "Edit provider rules" : "Add recharge provider";
  $("#modalBody").innerHTML =
    '<div class="field"><label for="providerName">Provider / recharge app name</label><input id="providerName" name="name" type="text" maxlength="60" placeholder="e.g. Distributor name" value="' + safe(item.name || "") + '" required></div>' +
    '<div class="form-grid two"><div class="field"><label for="commissionType">Commission type</label><select id="commissionType" name="commissionType"><option value="percentage">Percentage</option><option value="fixed">Fixed amount</option></select></div><div class="field"><label for="commissionValue" id="commissionValueLabel">Commission (%)</label><input id="commissionValue" name="commissionValue" type="number" min="0" step="0.01" value="' + safe(item.commissionValue ?? 4) + '" required></div></div>' +
    '<div class="field"><label for="deductionType">Wallet deduction rule</label><select id="deductionType" name="deductionType"><option value="after_commission">Recharge amount minus commission</option><option value="percentage">Percentage of recharge amount</option><option value="fixed">Fixed wallet deduction</option></select><span class="field-hint">Choose how much this provider deducts from its wallet for each recharge.</span></div>' +
    '<div class="field" id="deductionValueWrap" hidden><label for="deductionValue" id="deductionValueLabel">Deduction value</label><input id="deductionValue" name="deductionValue" type="number" min="0" step="0.01" value="' + safe(item.deductionValue || 0) + '"></div>' +
    (!editing ? '<div class="field"><label for="openingBalance">Opening wallet balance (₹)</label><input id="openingBalance" name="openingBalance" type="number" min="0" step="0.01" value="0"><span class="field-hint">Enter the balance already available in the recharge app.</span></div>' : '') +
    '<label class="setting-row"><input id="providerActive" type="checkbox" ' + (item.active !== false ? "checked" : "") + '><span class="setting-info"><b>Provider active</b><small>Inactive providers will not appear during recharge.</small></span></label>';
  $("#modal").showModal();
  $("#commissionType").value = item.commissionType || "percentage";
  $("#deductionType").value = item.deductionType || "after_commission";
  const updateRuleFields = () => {
    const type = $("#commissionType").value;
    $("#commissionValueLabel").textContent = type === "fixed" ? "Commission per recharge (₹)" : "Commission (%)";
    const mode = $("#deductionType").value;
    $("#deductionValueWrap").hidden = mode === "after_commission";
    $("#deductionValueLabel").textContent = mode === "fixed" ? "Fixed wallet deduction (₹)" : "Wallet deduction (%)";
    $("#deductionValue").required = mode !== "after_commission";
  };
  $("#commissionType").onchange = updateRuleFields;
  $("#deductionType").onchange = updateRuleFields;
  updateRuleFields();
  $("#modalSave").onclick = async event => {
    event.preventDefault();
    const name = $("#providerName").value.trim();
    const commissionValue = Number($("#commissionValue").value || 0);
    const deductionType = $("#deductionType").value;
    const deductionValue = Number($("#deductionValue").value || 0);
    if (!name) return toast("Enter a provider name.");
    if (commissionValue < 0 || (deductionType !== "after_commission" && deductionValue < 0)) return toast("Rule values cannot be negative.");
    if ($("#commissionType").value === "percentage" && commissionValue > 100) return toast("Commission percentage cannot exceed 100%.");
    if (deductionType === "percentage" && deductionValue > 500) return toast("Check the wallet deduction percentage.");
    try {
      const openingBalancePaise = editing ? undefined : Math.round(Number($("#openingBalance").value || 0) * 100);
      await saveRechargeProvider({
        id: item.id, name, commissionType: $("#commissionType").value, commissionValue,
        deductionType, deductionValue, active: $("#providerActive").checked, openingBalancePaise
      });
      $("#modal").close();
      toast(editing ? "Provider rules updated." : "Provider added.");
      await renderProviders();
    } catch (error) { toast(error.message || "Could not save provider."); }
  };
  refreshIcons();
}

function openTopup(providerId, provider) {
  $("#modalKicker").textContent = "PROVIDER WALLET";
  $("#modalTitle").textContent = "Add wallet balance";
  $("#modalBody").innerHTML =
    '<p class="inline-note" style="margin:0 0 14px">Adding balance to <b>' + safe(provider.name) + '</b>. If a collection agent supplied this credit, enter their name so it can be followed up.</p>' +
    '<div class="field"><label for="topupAmount">Amount credited (₹)</label><input id="topupAmount" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="0.00" required></div>' +
    '<div class="field"><label for="topupAgent">Collection agent (optional)</label><input id="topupAgent" type="text" placeholder="Agent name"></div>' +
    '<div class="field"><label for="topupNote">Note (optional)</label><input id="topupNote" type="text" placeholder="Reference / details"></div>';
  $("#modal").showModal();
  $("#modalSave").onclick = async event => {
    event.preventDefault();
    const amount = Math.round(Number($("#topupAmount").value || 0) * 100);
    if (!amount || amount <= 0) return toast("Enter a valid top-up amount.");
    try {
      const agentName = $("#topupAgent").value.trim();
      await topupRechargeWallet(providerId, amount, agentName, $("#topupNote").value.trim());
      $("#modal").close();
      toast("Wallet credited by " + money(amount) + (agentName ? " · agent collection pending" : ""));
      await renderProviders();
    } catch (error) { toast(error.message || "Could not add balance."); }
  };
}

const pageConfig = {
  sales: { title:"Sales & POS", description:"Record a shop sale. Product-level billing and invoice checkout will be expanded next.", store:"sales", button:"New sale", icon:"shopping-cart", fields:[["customer","Customer name","text"],["description","Item / sale details","text"],["total","Invoice total (₹)","number"],["paid","Amount received (₹)","number"],["paymentMethod","Payment method","select:Cash,UPI,Bank,Card,Credit"]] },
  inventory: { title:"Inventory", description:"Add phones, accessories, remotes, components and other shop stock.", store:"products", button:"Add product", icon:"package", fields:[["name","Product name","text"],["category","Category","text"],["sku","SKU / barcode","text"],["qty","Opening quantity","number"],["minStock","Low stock alert at","number"],["cost","Purchase cost (₹)","number"],["price","Selling price (₹)","number"]] },
  customers: { title:"Customers", description:"Customer contacts and payment follow-up.", store:"customers", button:"Add customer", icon:"users", fields:[["name","Customer name","text"],["phone","Mobile number","tel"],["address","Address / place","text"]] },
  repairs: { title:"Repairs", description:"Create a service job card and track repair work.", store:"repair_jobs", button:"New repair job", icon:"wrench", fields:[["customer","Customer name","text"],["phone","Customer mobile","tel"],["device","Device / model","text"],["imei","IMEI / serial (optional)","text"],["problem","Reported problem","text"],["estimate","Estimated amount (₹)","number"]] },
  purchases: { title:"Purchases", description:"Record line supply and direct market purchases.", store:"purchases", button:"Record purchase", icon:"truck", fields:[["supplier","Supplier name","text"],["purchaseType","Purchase type","select:Line supply,Direct market"],["total","Bill total (₹)","number"],["paid","Amount paid (₹)","number"],["dueDate","Due date","date"]] },
  expenses: { title:"Expenses", description:"Track rent, electricity, soldering materials, wages and every small shop expense.", store:"expenses", button:"Add expense", icon:"receipt", fields:[["category","Expense category","text"],["amount","Amount (₹)","number"],["paymentMethod","Paid from","select:Cash,UPI,Bank"],["note","Description (optional)","text"]] },
  agents: { title:"Collection agents", description:"Recharge wallet credit provided by agents and follow pending collections.", store:"recharge_wallet_transactions", button:"Agent activity", icon:"hand-coins", fields:[] },
  accounts: { title:"Money & day book", description:"Record cash received or paid and review recent money movements.", store:"payments", button:"Record payment", icon:"wallet", fields:[["party","Person / description","text"],["amount","Amount (₹)","number"],["direction","Received or paid","select:Received,Paid"],["paymentMethod","Account","select:Cash,UPI,Bank,Card"],["note","Note (optional)","text"]] }
};

async function renderGeneric(pageId) {
  const config = pageConfig[pageId];
  setTitle(config.title);
  const records = await all(config.store);
  let html = '<div class="page-intro"><div><h2>' + config.title + '</h2><p>' + config.description + '</p></div>';
  if (config.fields.length) html += '<button class="btn btn-primary" id="addRecord">' + icon("plus") + '<span class="desktop-only">' + config.button + '</span></button>';
  html += '</div>';
  if (pageId === "agents") {
    const topups = records.filter(row => row.entryType === "CREDIT");
    const pending = topups.filter(row => row.settlementStatus === "pending");
    html += '<div class="stats-grid">' +
      statCard("Pending agent collections", money(pending.reduce((sum,row)=>sum+Number(row.amountPaise||0),0)), "clock", pending.length + " wallet credits") +
      statCard("Agent-funded credits", String(topups.length), "hand-coins", "Total top-up entries") +
      '</div><div class="section-heading"><h2>Agent-funded wallet credits</h2></div>';
    const list = pending.concat(topups.filter(row => row.settlementStatus !== "pending")).slice().reverse();
    html += list.length ? '<div class="record-list">' + list.map(row => recordCard(row.agentName || "Agent not specified", row.providerName + " · " + new Date(row.createdAt).toLocaleString("en-IN"), money(row.amountPaise), row.settlementStatus === "pending" ? "Collection pending" : "Recorded", "hand-coins")).join("") + '</div>' : '<div class="empty-state">Agent credit and collection history will appear here.</div>';
  } else {
    const searchable = records.slice().reverse();
    html += '<div class="search-wrap">' + icon("search") + '<input id="recordSearch" type="search" placeholder="Search records..." autocomplete="off"></div>';
    html += '<div class="record-list" id="recordList">' + (searchable.length ? searchable.slice(0,60).map(row => genericRecordCard(row, pageId)).join("") : '<div class="empty-state">No records yet. Add your first record.</div>') + '</div>';
  }
  $("#view").innerHTML = html;
  bindPageActions();
  if ($("#addRecord")) $("#addRecord").onclick = () => openGenericForm(config);
  if ($("#recordSearch")) $("#recordSearch").oninput = event => {
    const query = event.target.value.toLowerCase();
    const filtered = records.slice().reverse().filter(row => JSON.stringify(row).toLowerCase().includes(query));
    $("#recordList").innerHTML = filtered.length ? filtered.slice(0,60).map(row => genericRecordCard(row,pageId)).join("") : '<div class="empty-state">No matching records.</div>';
    refreshIcons();
  };
  refreshIcons();
}
function genericRecordCard(row, pageId) {
  let title = row.name || row.customer || row.device || row.supplier || row.party || row.category || row.description || row.phone || "Business record";
  let sub = row.phone || row.description || row.purchaseType || row.category || row.note || row.problem || "";
  let amount = row.totalPaise ?? row.amountPaise ?? row.pricePaise ?? row.estimatePaise;
  let value = amount == null ? (row.status || "Saved") : money(amount);
  let note = new Date(row.createdAt || Date.now()).toLocaleDateString("en-IN");
  return recordCard(title, sub, value, note, pageConfig[pageId]?.icon || "file-text");
}
function openGenericForm(config) {
  $("#modalKicker").textContent = "NEW RECORD";
  $("#modalTitle").textContent = config.button;
  $("#modalBody").innerHTML = '<div class="form-grid">' + config.fields.map(field => {
    const key=field[0], label=field[1], type=field[2];
    let control;
    if (type.startsWith("select:")) control = '<select name="' + key + '">' + type.slice(7).split(",").map(value=>'<option value="' + safe(value) + '">' + safe(value) + '</option>').join("") + '</select>';
    else control = '<input name="' + key + '" type="' + type + '" ' + (type === "number" ? 'min="0" step="0.01" inputmode="decimal"' : "") + ' ' + (label.includes("optional") ? "" : "required") + '>';
    return '<div class="field"><label>' + label + '</label>' + control + '</div>';
  }).join("") + '</div>';
  $("#modal").showModal();
  $("#modalSave").onclick = async event => {
    event.preventDefault();
    const formData = new FormData($("#modalForm"));
    const row = { id:uid(), createdAt:new Date().toISOString(), status:"saved" };
    for (const [key,value] of formData.entries()) {
      if (["total","paid","amount","cost","price","estimate"].includes(key)) row[key+"Paise"] = Math.round(Number(value || 0) * 100);
      else if (key === "qty" || key === "minStock") row[key] = Number(value || 0);
      else row[key] = value;
    }
    if (config.store === "repair_jobs") row.status = "received";
    try {
      await add(config.store,row);
      $("#modal").close();
      toast("Saved successfully.");
      await render();
    } catch (error) { toast(error.message || "Could not save record."); }
  };
  refreshIcons();
}

async function renderSettings() {
  setTitle("Settings");
  const [providers, wallets] = await Promise.all([all("recharge_platforms"),all("recharge_wallets")]);
  const balance = wallets.reduce((sum,row)=>sum+Number(row.balancePaise||0),0);
  $("#view").innerHTML =
    '<div class="page-intro"><div><h2>Settings & tools</h2><p>Configure how the app works and protect your business data.</p></div></div>' +
    '<div class="settings-grid">' +
      '<div class="card"><div class="setting-row"><span class="setting-icon">' + icon("radio-tower") + '</span><span class="setting-info"><b>Recharge providers</b><small>' + providers.length + ' providers · ' + money(balance) + ' total wallet balance. Commission and deduction rules are set here.</small></span><button class="btn btn-secondary btn-sm" data-page="providers">Manage</button></div></div>' +
      '<div class="card"><div class="setting-row"><span class="setting-icon">' + icon("database") + '</span><span class="setting-info"><b>Backup & restore</b><small>Export all local records to JSON or restore a previous backup.</small></span></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" id="exportBtn">' + icon("download") + ' Export backup</button><label class="btn btn-quiet btn-sm">' + icon("upload") + ' Restore backup<input type="file" id="restoreFile" accept=".json,application/json" hidden></label></div></div>' +
      '<div class="card"><div class="setting-row"><span class="setting-icon">' + icon("palette") + '</span><span class="setting-info"><b>Appearance</b><small>Switch between light and dark mode.</small></span><button class="btn btn-quiet btn-sm" id="themeSetting">Toggle</button></div></div>' +
      '<div class="card"><div class="setting-row"><span class="setting-icon">' + icon("smartphone") + '</span><span class="setting-info"><b>Install app</b><small>Add Mobile Shop ERP to your home screen or desktop.</small></span><button class="btn btn-quiet btn-sm" id="installBtn">Install</button></div></div>' +
    '</div>' +
    '<div class="section-heading"><h2>Application details</h2></div><div class="card"><p class="inline-note">Mobile Shop ERP · Offline-first PWA · IndexedDB schema v2 · Indian time zone (Asia/Kolkata). All business records are stored in this browser profile. Keep backups outside this device.</p></div>';
  bindPageActions();
  $("#exportBtn").onclick = async () => {
    try {
      const backup = await exportAll();
      downloadFile(JSON.stringify(backup,null,2), "mobile-shop-erp-backup-" + todayKey() + ".json", "application/json");
      toast("Backup downloaded.");
    } catch (error) { toast(error.message || "Backup failed."); }
  };
  $("#restoreFile").onchange = async event => {
    const file = event.target.files[0];
    if (!file) return;
    if (!confirm("Restore will replace the current records in this browser. Continue?")) { event.target.value=""; return; }
    try {
      await restoreAll(JSON.parse(await file.text()));
      toast("Backup restored.");
      await render();
    } catch (error) { toast(error.message || "Could not restore backup."); }
  };
  $("#themeSetting").onclick = toggleTheme;
  $("#installBtn").onclick = installApp;
  refreshIcons();
}

async function renderMore() {
  setTitle("More");
  const modules = [
    ["inventory","Inventory","Phones, accessories and stock","package"],
    ["customers","Customers","Contacts and balances","users"],
    ["purchases","Purchases","Line supply and market buys","truck"],
    ["agents","Collection agents","Wallet credit and collections","hand-coins"],
    ["accounts","Money & day book","Cash, UPI and payments","wallet"],
    ["expenses","Expenses","Rent, power, wages and more","receipt"],
    ["reports","Reports","Daily to yearly summaries","chart-no-axes-combined"],
    ["providers","Recharge providers","Commission and wallet rules","radio-tower"],
    ["settings","Settings & backup","App setup and data safety","settings"]
  ];
  $("#view").innerHTML = '<div class="page-intro"><div><h2>All modules</h2><p>Open any part of your shop management.</p></div></div><div class="module-grid">' +
    modules.map(item=>'<button class="module-tile" type="button" data-page="' + item[0] + '"><span class="module-icon">' + icon(item[3]) + '</span><span><b>' + item[1] + '</b><small>' + item[2] + '</small></span></button>').join("") +
    '</div>';
  bindPageActions();
  refreshIcons();
}

async function renderReports() {
  setTitle("Reports");
  const [sales,recharges,expenses,purchases,repairs] = await Promise.all(["sales","recharge_transactions","expenses","purchases","repair_jobs"].map(all));
  const periods = [
    ["Today",row=>String(row.createdAt||"").slice(0,10)===todayKey()],
    ["This month",row=>String(row.createdAt||"").slice(0,7)===todayKey().slice(0,7)],
    ["All time",()=>true]
  ];
  let html = '<div class="page-intro"><div><h2>Business reports</h2><p>Quick totals from records saved in this device.</p></div></div>';
  html += '<div class="stats-grid">';
  periods.forEach(([label,filter])=>{
    const s=sales.filter(filter).reduce((sum,row)=>sum+Number(row.totalPaise||0),0);
    const r=recharges.filter(filter).reduce((sum,row)=>sum+Number(row.commissionPaise||0),0);
    const e=expenses.filter(filter).reduce((sum,row)=>sum+Number(row.amountPaise||0),0);
    html += statCard(label+" sales",money(s),"shopping-bag",money(r)+" recharge commission");
    html += statCard(label+" expenses",money(e),"receipt","Recorded expenses");
  });
  html += '</div><div class="section-heading"><h2>Activity summary</h2></div><div class="card"><div class="wallet-mini-grid">' +
    '<div class="wallet-mini"><small>Recharge transactions</small><strong>' + recharges.length + '</strong></div>' +
    '<div class="wallet-mini"><small>Purchase records</small><strong>' + purchases.length + '</strong></div>' +
    '<div class="wallet-mini"><small>Repair jobs</small><strong>' + repairs.length + '</strong></div>' +
    '<div class="wallet-mini"><small>Sales invoices</small><strong>' + sales.length + '</strong></div>' +
    '</div><p class="inline-note" style="margin-top:13px">These are operational totals, not a finalized statutory profit-and-loss statement. The full accounting ledger and inventory cost reconciliation will be added before production accounting use.</p></div>';
  $("#view").innerHTML=html;
  refreshIcons();
}

async function render() {
  renderNav();
  if (current === "home") { setTitle("Overview"); $("#view").innerHTML = await renderHome(); bindPageActions(); }
  else if (current === "recharge") await renderRecharge();
  else if (current === "providers") await renderProviders();
  else if (current === "settings") await renderSettings();
  else if (current === "more") await renderMore();
  else if (current === "reports") await renderReports();
  else if (pageConfig[current]) await renderGeneric(current);
  else { current="home"; await render(); return; }
  refreshIcons();
}
function bindPageActions() {
  document.querySelectorAll("[data-page]").forEach(button => button.onclick = () => go(button.dataset.page));
}
function toggleTheme() {
  document.body.classList.toggle("theme-dark");
  localStorage.setItem("mobile-shop-theme", document.body.classList.contains("theme-dark") ? "dark" : "light");
  refreshIcons();
}
function downloadFile(content, name, type) {
  const url = URL.createObjectURL(new Blob([content],{type}));
  const anchor = document.createElement("a");
  anchor.href=url; anchor.download=name; anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function installApp() {
  if (!installPrompt) { toast("Open browser menu and choose Install app / Add to Home Screen."); return; }
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt=null;
}
$("#themeBtn").onclick = toggleTheme;
if (localStorage.getItem("mobile-shop-theme")==="dark") document.body.classList.add("theme-dark");
window.addEventListener("beforeinstallprompt",event=>{event.preventDefault();installPrompt=event;});
if ("serviceWorker" in navigator) {
  window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(error=>console.warn("PWA offline setup:",error)));
}
render().catch(error=>{
  console.error(error);
  $("#view").innerHTML='<div class="card empty-state">The app could not open its local database. Close other app tabs and reload. ' + safe(error.message) + '</div>';
});
