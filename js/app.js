import {
  all, add, put, uid, saveProduct, saveSupplier, saveCollectionAgent,
  saveRechargeProvider, topupRechargeWallet, completeRecharge,
  recordPurchase, recordPurchasePayment, recordSale, recordSupplierPayment,
  recordCustomerPayment, createRepairJob, updateRepairStatus,
  addRepairPart, addRepairService, recordRepairPayment, exportAll, restoreAll
} from "./database.js";

const $ = (selector, root=document) => root.querySelector(selector);
const money = paise => "₹" + (Number(paise||0)/100).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const rupees = value => "₹" + Number(value||0).toLocaleString("en-IN",{maximumFractionDigits:2});
const toPaise = value => Math.round(Number(value||0)*100);
const digits = value => String(value||"").replace(/\D/g,"");
const todayKey = () => new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata"}).format(new Date());
const todayLabel = () => new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",weekday:"long",day:"numeric",month:"long"}).format(new Date());
const safe = value => String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const icon = (name, extra="") => '<i data-lucide="'+name+'" class="'+extra+'"></i>';
let current = new URLSearchParams(location.search).get("page") || "home";
let rechargeService = "mobile";
let saleCart = [];
let purchaseCart = [];
let selectedRepairId = null;
let installPrompt = null;
let lastCustomerMatches = {};

const navItems = [
  ["home","Overview","layout-dashboard"],
  ["sales","Sales & POS","shopping-cart"],
  ["recharge","Recharge","smartphone"],
  ["inventory","Products & inventory","package"],
  ["purchases","Purchases","truck"],
  ["repairs","Repair jobs","wrench"],
  ["customers","Customers","users"],
  ["suppliers","Suppliers","store"],
  ["agents","Collection agents","hand-coins"],
  ["collections","Supplier collections","wallet"],
  ["expenses","Expenses","receipt"],
  ["accounts","Money & day book","landmark"],
  ["reports","Reports","chart-no-axes-combined"],
  ["settings","Settings & backup","settings"]
];
const mobileItems = [
  ["home","Home","house"],
  ["sales","Sell","shopping-cart"],
  ["recharge","Recharge","smartphone"],
  ["repairs","Repairs","wrench"],
  ["more","More","grid-2x2"]
];
const productTypes = [
  ["phone","Mobile phone"],["keypad","Keypad phone"],["accessory","Mobile accessory"],
  ["tv_accessory","TV / set-top box accessory"],["spare_part","Repair spare part"],
  ["consumable","Repair consumable"],["electronics","Other electronics"],["other","Other"]
];
const repairStatuses = [
  ["pending","Pending"],["working","Working"],["waiting_component","Waiting for component"],
  ["completed","Completed"],["rejected","Rejected"]
];

function toast(message) {
  const element=$("#toast"); element.textContent=message; element.classList.add("show");
  clearTimeout(toast.timer); toast.timer=setTimeout(()=>element.classList.remove("show"),2800);
}
function refreshIcons() {
  if(window.lucide && typeof window.lucide.createIcons==="function") window.lucide.createIcons({attrs:{"stroke-width":1.8}});
}
function closeModal() { const modal=$("#modal"); if(modal.open) modal.close(); }
function showModal(title, body, onSave, kicker="DETAILS", saveLabel="Save") {
  $("#modalKicker").textContent=kicker;
  $("#modalTitle").textContent=title;
  $("#modalBody").innerHTML=body;
  $("#modalSave").textContent=saveLabel;
  $("#modalSave").disabled=false;
  $("#modal").showModal();
  $("#modalForm").onsubmit=event=>event.preventDefault();
  $("#modalClose").onclick=closeModal;
  $("#modalCancel").onclick=closeModal;
  $("#modalSave").onclick=async event=>{
    event.preventDefault();
    if($("#modalSave").disabled)return;
    try { $("#modalSave").disabled=true; await onSave(); }
    catch(error) { toast(error.message||"Something went wrong."); $("#modalSave").disabled=false; }
  };
  refreshIcons();
}
$("#modal").addEventListener("click",event=>{if(event.target===$("#modal"))closeModal();});
$("#modal").addEventListener("cancel",()=>{});
function downloadFile(content,name,type) {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const anchor=document.createElement("a");anchor.href=url;anchor.download=name;anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function navButton(item,mobile=false) {
  const active=current===item[0] || (mobile&&item[0]==="more"&&!mobileItems.some(x=>x[0]===current));
  return '<button type="button" data-page="'+item[0]+'" class="'+(mobile?"mobile-nav-button ":"side-nav-button ")+(active?"active":"")+'">'+
    (mobile?'<span class="nav-icon-wrap">'+icon(item[2])+'</span><span>'+item[1]+'</span>':icon(item[2])+'<span>'+item[1]+'</span>')+'</button>';
}
function renderNav() {
  $("#sideNav").innerHTML=navItems.map(item=>navButton(item)).join("");
  $("#mobileNav").innerHTML=mobileItems.map(item=>navButton(item,true)).join("");
  document.querySelectorAll("[data-page]").forEach(button=>button.onclick=()=>go(button.dataset.page));
}
function bindPageActions() { document.querySelectorAll("[data-page]").forEach(button=>button.onclick=()=>go(button.dataset.page)); }
function setTitle(title) { $("#pageTitle").textContent=title;$("#todayLabel").textContent=todayLabel(); }
async function go(page) { current=page;selectedRepairId=null;history.replaceState(null,"",page==="home"?"./":"?page="+encodeURIComponent(page));await render();window.scrollTo({top:0,behavior:"smooth"}); }
function sectionHeading(title,subtitle="",action="",page="") {
  return '<div class="section-heading"><div><h2>'+title+'</h2>'+(subtitle?'<p>'+subtitle+'</p>':"")+'</div>'+
    (action?'<button type="button" class="text-link" data-page="'+page+'">'+action+'</button>':"")+'</div>';
}
function statCard(label,value,iconName,note="") {
  return '<article class="stat-card"><div class="stat-head"><span>'+label+'</span><span class="stat-icon">'+icon(iconName)+'</span></div><strong class="stat-value">'+value+'</strong><span class="stat-note">'+note+'</span></article>';
}
function quickAction(page,label,iconName) {
  return '<button class="quick-action" type="button" data-page="'+page+'"><span class="quick-icon">'+icon(iconName)+'</span><b>'+label+'</b></button>';
}
function listRow(title,subtitle,amount,amountNote,iconName="receipt") {
  return '<div class="list-row"><span class="list-avatar">'+icon(iconName)+'</span><div class="list-main"><b>'+safe(title)+'</b><small>'+safe(subtitle||"")+'</small></div><div class="list-value"><b>'+safe(amount||"")+'</b><small>'+safe(amountNote||"")+'</small></div></div>';
}
function recordCard(title,subtitle,value,note,iconName="file-text",action="") {
  return '<article class="record-card" '+(action?'data-record-action="'+safe(action)+'" role="button" tabindex="0"':"")+'><span class="list-avatar">'+icon(iconName)+'</span><div class="record-info"><b>'+safe(title)+'</b><small>'+safe(subtitle||"")+'</small></div><div class="record-end">'+safe(value||"")+'<small>'+safe(note||"")+'</small></div></article>';
}
function emptyState(text) { return '<div class="empty-state">'+safe(text)+'</div>'; }
function pill(text,kind="") { return '<span class="pill '+kind+'">'+safe(text)+'</span>'; }
function normalizePhone(value) { return digits(value).slice(-10); }
function totalBy(rows,field) { return rows.reduce((sum,row)=>sum+Number(row[field]||0),0); }

async function resolveCustomer(name,phone) {
  const cleanPhone=normalizePhone(phone),cleanName=String(name||"").trim();
  const customers=await all("customers");
  if(cleanPhone.length===10) {
    const existing=customers.find(row=>normalizePhone(row.phone)===cleanPhone);
    if(existing) {
      if(cleanName&&cleanName!==existing.name) await put("customers",{...existing,name:cleanName,updatedAt:new Date().toISOString()});
      return existing.id;
    }
  }
  if(!cleanName&&!cleanPhone)return null;
  if(cleanPhone.length>0&&cleanPhone.length!==10)throw new Error("Enter a valid 10-digit customer mobile number.");
  if(!cleanName&&cleanPhone.length===10)throw new Error("Enter the customer's name to save this new contact.");
  const row={id:uid(),name:cleanName,phone:cleanPhone,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  await add("customers",row);return row.id;
}
function customerFields(prefix,requiredName=false) {
  return '<div class="field"><label for="'+prefix+'Phone">Customer phone number</label><input id="'+prefix+'Phone" type="tel" inputmode="numeric" autocomplete="tel" maxlength="10" placeholder="Enter mobile number"><span class="field-hint" id="'+prefix+'Match">Type a number to find an existing customer. New contacts are saved automatically.</span></div>'+
    '<div class="field"><label for="'+prefix+'Name">Customer name '+(requiredName?"":"(optional if already saved)")+'</label><input id="'+prefix+'Name" type="text" autocomplete="name" placeholder="Customer name" '+(requiredName?"required":"")+'></div>';
}
function bindCustomerLookup(prefix) {
  const phone=$("#"+prefix+"Phone"),name=$("#"+prefix+"Name"),message=$("#"+prefix+"Match");
  if(!phone||!name)return;
  phone.oninput=async()=>{
    const value=normalizePhone(phone.value);
    name.dataset.customerId="";
    if(value.length!==10){message.textContent=value.length?"Enter all 10 digits to search.":"Type a number to find an existing customer.";return;}
    const customers=await all("customers");
    const match=customers.find(row=>normalizePhone(row.phone)===value);
    if(match){name.value=match.name||"";name.dataset.customerId=match.id;message.textContent="✓ Existing customer found: "+(match.name||"Saved customer");}
    else{message.textContent="New customer. The contact will be saved with this sale or repair.";}
  };
}
function customerName(phone,customers) {
  const normalized=normalizePhone(phone);
  return customers.find(row=>normalizePhone(row.phone)===normalized)?.name || "";
}

async function renderHome() {
  const [products,customers,sales,repairs,providers,wallets,recharges,expenses,suppliers,supplierLedger]=await Promise.all([
    all("products"),all("customers"),all("sales"),all("repair_jobs"),all("recharge_platforms"),
    all("recharge_wallets"),all("recharge_transactions"),all("expenses"),all("suppliers"),all("supplier_ledger_entries")
  ]);
  const today=todayKey(),daySales=sales.filter(row=>String(row.createdAt||"").slice(0,10)===today);
  const dayRecharges=recharges.filter(row=>String(row.createdAt||"").slice(0,10)===today);
  const salesTotal=totalBy(daySales,"totalPaise"),commission=totalBy(dayRecharges,"commissionPaise");
  const walletTotal=totalBy(wallets,"balancePaise");
  const openRepairs=repairs.filter(row=>!["completed","rejected","delivered","cancelled"].includes(row.status));
  const lowStock=products.filter(row=>row.minStock!=null&&Number(row.qty||0)<=Number(row.minStock||0));
  const dayExpense=expenses.filter(row=>String(row.createdAt||"").slice(0,10)===todayKey()).reduce((sum,row)=>sum+Number(row.amountPaise||0),0);
  const supplierDue=suppliers.reduce((sum,supplier)=>sum+Math.max(0,supplierLedger.filter(row=>row.supplierId===supplier.id).reduce((v,row)=>v+Number(row.balanceDeltaPaise||0),0)),0);
  const latest=dayRecharges.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,4);
  let html='<section class="welcome"><h2>Your shop, in control.</h2><p>Fast access to the work you do every day. Products flow from purchases to stock to sales.</p><span class="welcome-meta">'+icon("wifi-off")+' Offline-ready · '+todayLabel()+'</span></section>';
  html+='<div class="stats-grid">'+statCard("Sales today",money(salesTotal),"shopping-bag",daySales.length+" invoices")+statCard("Recharge commission",money(commission),"smartphone",dayRecharges.length+" recharges")+statCard("Recharge wallets",money(walletTotal),"wallet",providers.length+" configured providers")+statCard("Supplier outstanding",money(supplierDue),"truck","Includes distributor wallet credits")+'</div>';
  html+=sectionHeading("Quick actions","Common tasks are one tap away");
  html+='<div class="quick-grid">'+quickAction("sales","New sale","shopping-cart")+quickAction("recharge","Recharge","smartphone")+quickAction("repairs","New repair","wrench")+quickAction("purchases","Add purchase","package-plus")+quickAction("expenses","Add expense","receipt")+quickAction("inventory","Add product","package")+'</div>';
  html+='<div class="content-grid"><div class="stack">'+sectionHeading("Recent recharges","Today’s provider transactions","View all","recharge")+'<div class="card">'+(latest.length?'<div class="list-stack">'+latest.map(row=>listRow(row.providerName||"Recharge",(row.serviceType||"service").toUpperCase()+(row.recipient?" · "+row.recipient:""),money(row.amountPaise),money(row.commissionPaise)+" commission","smartphone")).join("")+'</div>':emptyState("Your recent recharge activity will appear here."))+'</div></div>';
  html+='<div class="stack">'+sectionHeading("Shop alerts","Items and jobs that need attention")+'<div class="card"><div class="wallet-mini-grid"><div class="wallet-mini"><small>Products</small><strong>'+products.length+'</strong></div><div class="wallet-mini"><small>Customers</small><strong>'+customers.length+'</strong></div><div class="wallet-mini"><small>Low stock</small><strong>'+lowStock.length+'</strong></div><div class="wallet-mini"><small>Open repairs</small><strong>'+openRepairs.length+'</strong></div></div><div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">'+(lowStock.length?pill(lowStock.length+" low-stock items","warning"):"")+ (dayExpense?pill("Expenses today "+money(dayExpense)):"")+ "</div></div></div></div>";
  return html;
}

/* ---------------- PRODUCTS / INVENTORY ---------------- */
async function renderInventory() {
  setTitle("Products & inventory");
  const [products,suppliers]=await Promise.all([all("products"),all("suppliers")]);
  const low=products.filter(row=>row.minStock!=null&&Number(row.qty||0)<=Number(row.minStock||0));
  const sorted=products.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  let html='<div class="page-intro"><div><h2>Products & inventory</h2><p>One product catalogue for purchases, POS sales and repair components.</p></div><button class="btn btn-primary" id="addProduct">'+icon("plus")+'<span class="desktop-only">Add product</span></button></div>';
  html+='<div class="stats-grid">'+statCard("Total products",String(products.length),"package","All categories")+statCard("Low stock",String(low.length),"alert-triangle",low.length?"Needs reorder":"Stock levels look good")+statCard("Units in stock",String(products.reduce((sum,row)=>sum+Number(row.qty||0),0)),"boxes","Across all products")+statCard("Stock cost value",money(products.reduce((sum,row)=>sum+Number(row.qty||0)*Number(row.costPaise||0),0)),"indian-rupee","Estimated purchase value")+'</div>';
  html+=sectionHeading("Low-stock items","Select products and quantities to send a WhatsApp reorder request","Request stock","reorder");
  if(low.length) html+='<div class="card"><div class="record-list">'+low.slice(0,8).map(row=>recordCard(row.name,(row.category||"General")+" · Minimum "+Number(row.minStock||0),String(row.qty||0)+" left","Reorder needed","alert-triangle")).join("")+'</div><button type="button" class="btn btn-secondary btn-block" style="margin-top:12px" id="reorderBtn">'+icon("message-circle")+' Prepare WhatsApp order</button></div>';
  else html+='<div class="card">'+emptyState("No low-stock products. Set a minimum stock quantity when adding products to activate alerts.")+'</div>';
  html+=sectionHeading("Product catalogue","Search, edit and track stock");
  html+='<div class="search-wrap">'+icon("search")+'<input id="productSearch" type="search" placeholder="Search name, category, SKU or model"></div><div class="record-list" id="productList">'+(sorted.length?sorted.map(productCard).join(""):emptyState("No products yet. Add your first product, then use it in purchases and POS sales."))+'</div>';
  $("#view").innerHTML=html;
  $("#addProduct").onclick=()=>openProductEditor();
  if($("#reorderBtn"))$("#reorderBtn").onclick=()=>openReorderModal(low,suppliers);
  $("#productSearch").oninput=event=>{
    const q=event.target.value.toLowerCase();
    const rows=sorted.filter(row=>JSON.stringify(row).toLowerCase().includes(q));
    $("#productList").innerHTML=rows.length?rows.map(productCard).join(""):emptyState("No matching products.");
    bindProductCards();
  };
  bindProductCards();bindPageActions();refreshIcons();
}
function productCard(product) {
  const low=product.minStock!=null&&Number(product.qty||0)<=Number(product.minStock||0);
  const type=productTypes.find(row=>row[0]===product.productType)?.[1]||product.category||"Product";
  return '<article class="record-card"><span class="list-avatar">'+icon(product.productType==="phone"?"smartphone":product.productType==="spare_part"||product.productType==="consumable"?"cpu":"package")+'</span><div class="record-info"><b>'+safe(product.name)+'</b><small>'+safe(type)+' · '+safe(product.sku||product.model||"No SKU")+'</small></div><div class="record-end">'+money(product.pricePaise)+'<small>'+Number(product.qty||0)+' in stock '+(low?'· LOW':'')+'</small></div><button class="icon-btn" type="button" data-edit-product="'+safe(product.id)+'" aria-label="Edit product">'+icon("pencil")+'</button></article>';
}
function bindProductCards() {document.querySelectorAll("[data-edit-product]").forEach(button=>button.onclick=()=>openProductEditorById(button.dataset.editProduct));}
async function openProductEditorById(id) {const products=await all("products");openProductEditor(products.find(row=>row.id===id));}
function openProductEditor(product=null) {
  const p=product||{productType:"accessory",qty:0,minStock:2,repairMarginType:"fixed",repairMarginValue:0};
  const types=productTypes.map(row=>'<option value="'+row[0]+'">'+row[1]+'</option>').join("");
  const body='<div class="form-grid two"><div class="field"><label>Product type</label><select id="pType">'+types+'</select></div><div class="field"><label>Category</label><input id="pCategory" value="'+safe(p.category||"General")+'" placeholder="e.g. Chargers"></div></div>'+
    '<div class="field"><label>Product name *</label><input id="pName" value="'+safe(p.name||"")+'" placeholder="e.g. 25W fast charger" required></div>'+
    '<div class="form-grid two"><div class="field"><label>Brand</label><input id="pBrand" value="'+safe(p.brand||"")+'" placeholder="Brand"></div><div class="field"><label>Model / variant</label><input id="pModel" value="'+safe(p.model||"")+'" placeholder="Model"></div></div>'+
    '<div class="form-grid two"><div class="field"><label>SKU / barcode</label><input id="pSku" value="'+safe(p.sku||"")+'" placeholder="Optional code"></div><div class="field"><label>Unit</label><select id="pUnit"><option>Piece</option><option>Set</option><option>Box</option><option>Meter</option></select></div></div>'+
    '<div class="form-grid two"><div class="field"><label>Purchase cost (₹)</label><input id="pCost" type="number" min="0" step="0.01" value="'+(Number(p.costPaise||0)/100)+'"></div><div class="field"><label>Selling price (₹)</label><input id="pPrice" type="number" min="0" step="0.01" value="'+(Number(p.pricePaise||0)/100)+'"></div></div>'+
    '<div class="form-grid two"><div class="field"><label>Current stock</label><input id="pQty" type="number" min="0" step="1" value="'+Number(p.qty||0)+'"></div><div class="field"><label>Low-stock warning at</label><input id="pMin" type="number" min="0" step="1" value="'+Number(p.minStock??2)+'"></div></div>'+
    '<div class="section-heading"><h2>Repair part pricing</h2></div><p class="inline-note">Used when this product is added as a component in a repair job. You can adjust the customer price on each repair.</p>'+
    '<div class="form-grid two"><div class="field"><label>Default markup type</label><select id="pMarginType"><option value="fixed">Fixed margin (₹)</option><option value="percentage">Percentage markup</option></select></div><div class="field"><label>Default markup value</label><input id="pMarginValue" type="number" min="0" step="0.01" value="'+Number(p.repairMarginValue||0)+'"></div></div>';
  showModal(product?"Edit product":"Add product",body,async()=>{
    const name=$("#pName").value.trim();if(!name)throw Error("Product name is required.");
    await saveProduct({
      id:product?.id,name,productType:$("#pType").value,category:$("#pCategory").value.trim()||"General",
      brand:$("#pBrand").value.trim(),model:$("#pModel").value.trim(),sku:$("#pSku").value.trim(),unit:$("#pUnit").value,
      costPaise:toPaise($("#pCost").value),pricePaise:toPaise($("#pPrice").value),
      qty:Number($("#pQty").value||0),minStock:Number($("#pMin").value||0),
      repairMarginType:$("#pMarginType").value,repairMarginValue:Number($("#pMarginValue").value||0)
    });
    closeModal();toast(product?"Product updated.":"Product added to inventory.");await renderInventory();
  },"PRODUCT CATALOGUE");
  $("#pType").value=p.productType||"accessory";$("#pUnit").value=p.unit||"Piece";$("#pMarginType").value=p.repairMarginType||"fixed";
}
async function openReorderModal(low,suppliers) {
  const validSuppliers=suppliers.filter(row=>row.supplierType!=="recharge_distributor");
  const body='<div class="field"><label>Supplier to contact</label><select id="reorderSupplier">'+validSuppliers.map(s=>'<option value="'+safe(s.id)+'">'+safe(s.name)+'</option>').join("")+'</select></div>'+
    '<p class="inline-note">Select the products and enter how many units you need. The list and quantities will be sent in a WhatsApp message.</p>'+
    '<div class="record-list">'+low.map((p,i)=>'<label class="record-card"><input type="checkbox" class="reorder-check" data-index="'+i+'" checked><span class="record-info"><b>'+safe(p.name)+'</b><small>Current stock: '+Number(p.qty||0)+' · Minimum: '+Number(p.minStock||0)+'</small></span><input aria-label="Quantity" class="reorder-qty" data-index="'+i+'" type="number" min="1" value="'+Math.max(1,Number(p.minStock||0)-Number(p.qty||0))+'" style="width:68px;min-height:38px;border:1px solid var(--line);border-radius:9px;padding:6px"></label>').join("")+'</div>';
  showModal("Request low-stock items",body,async()=>{
    const supplier=validSuppliers.find(row=>row.id===$("#reorderSupplier").value);
    const selected=low.filter((p,i)=>$(".reorder-check[data-index='"+i+"']").checked).map((p,i)=>{
      const originalIndex=low.indexOf(p);return {productId:p.id,productName:p.name,quantity:Number($(".reorder-qty[data-index='"+originalIndex+"']").value||0)};
    }).filter(row=>row.quantity>0);
    if(!selected.length)throw Error("Select at least one product and quantity.");
    const textLines=["Hello "+(supplier?.name||"")+", please supply these items:",...selected.map(row=>row.productName+" - "+row.quantity+" pcs"),"Thank you."];
    let phone=digits(supplier?.phone||"");
    if(phone.length===10)phone="91"+phone;
    const waUrl=phone?"https://wa.me/"+phone+"?text="+encodeURIComponent(textLines.join("\n")):null;
    if(waUrl)window.open(waUrl,"_blank","noopener,noreferrer");
    await add("reorder_requests",{id:uid(),supplierId:supplier?.id||null,items:selected,status:"sent_to_whatsapp",createdAt:new Date().toISOString()});
    closeModal();toast(waUrl?"WhatsApp order prepared.":"Request saved. Add supplier phone to send WhatsApp.");await renderInventory();
  },"REORDER");
}

/* ---------------- CUSTOMERS ---------------- */
async function renderCustomers() {
  setTitle("Customers");
  const [customers,ledger]=await Promise.all([all("customers"),all("customer_ledger_entries")]);
  const rows=customers.map(customer=>{
    const balance=ledger.filter(entry=>entry.customerId===customer.id).reduce((sum,entry)=>sum+Number(entry.balanceDeltaPaise||0),0);
    return {...customer,balancePaise:balance};
  }).sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  let html='<div class="page-intro"><div><h2>Customers</h2><p>Sales, repairs and recharges can use the same saved customer contact.</p></div><button class="btn btn-primary" id="addCustomer">'+icon("user-plus")+'<span class="desktop-only">Add customer</span></button></div>';
  html+='<div class="search-wrap">'+icon("search")+'<input id="customerSearch" type="search" placeholder="Search customer name or phone"></div><div class="record-list" id="customerList">'+(rows.length?rows.map(customer=>'<article class="record-card"><span class="list-avatar">'+icon("user-round")+'</span><div class="record-info"><b>'+safe(customer.name)+'</b><small>'+safe(customer.phone||"No phone")+'</small></div><div class="record-end">'+money(customer.balancePaise)+'<small>Outstanding</small></div>'+(customer.phone?'<a class="icon-btn" href="tel:'+safe(customer.phone)+'" aria-label="Call customer">'+icon("phone")+'</a>':"")+(customer.balancePaise>0?'<button class="btn btn-secondary btn-sm" type="button" data-customer-pay="'+safe(customer.id)+'">Collect</button>':"")+'<button class="icon-btn" type="button" data-customer-edit="'+safe(customer.id)+'" aria-label="Edit customer">'+icon("pencil")+'</button></article>').join(""):emptyState("No customers yet. They can also be created automatically from sales and repairs."))+'</div>';
  $("#view").innerHTML=html;
  $("#addCustomer").onclick=()=>openCustomerEditor();
  $("#customerSearch").oninput=event=>{const q=event.target.value.toLowerCase();const filtered=rows.filter(row=>(row.name+" "+row.phone).toLowerCase().includes(q));$("#customerList").innerHTML=filtered.map(customer=>'<article class="record-card"><span class="list-avatar">'+icon("user-round")+'</span><div class="record-info"><b>'+safe(customer.name)+'</b><small>'+safe(customer.phone||"No phone")+'</small></div><div class="record-end">'+money(customer.balancePaise)+'<small>Outstanding</small></div>'+(customer.phone?'<a class="icon-btn" href="tel:'+safe(customer.phone)+'">'+icon("phone")+'</a>':"")+(customer.balancePaise>0?'<button class="btn btn-secondary btn-sm" data-customer-pay="'+safe(customer.id)+'">Collect</button>':"")+'<button class="icon-btn" data-customer-edit="'+safe(customer.id)+'">'+icon("pencil")+'</button></article>').join("")||emptyState("No matching customers.");bindCustomerEdit();bindCustomerPayments();refreshIcons();};
  bindCustomerEdit();bindCustomerPayments();refreshIcons();
}
function bindCustomerEdit(){document.querySelectorAll("[data-customer-edit]").forEach(button=>button.onclick=async()=>{const row=(await all("customers")).find(item=>item.id===button.dataset.customerEdit);openCustomerEditor(row);});}
async function bindCustomerPayments(){
  document.querySelectorAll("[data-customer-pay]").forEach(button=>button.onclick=async()=>{
    const [customer,ledger]=await Promise.all([all("customers"),all("customer_ledger_entries")]);
    const row=customer.find(item=>item.id===button.dataset.customerPay);
    if(!row)return;
    const balance=ledger.filter(entry=>entry.customerId===row.id).reduce((sum,entry)=>sum+Number(entry.balanceDeltaPaise||0),0);
    openCustomerPayment(row,balance);
  });
}
function openCustomerPayment(customer,balance){
  const body='<p class="inline-note">Outstanding balance for <b>'+safe(customer.name)+'</b>: '+money(balance)+'</p><div class="field"><label>Amount received (₹)</label><input id="customerPayAmount" type="number" min="0.01" max="'+(balance/100)+'" step="0.01" value="'+(balance/100).toFixed(2)+'"></div><div class="field"><label>Payment method</label><select id="customerPayMethod"><option>Cash</option><option>UPI</option><option>Bank</option><option>Card</option></select></div>';
  showModal("Customer payment",body,async()=>{
    const amount=toPaise($("#customerPayAmount").value);
    if(amount<=0||amount>balance)throw Error("Payment must be within the customer outstanding balance.");
    await recordCustomerPayment({customerId:customer.id,amountPaise:amount,paymentMethod:$("#customerPayMethod").value});
    closeModal();toast("Customer payment received.");await renderCustomers();
  },"CUSTOMER COLLECTION");
}
function openCustomerEditor(customer=null) {
  const body='<div class="field"><label>Customer name *</label><input id="custName" value="'+safe(customer?.name||"")+'" required></div><div class="field"><label>Mobile number</label><input id="custPhone" type="tel" inputmode="numeric" maxlength="10" value="'+safe(customer?.phone||"")+'"></div><div class="field"><label>Address / place</label><textarea id="custAddress">'+safe(customer?.address||"")+'</textarea></div>';
  showModal(customer?"Edit customer":"Add customer",body,async()=>{
    const name=$("#custName").value.trim(),phone=normalizePhone($("#custPhone").value);
    if(!name)throw Error("Enter customer name.");if(phone&&phone.length!==10)throw Error("Mobile number must have 10 digits.");
    const row={...(customer||{}),id:customer?.id||uid(),name,phone,address:$("#custAddress").value.trim(),updatedAt:new Date().toISOString(),createdAt:customer?.createdAt||new Date().toISOString()};
    await put("customers",row);closeModal();toast("Customer saved.");await renderCustomers();
  },"CUSTOMER");
}

/* ---------------- SALES / POS ---------------- */
async function renderSales() {
  setTitle("Sales & POS");
  const sales=await all("sales"),customers=await all("customers");
  let html='<div class="page-intro"><div><h2>Sales & POS</h2><p>Sell from your product catalogue. Stock reduces automatically after checkout.</p></div><button class="btn btn-primary" id="newSale">'+icon("plus")+'<span class="desktop-only">New sale</span></button></div>';
  html+='<div class="stats-grid">'+statCard("Invoices",String(sales.length),"receipt","Saved sales")+statCard("Sales total",money(totalBy(sales,"totalPaise")),"indian-rupee","Recorded invoice totals")+statCard("Customer due",money(totalBy(sales,"duePaise")),"clock","Outstanding across sales")+statCard("Paid",money(totalBy(sales,"paidPaise")),"check-circle","Payments recorded")+'</div>';
  html+=sectionHeading("Recent sales","Product-based checkout history");
  html+='<div class="record-list">'+(sales.length?sales.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,40).map(row=>{
    const customer=customers.find(c=>c.id===row.customerId);
    return recordCard(customer?.name||"Walk-in customer",new Date(row.createdAt).toLocaleString("en-IN")+" · "+(row.status||"saved"),money(row.totalPaise),row.duePaise?money(row.duePaise)+" due":"Paid","shopping-bag");
  }).join(""):emptyState("No sales yet. Start a new sale to select products from inventory."))+'</div>';
  $("#view").innerHTML=html;$("#newSale").onclick=openSaleModal;refreshIcons();
}
let cartProducts=[];
function cartRow(index,products,item={}) {
  return '<div class="cart-row" data-cart-row="'+index+'" style="display:grid;grid-template-columns:minmax(0,1fr) 76px;gap:8px;align-items:end;margin-bottom:10px">'+
    '<div class="field" style="margin:0"><label>Product</label><select data-cart-product="'+index+'"><option value="">Select product…</option>'+products.map(p=>'<option value="'+safe(p.id)+'">'+safe(p.name)+' · '+Number(p.qty||0)+' in stock</option>').join("")+'</select></div>'+
    '<div class="field" style="margin:0"><label>Qty</label><input data-cart-qty="'+index+'" type="number" min="1" step="1" inputmode="numeric" value="'+(item.quantity||1)+'"></div>'+
    '<div class="field" style="margin:0"><label>Selling price (₹)</label><input data-cart-price="'+index+'" type="number" min="0" step="0.01" inputmode="decimal" value="'+(item.unitPricePaise!=null?item.unitPricePaise/100:"")+'" placeholder="0.00"></div>'+
    '<button class="btn btn-quiet btn-sm" type="button" data-cart-remove="'+index+'">'+icon("trash-2")+' Remove</button></div>';
}
async function openSaleModal() {
  cartProducts=await all("products");saleCart=[{productId:"",quantity:1,unitPricePaise:0}];
  if(!cartProducts.length){toast("Add products to inventory before creating a sale.");return;}
  const body='<div class="form-grid two">'+customerFields("sale",false)+'</div>'+
    '<div class="section-heading"><h2>Products</h2><span class="tiny">Choose from inventory</span></div><div id="cartRows"></div><button class="btn btn-secondary btn-sm" type="button" id="addCartLine">'+icon("plus")+' Add another product</button>'+
    '<div class="recharge-summary" style="margin-top:15px"><div class="summary-line"><span>Invoice total</span><strong id="saleTotal">₹0.00</strong></div></div>'+
    '<div class="form-grid two"><div class="field"><label>Amount received (₹)</label><input id="salePaid" type="number" min="0" step="0.01" inputmode="decimal" value="0"></div><div class="field"><label>Payment method</label><select id="saleMethod"><option>Cash</option><option>UPI</option><option>Bank</option><option>Card</option><option>Credit</option></select></div></div>'+
    '<p class="inline-note" id="saleDueHint">Any unpaid balance will be added to the selected customer ledger.</p>';
  showModal("New sale",body,async()=>{
    const items=saleCart.filter(row=>row.productId&&row.quantity>0);
    if(!items.length)throw Error("Add at least one product.");
    const merged=new Map();
    for(const row of items){const key=row.productId;if(merged.has(key)){const old=merged.get(key);if(old.unitPricePaise!==row.unitPricePaise)throw Error("A product appears twice with different prices. Keep one line per product.");old.quantity+=Number(row.quantity);}else merged.set(key,{...row,quantity:Number(row.quantity)});}
    const lines=[...merged.values()];
    const total=lines.reduce((sum,row)=>sum+row.quantity*row.unitPricePaise,0);
    const paid=toPaise($("#salePaid").value);
    if(paid>total)throw Error("Received amount cannot exceed the invoice total.");
    const name=$("#saleName").value.trim(),phone=$("#salePhone").value.trim();
    let customerId=await resolveCustomer(name,phone);
    if(total>paid&&!customerId)throw Error("Select or create a customer for a credit sale.");
    await recordSale({customerId,items:lines,paidPaise:paid,paymentMethod:$("#saleMethod").value});
    closeModal();toast("Sale saved. Inventory updated.");await renderSales();
  },"POINT OF SALE","Complete sale");
  bindCustomerLookup("sale");
  const draw=()=>{
    $("#cartRows").innerHTML=saleCart.map((row,i)=>cartRow(i,cartProducts,row)).join("");
    saleCart.forEach((row,i)=>{
      const select=$("[data-cart-product='"+i+"']");
      select.value=row.productId||"";
      select.onchange=()=>{
        const product=cartProducts.find(p=>p.id===select.value);saleCart[i].productId=select.value;saleCart[i].unitPricePaise=Number(product?.pricePaise||0);draw();
      };
      $("[data-cart-qty='"+i+"']").oninput=e=>{saleCart[i].quantity=Number(e.target.value||0);updateTotal();};
      $("[data-cart-price='"+i+"']").oninput=e=>{saleCart[i].unitPricePaise=toPaise(e.target.value);updateTotal();};
      $("[data-cart-remove='"+i+"']").onclick=()=>{saleCart.splice(i,1);if(!saleCart.length)saleCart.push({productId:"",quantity:1,unitPricePaise:0});draw();};
    });
    updateTotal();refreshIcons();
  };
  const updateTotal=()=>{
    const total=saleCart.reduce((sum,row)=>sum+Number(row.quantity||0)*Number(row.unitPricePaise||0),0);
    $("#saleTotal").textContent=money(total);
    const paid=$("#salePaid");if(paid&&!paid.dataset.touched)paid.value=(total/100).toFixed(2);
    $("#saleDueHint").textContent=total>toPaise(paid?.value||0)?"Balance due: "+money(total-toPaise(paid?.value||0))+". A customer is required for credit sales.":"Fully paid.";
  };
  $("#addCartLine").onclick=()=>{saleCart.push({productId:"",quantity:1,unitPricePaise:0});draw();};
  $("#salePaid").oninput=()=>{$("#salePaid").dataset.touched="1";updateTotal();};
  draw();
}

/* ---------------- PURCHASES / STOCK IN ---------------- */
async function renderPurchases() {
  setTitle("Purchases");
  const [purchases,suppliers,products]=await Promise.all([all("purchases"),all("suppliers"),all("products")]);
  const paid=totalBy(purchases,"paidPaise"),due=totalBy(purchases,"duePaise");
  let html='<div class="page-intro"><div><h2>Purchases</h2><p>Receive goods into inventory from line suppliers or direct market purchases.</p></div><button class="btn btn-primary" id="newPurchase">'+icon("plus")+'<span class="desktop-only">New purchase</span></button></div>';
  html+='<div class="stats-grid">'+statCard("Purchase bills",String(purchases.length),"file-text","Recorded invoices")+statCard("Purchase total",money(totalBy(purchases,"totalPaise")),"package","Stock received value")+statCard("Paid",money(paid),"check-circle","Supplier payments")+statCard("Outstanding",money(due),"clock","Pay now or later")+'</div>';
  html+=sectionHeading("Purchase history","Each purchase updates product stock and supplier balance");
  html+='<div class="record-list">'+(purchases.length?purchases.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(row=>{
    const supplier=suppliers.find(s=>s.id===row.supplierId);
    return '<article class="record-card"><span class="list-avatar">'+icon("truck")+'</span><div class="record-info"><b>'+safe(supplier?.name||"Direct purchase")+'</b><small>'+safe(row.invoiceNumber||"No invoice")+" · "+safe(row.purchaseType==="line_supply"?"Line supply":"Direct market")+'</small><small>'+new Date(row.createdAt).toLocaleDateString("en-IN")+' · '+pill(row.status||"unpaid",row.status==="paid"?"": "warning")+'</small></div><div class="record-end">'+money(row.totalPaise)+'<small>'+money(row.duePaise)+' due</small></div>'+(Number(row.duePaise||0)>0?'<button class="btn btn-secondary btn-sm" data-pay-purchase="'+safe(row.id)+'">Pay</button>':"")+'</article>';
  }).join(""):emptyState("No purchases yet. Create products first, then receive stock here."))+'</div>';
  $("#view").innerHTML=html;$("#newPurchase").onclick=openPurchaseModal;
  document.querySelectorAll("[data-pay-purchase]").forEach(button=>button.onclick=()=>openPurchasePayment(button.dataset.payPurchase));
  refreshIcons();
}
function purchaseCartRow(index,products,item={}) {
  return '<div class="cart-row" style="display:grid;grid-template-columns:minmax(0,1fr) 75px;gap:8px;align-items:end;margin-bottom:10px">'+
    '<div class="field" style="margin:0"><label>Product</label><select data-buy-product="'+index+'"><option value="">Select product…</option>'+products.map(p=>'<option value="'+safe(p.id)+'">'+safe(p.name)+'</option>').join("")+'</select></div>'+
    '<div class="field" style="margin:0"><label>Qty</label><input data-buy-qty="'+index+'" type="number" min="1" value="'+(item.quantity||1)+'"></div>'+
    '<div class="field" style="margin:0"><label>Purchase cost / unit (₹)</label><input data-buy-cost="'+index+'" type="number" min="0" step="0.01" value="'+(item.unitCostPaise!=null?item.unitCostPaise/100:"")+'"></div>'+
    '<button class="btn btn-quiet btn-sm" type="button" data-buy-remove="'+index+'">'+icon("trash-2")+' Remove</button></div>';
}
async function openPurchaseModal() {
  const [products,suppliers]=await Promise.all([all("products"),all("suppliers")]);
  if(!products.length){toast("Create products before receiving purchases.");return;}
  purchaseCart=[{productId:"",quantity:1,unitCostPaise:0}];
  const body='<div class="field"><label>Purchase supplier</label><select id="buySupplier"><option value="">Select supplier / direct cash purchase</option>'+suppliers.map(s=>'<option value="'+safe(s.id)+'">'+safe(s.name)+' · '+safe(supplierTypeLabel(s.supplierType))+'</option>').join("")+'</select></div>'+
    '<div class="form-grid two"><div class="field"><label>Purchase type</label><select id="buyType"><option value="line_supply">Line supply / credit</option><option value="direct_market">Direct market purchase</option></select></div><div class="field"><label>Supplier invoice number</label><input id="buyInvoice" placeholder="Optional invoice no."></div></div>'+
    '<div class="section-heading"><h2>Items supplied</h2><span class="tiny">Stock increases on save</span></div><div id="buyRows"></div><button id="addBuyLine" type="button" class="btn btn-secondary btn-sm">'+icon("plus")+' Add product line</button>'+
    '<div class="recharge-summary" style="margin-top:14px"><div class="summary-line"><span>Purchase total</span><strong id="buyTotal">₹0.00</strong></div></div>'+
    '<div class="form-grid two"><div class="field"><label>Paid now (₹)</label><input id="buyPaid" type="number" min="0" step="0.01" value="0"></div><div class="field"><label>Payment method</label><select id="buyMethod"><option>Cash</option><option>UPI</option><option>Bank</option><option>Card</option></select></div></div>'+
    '<p class="inline-note">You can pay partially now and settle the outstanding amount later. Mark an invoice fully paid from Purchase history.</p>';
  showModal("Receive purchase",body,async()=>{
    const items=purchaseCart.filter(row=>row.productId&&row.quantity>0);
    if(!items.length)throw Error("Add at least one product supplied.");
    const supplierId=$("#buySupplier").value||null;
    if($("#buyType").value==="line_supply"&&!supplierId)throw Error("Select the line supplier.");
    const total=items.reduce((sum,row)=>sum+Number(row.quantity||0)*Number(row.unitCostPaise||0),0);
    const paid=toPaise($("#buyPaid").value);
    if(paid>total)throw Error("Paid amount cannot exceed purchase total.");
    const grouped=new Map();
    for(const row of items){if(grouped.has(row.productId)){const previous=grouped.get(row.productId);if(previous.unitCostPaise!==row.unitCostPaise)throw Error("A product appears twice with different purchase costs. Use one line per product.");previous.quantity+=Number(row.quantity);}else grouped.set(row.productId,{...row,quantity:Number(row.quantity)});}
    await recordPurchase({supplierId,purchaseType:$("#buyType").value,invoiceNumber:$("#buyInvoice").value.trim(),items:[...grouped.values()],payments:paid?[{amountPaise:paid,paymentMethod:$("#buyMethod").value}]:[]});
    closeModal();toast("Purchase saved. Stock quantities increased.");await renderPurchases();
  },"PURCHASE RECEIVING","Save purchase");
  const draw=()=>{
    $("#buyRows").innerHTML=purchaseCart.map((row,i)=>purchaseCartRow(i,products,row)).join("");
    purchaseCart.forEach((row,i)=>{
      const select=$("[data-buy-product='"+i+"']");select.value=row.productId||"";
      select.onchange=()=>{const p=products.find(x=>x.id===select.value);purchaseCart[i].productId=select.value;purchaseCart[i].unitCostPaise=Number(p?.costPaise||0);draw();};
      $("[data-buy-qty='"+i+"']").oninput=e=>{purchaseCart[i].quantity=Number(e.target.value||0);updateTotal();};
      $("[data-buy-cost='"+i+"']").oninput=e=>{purchaseCart[i].unitCostPaise=toPaise(e.target.value);updateTotal();};
      $("[data-buy-remove='"+i+"']").onclick=()=>{purchaseCart.splice(i,1);if(!purchaseCart.length)purchaseCart.push({productId:"",quantity:1,unitCostPaise:0});draw();};
    });updateTotal();refreshIcons();
  };
  const updateTotal=()=>{$("#buyTotal").textContent=money(purchaseCart.reduce((sum,row)=>sum+Number(row.quantity||0)*Number(row.unitCostPaise||0),0));};
  $("#addBuyLine").onclick=()=>{purchaseCart.push({productId:"",quantity:1,unitCostPaise:0});draw();};draw();
}
async function openPurchasePayment(purchaseId) {
  const purchase=(await all("purchases")).find(row=>row.id===purchaseId);if(!purchase)return;
  if(!purchase.duePaise){toast("This purchase is already fully paid.");return;}
  const supplier=(await all("suppliers")).find(row=>row.id===purchase.supplierId);
  const agents=await supplierAgents(supplier?.id);
  const body='<p class="inline-note">Outstanding amount: <b>'+money(purchase.duePaise)+'</b>. You can enter a partial amount or settle the full invoice.</p>'+
    '<div class="field"><label>Payment amount (₹)</label><input id="purchasePayAmount" type="number" min="0.01" max="'+(purchase.duePaise/100)+'" step="0.01" value="'+(purchase.duePaise/100)+'"></div>'+
    '<div class="field"><label>Payment method</label><select id="purchasePayMethod"><option>Cash</option><option>UPI</option><option>Bank</option><option>Card</option></select></div>'+
    (agents.length?'<div class="field"><label>Collected by agent (optional)</label><select id="purchasePayAgent"><option value="">Direct payment / no agent</option>'+agents.map(agent=>'<option value="'+safe(agent.id)+'">'+safe(agent.name)+'</option>').join("")+'</select></div>':"")+
    '<button class="btn btn-secondary btn-block" type="button" id="markPurchasePaid">'+icon("check-check")+' Mark fully paid</button>';
  showModal("Purchase payment",body,async()=>{
    const amount=toPaise($("#purchasePayAmount").value);if(amount<=0||amount>purchase.duePaise)throw Error("Enter an amount up to the outstanding balance.");
    await recordPurchasePayment({purchaseId,supplierId:purchase.supplierId,amountPaise:amount,paymentMethod:$("#purchasePayMethod").value,agentId:$("#purchasePayAgent")?.value||null});
    closeModal();toast("Purchase payment saved.");await renderPurchases();
  },"SUPPLIER SETTLEMENT","Record payment");
  $("#markPurchasePaid").onclick=()=>{$("#purchasePayAmount").value=(purchase.duePaise/100).toFixed(2);$("#modalSave").click();};
}

/* ---------------- SUPPLIERS / AGENTS / COLLECTIONS ---------------- */
function supplierTypeLabel(type) {
  return ({direct_purchase:"Direct purchase supplier",line_supply:"Line supply supplier",recharge_distributor:"Recharge distributor"})[type]||"Supplier";
}
async function supplierAgents(supplierId) {
  if(!supplierId)return [];
  const [links,agents]=await Promise.all([all("supplier_agent_links"),all("collection_agents")]);
  const ids=links.filter(row=>row.supplierId===supplierId).map(row=>row.agentId);
  return agents.filter(row=>ids.includes(row.id));
}
async function supplierBalance(supplierId) {
  const ledger=await all("supplier_ledger_entries");
  return ledger.filter(row=>row.supplierId===supplierId).reduce((sum,row)=>sum+Number(row.balanceDeltaPaise||0),0);
}
async function renderSuppliers() {
  setTitle("Suppliers");
  const [suppliers,agents,ledger,links]=await Promise.all([all("suppliers"),all("collection_agents"),all("supplier_ledger_entries"),all("supplier_agent_links")]);
  let html='<div class="page-intro"><div><h2>Suppliers</h2><p>Direct purchase, line supply and recharge distributors have different collection workflows.</p></div><button class="btn btn-primary" id="addSupplier">'+icon("plus")+'<span class="desktop-only">Add supplier</span></button></div>';
  html+='<div class="settings-grid">'+suppliers.map(supplier=>{
    const due=ledger.filter(row=>row.supplierId===supplier.id).reduce((sum,row)=>sum+Number(row.balanceDeltaPaise||0),0);
    const linked=agents.filter(agent=>links.some(link=>link.supplierId===supplier.id&&link.agentId===agent.id));
    return '<article class="card provider-card"><div class="provider-top"><span class="provider-logo">'+icon(supplier.supplierType==="recharge_distributor"?"radio-tower":supplier.supplierType==="line_supply"?"truck":"store")+'</span><div class="provider-info"><h3>'+safe(supplier.name)+'</h3><p>'+safe(supplierTypeLabel(supplier.supplierType))+'</p></div></div><div class="provider-balance">'+money(due)+'</div><div class="provider-meta">'+safe(supplier.phone||"No contact number")+'<br>'+safe(supplier.address||"Address not added")+'<br>'+(supplier.supplierType==="direct_purchase"?"No":linked.length)+' collection agent links</div><div class="provider-actions"><button class="btn btn-secondary btn-sm" data-supplier-edit="'+safe(supplier.id)+'">'+icon("pencil")+' Edit</button><button class="btn btn-quiet btn-sm" data-supplier-pay="'+safe(supplier.id)+'">'+icon("wallet")+' Collect / pay</button></div></article>';
  }).join("")+'</div>';
  if(!suppliers.length)html+='<div class="card provider-empty"><span class="empty-icon">'+icon("store")+'</span><h3>No suppliers yet</h3><p>Add suppliers so line purchases, recharge distributor credits and collection agents stay connected.</p><button class="btn btn-primary" id="addSupplierEmpty">'+icon("plus")+' Add supplier</button></div>';
  $("#view").innerHTML=html;
  const addButton=$("#addSupplier")||$("#addSupplierEmpty");if(addButton)addButton.onclick=()=>openSupplierEditor();
  document.querySelectorAll("[data-supplier-edit]").forEach(b=>b.onclick=()=>openSupplierEditor(suppliers.find(row=>row.id===b.dataset.supplierEdit)));
  document.querySelectorAll("[data-supplier-pay]").forEach(b=>b.onclick=()=>openCollectionModal(b.dataset.supplierPay));
  refreshIcons();
}
async function openSupplierEditor(supplier=null) {
  const agents=await all("collection_agents");
  const selected=(await all("supplier_agent_links")).filter(link=>link.supplierId===supplier?.id).map(link=>link.agentId);
  const body='<div class="field"><label>Supplier name *</label><input id="sName" value="'+safe(supplier?.name||"")+'" required></div>'+
    '<div class="field"><label>Supplier type</label><select id="sType"><option value="direct_purchase">Direct purchase supplier (no collection agent)</option><option value="line_supply">Line supply supplier</option><option value="recharge_distributor">Recharge distributor</option></select></div>'+
    '<div class="form-grid two"><div class="field"><label>Contact number</label><input id="sPhone" type="tel" inputmode="tel" value="'+safe(supplier?.phone||"")+'"></div><div class="field"><label>Address (optional)</label><input id="sAddress" value="'+safe(supplier?.address||"")+'"></div></div>'+
    '<div id="supplierAgentWrap"><div class="section-heading"><h2>Collection agents</h2><span class="tiny">Select one or multiple</span></div><div id="supplierAgents">'+(agents.length?agents.map(agent=>'<label class="setting-row"><input type="checkbox" class="supplier-agent-check" value="'+safe(agent.id)+'" '+(selected.includes(agent.id)?"checked":"")+'><span class="setting-info"><b>'+safe(agent.name)+'</b><small>'+safe(agent.phone||"No phone")+'</small></span></label>').join(""):emptyState("Add collection agents first. You can assign them later."))+'</div></div>';
  showModal(supplier?"Edit supplier":"Add supplier",body,async()=>{
    const name=$("#sName").value.trim();if(!name)throw Error("Enter supplier name.");
    const type=$("#sType").value;
    const agentIds=type==="direct_purchase"?[]:[...document.querySelectorAll(".supplier-agent-check:checked")].map(input=>input.value);
    await saveSupplier({id:supplier?.id,name,supplierType:type,phone:$("#sPhone").value.trim(),address:$("#sAddress").value.trim(),agentIds});
    closeModal();toast("Supplier saved.");await renderSuppliers();
  },"SUPPLIER DETAILS");
  $("#sType").value=supplier?.supplierType||"direct_purchase";
  $("#sType").onchange=()=>{$("#supplierAgentWrap").hidden=$("#sType").value==="direct_purchase";};
  $("#sType").onchange();
}
async function renderAgents() {
  setTitle("Collection agents");
  const [agents,links,collections]=await Promise.all([all("collection_agents"),all("supplier_agent_links"),all("agent_collections")]);
  let html='<div class="page-intro"><div><h2>Collection agents</h2><p>Add agents once, then assign the same agent to multiple line suppliers or recharge distributors.</p></div><button class="btn btn-primary" id="addAgent">'+icon("plus")+'<span class="desktop-only">Add agent</span></button></div>';
  html+='<div class="record-list">'+(agents.length?agents.map(agent=>{
    const assigned=links.filter(link=>link.agentId===agent.id).length;
    const total=collections.filter(row=>row.agentId===agent.id).reduce((sum,row)=>sum+Number(row.amountPaise||0),0);
    return '<article class="record-card"><span class="list-avatar">'+icon("user-round")+'</span><div class="record-info"><b>'+safe(agent.name)+'</b><small>'+safe(agent.phone||"No phone")+' · '+assigned+' supplier links</small></div><div class="record-end">'+money(total)+'<small>Collections recorded</small></div><button class="icon-btn" data-edit-agent="'+safe(agent.id)+'">'+icon("pencil")+'</button></article>';
  }).join(""):emptyState("No collection agents added. Add agents here, then assign them to suppliers."))+'</div>';
  $("#view").innerHTML=html;$("#addAgent").onclick=()=>openAgentEditor();
  document.querySelectorAll("[data-edit-agent]").forEach(button=>button.onclick=()=>openAgentEditor(agents.find(row=>row.id===button.dataset.editAgent)));
  refreshIcons();
}
function openAgentEditor(agent=null) {
  const body='<div class="field"><label>Agent name *</label><input id="aName" value="'+safe(agent?.name||"")+'" required></div><div class="field"><label>Phone number</label><input id="aPhone" type="tel" value="'+safe(agent?.phone||"")+'"></div>';
  showModal(agent?"Edit collection agent":"Add collection agent",body,async()=>{
    const name=$("#aName").value.trim();if(!name)throw Error("Enter agent name.");
    await saveCollectionAgent({id:agent?.id,name,phone:$("#aPhone").value.trim()});
    closeModal();toast("Collection agent saved.");await renderAgents();
  },"COLLECTION AGENT");
}
async function renderCollections() {
  setTitle("Supplier collections");
  const [suppliers,agents,links,ledger,collections,providers]=await Promise.all([all("suppliers"),all("collection_agents"),all("supplier_agent_links"),all("supplier_ledger_entries"),all("agent_collections"),all("recharge_platforms")]);
  const openBalance=suppliers.map(s=>({supplier:s,balance:ledger.filter(row=>row.supplierId===s.id).reduce((sum,row)=>sum+Number(row.balanceDeltaPaise||0),0)})).filter(row=>row.balance>0);
  let html='<div class="page-intro"><div><h2>Supplier collections</h2><p>Record money given to a supplier or their collection agent. This is independent of the remaining recharge wallet balance.</p></div><button class="btn btn-primary" id="newCollection">'+icon("plus")+'<span class="desktop-only">Record payment</span></button></div>';
  html+='<div class="stats-grid">'+statCard("Suppliers with balance",String(openBalance.length),"store","Pending settlement")+statCard("Total supplier balance",money(openBalance.reduce((sum,row)=>sum+row.balance,0)),"wallet","Line + recharge distributors")+statCard("Agent payments recorded",String(collections.length),"hand-coins","Collection history")+statCard("Agents",String(agents.length),"users","Reusable across suppliers")+'</div>';
  html+=sectionHeading("Outstanding supplier balances","Wallet funding and line bills both appear here");
  html+='<div class="record-list">'+(openBalance.length?openBalance.map(row=>recordCard(row.supplier.name,supplierTypeLabel(row.supplier.supplierType),money(row.balance),"Outstanding","wallet")).join(""):emptyState("No supplier balances currently outstanding."))+'</div>';
  html+=sectionHeading("Recent agent collections","Which agent collected or received each payment");
  html+='<div class="record-list">'+(collections.length?collections.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,35).map(row=>{
    const supplier=suppliers.find(s=>s.id===row.supplierId),agent=agents.find(a=>a.id===row.agentId);
    return recordCard(agent?.name||"Agent",supplier?.name||"Supplier",money(row.amountPaise),new Date(row.createdAt).toLocaleString("en-IN")+" · "+(row.paymentMethod||"Cash"),"hand-coins");
  }).join(""):emptyState("Agent collection payments will appear here."))+'</div>';
  $("#view").innerHTML=html;$("#newCollection").onclick=()=>openCollectionModal();
  refreshIcons();
}
async function openCollectionModal(preselectedSupplierId=null) {
  const [suppliers,agents,links,ledger]=await Promise.all([all("suppliers"),all("collection_agents"),all("supplier_agent_links"),all("supplier_ledger_entries")]);
  const active=suppliers.filter(s=>s.supplierType!=="direct_purchase"||ledger.some(e=>e.supplierId===s.id));
  const body='<div class="field"><label>Supplier / distributor *</label><select id="collectionSupplier"><option value="">Select supplier</option>'+active.map(s=>'<option value="'+safe(s.id)+'">'+safe(s.name)+' · '+safe(supplierTypeLabel(s.supplierType))+'</option>').join("")+'</select></div>'+
    '<div class="field"><label>Collection agent (optional)</label><select id="collectionAgent"><option value="">Direct supplier payment / no agent</option></select><span class="field-hint">Only agents linked to the selected supplier are shown.</span></div>'+
    '<div class="field"><label>Amount paid / collected (₹) *</label><input id="collectionAmount" type="number" inputmode="decimal" min="0.01" step="0.01" placeholder="0.00"></div>'+
    '<div class="field"><label>Payment method</label><select id="collectionMethod"><option>Cash</option><option>UPI</option><option>Bank</option><option>Card</option></select></div>'+
    '<div class="field"><label>Note (optional)</label><input id="collectionNote" placeholder="e.g. Agent visited today"></div>'+
    '<p class="inline-note" id="collectionBalance"></p>';
  showModal("Record supplier payment",body,async()=>{
    const supplierId=$("#collectionSupplier").value,amount=toPaise($("#collectionAmount").value),agentId=$("#collectionAgent").value||null;
    if(!supplierId)throw Error("Select a supplier.");
    if(amount<=0)throw Error("Enter a valid amount.");
    const balance=ledger.filter(row=>row.supplierId===supplierId).reduce((sum,row)=>sum+Number(row.balanceDeltaPaise||0),0);
    if(balance>0&&amount>balance)throw Error("Amount exceeds current supplier outstanding of "+money(balance)+".");
    if(agentId&&!links.some(link=>link.supplierId===supplierId&&link.agentId===agentId))throw Error("Selected agent is not assigned to this supplier.");
    await recordSupplierPayment({supplierId,amountPaise:amount,paymentMethod:$("#collectionMethod").value,agentId,note:$("#collectionNote").value.trim()});
    closeModal();toast("Supplier payment saved"+(agentId?" with agent tracking.":"."));await renderCollections();
  },"SUPPLIER SETTLEMENT","Save payment");
  $("#collectionSupplier").value=preselectedSupplierId||"";
  const updateAgents=()=>{
    const supplierId=$("#collectionSupplier").value;
    const agentIds=links.filter(row=>row.supplierId===supplierId).map(row=>row.agentId);
    const options=agents.filter(agent=>agentIds.includes(agent.id));
    $("#collectionAgent").innerHTML='<option value="">Direct supplier payment / no agent</option>'+options.map(agent=>'<option value="'+safe(agent.id)+'">'+safe(agent.name)+'</option>').join("");
    const balance=ledger.filter(row=>row.supplierId===supplierId).reduce((sum,row)=>sum+Number(row.balanceDeltaPaise||0),0);
    $("#collectionBalance").textContent=supplierId?"Current outstanding: "+money(balance):"Select a supplier to view outstanding.";
  };
  $("#collectionSupplier").onchange=updateAgents;updateAgents();
}

/* ---------------- RECHARGE / PROVIDER RULES ---------------- */
function providerCommission(provider,amountPaise) {
  const rules=(provider.amountRules||[]).filter(rule=>rule.active!==false).slice().sort((a,b)=>{
    const aMin=Number(a.minAmountPaise||0),bMin=Number(b.minAmountPaise||0);
    const aMax=a.maxAmountPaise==null?aMin:Number(a.maxAmountPaise),bMax=b.maxAmountPaise==null?bMin:Number(b.maxAmountPaise);
    return (aMax-aMin)-(bMax-bMin);
  });
  const matched=rules.find(rule=>amountPaise>=Number(rule.minAmountPaise||0)&&amountPaise<=Number(rule.maxAmountPaise==null?rule.minAmountPaise:rule.maxAmountPaise));
  const type=matched?.commissionType||provider.commissionType||"percentage";
  const value=Number(matched?.commissionValue??provider.commissionValue??0);
  const commission=type==="fixed"?toPaise(value):Math.round(amountPaise*value/100);
  const valid=Number.isSafeInteger(commission)&&commission>=0&&commission<=amountPaise;
  return {commission,walletDebit:valid?amountPaise-commission:0,valid,matched};
}
async function renderRecharge() {
  setTitle("Recharge");
  const [providers,wallets,transactions]=await Promise.all([all("recharge_platforms"),all("recharge_wallets"),all("recharge_transactions")]);
  const active=providers.filter(row=>row.active!==false);
  const walletMap=new Map(wallets.map(row=>[row.providerId||row.id,row]));
  const latest=transactions.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,12);
  let html='<div class="page-intro"><div><h2>Quick recharge</h2><p>Choose provider and amount. Commission and wallet deduction are automatic.</p></div></div>';
  if(!active.length) {
    html+='<div class="card provider-empty"><span class="empty-icon">'+icon("wallet-cards")+'</span><h3>Set up recharge providers first</h3><p>Configure default commission and special amount-based rates in Settings. Those rules will be used every time you recharge.</p><button class="btn btn-primary" data-page="providers">'+icon("plus")+' Add provider</button></div>';
  } else {
    const walletTotal=totalBy(wallets,"balancePaise"),todayRows=transactions.filter(row=>String(row.createdAt).slice(0,10)===todayKey());
    html+='<div class="wallet-mini-grid" style="margin-bottom:13px"><div class="wallet-mini"><small>Total available wallet</small><strong>'+money(walletTotal)+'</strong></div><div class="wallet-mini"><small>Today commission</small><strong>'+money(totalBy(todayRows,"commissionPaise"))+'</strong></div></div>';
    html+='<div class="recharge-layout"><section class="card recharge-card"><div class="service-switch"><button type="button" class="service-option '+(rechargeService==="mobile"?"active":"")+'" data-service="mobile">'+icon("smartphone")+' Mobile</button><button type="button" class="service-option '+(rechargeService==="dth"?"active":"")+'" data-service="dth">'+icon("tv")+' DTH</button><button type="button" class="service-option '+(rechargeService==="other"?"active":"")+'" data-service="other">'+icon("zap")+' Other</button></div>';
    html+='<form id="rechargeForm"><div class="field"><label>Recharge provider</label><select id="rechargeProvider">'+active.map(p=>'<option value="'+safe(p.id)+'">'+safe(p.name)+'</option>').join("")+'</select></div>'+
      '<div class="field"><label id="recipientLabel">Mobile number</label><input id="rechargeRecipient" type="tel" inputmode="numeric" maxlength="10" placeholder="10-digit mobile number" required><span class="field-hint" id="recipientHint">Required for mobile recharge.</span></div>'+ '<div class="field"><label for="rechargeCustomerName">Customer name (new contact)</label><input id="rechargeCustomerName" type="text" placeholder="Enter only for a new customer"><span class="field-hint" id="rechargeCustomerMatch">Existing customer will be linked automatically by phone number.</span></div>'+
      '<div class="field"><label>Recharge amount (₹)</label><div class="amount-field"><span class="currency">₹</span><input id="rechargeAmount" type="number" inputmode="decimal" min="1" step="0.01" placeholder="0.00" required></div></div>'+
      '<div class="recharge-summary" id="rechargePreview"><div class="summary-line"><span>Commission earned</span><strong>—</strong></div><div class="summary-line"><span>Wallet deduction</span><strong>—</strong></div><div class="summary-line total"><span>Balance after recharge</span><strong>—</strong></div></div>'+
      '<button type="submit" class="btn btn-primary btn-block" id="rechargeSubmit">'+icon("check-circle")+' Record recharge</button><p class="recharge-submit-note">Wallet deduction = recharge amount − commission. Complete the actual recharge in your provider app.</p></form></section>';
    html+='<aside class="stack"><section class="card"><h3 class="card-title">Provider wallets</h3><p class="card-subtitle">Opening and top-up balances are managed in Settings.</p><div class="wallet-mini-grid">'+active.map(p=>'<div class="wallet-mini"><small>'+safe(p.name)+'</small><strong>'+money(walletMap.get(p.id)?.balancePaise||0)+'</strong></div>').join("")+'</div><button class="btn btn-secondary btn-block" style="margin-top:12px" data-page="providers">'+icon("settings-2")+' Manage providers & rates</button></section></aside></div>';
  }
  html+=sectionHeading("Recent recharge transactions","Saved wallet debit and commission history");
  html+='<div class="record-list">'+(latest.length?latest.map(row=>recordCard(row.providerName,(row.serviceType||"service").toUpperCase()+(row.recipient?" · "+row.recipient:""),money(row.amountPaise),money(row.commissionPaise)+" commission · Wallet −"+money(row.walletDebitPaise),"smartphone")).join(""):emptyState("No recharge transactions recorded yet."))+'</div>';
  $("#view").innerHTML=html;bindPageActions();
  if(active.length)bindRecharge(active,walletMap);
  refreshIcons();
}
function bindRecharge(active,walletMap) {
  const providerSelect=$("#rechargeProvider"),amountInput=$("#rechargeAmount"),recipient=$("#rechargeRecipient"),customerNameInput=$("#rechargeCustomerName");
  recipient.addEventListener("input",async()=>{const phone=normalizePhone(recipient.value);if(phone.length!==10){$("#rechargeCustomerMatch").textContent="Existing customer will be linked automatically by phone number.";return;}const customers=await all("customers"),match=customers.find(row=>normalizePhone(row.phone)===phone);if(match){customerNameInput.value=match.name||"";customerNameInput.dataset.customerId=match.id;$("#rechargeCustomerMatch").textContent="✓ Existing customer: "+(match.name||"Saved customer");}else{$("#rechargeCustomerMatch").textContent="New number. Add a name to save this customer contact.";customerNameInput.dataset.customerId="";}});
  const updateService=()=>{
    document.querySelectorAll("[data-service]").forEach(button=>button.classList.toggle("active",button.dataset.service===rechargeService));
    if(rechargeService==="mobile"){recipient.type="tel";recipient.inputMode="numeric";recipient.maxLength=10;recipient.placeholder="10-digit mobile number";recipient.required=true;$("#recipientLabel").textContent="Mobile number";$("#recipientHint").textContent="Required for mobile recharge.";}
    else if(rechargeService==="dth"){recipient.type="text";recipient.inputMode="text";recipient.maxLength=40;recipient.placeholder="Subscriber ID / phone (optional)";recipient.required=false;$("#recipientLabel").textContent="DTH ID / phone number (optional)";$("#recipientHint").textContent="Leave blank if your external DTH app does not need a reference.";}
    else{recipient.type="text";recipient.inputMode="text";recipient.maxLength=40;recipient.placeholder="Phone / reference (optional)";recipient.required=false;$("#recipientLabel").textContent="Phone / reference (optional)";$("#recipientHint").textContent="Optional for non-mobile services.";}
  };
  const preview=()=>{
    const provider=active.find(row=>row.id===providerSelect.value),amount=toPaise(amountInput.value),wallet=walletMap.get(provider?.id);
    const before=Number(wallet?.balancePaise||0);
    if(!provider||amount<=0){$("#rechargePreview").innerHTML='<div class="summary-line"><span>Commission earned</span><strong>—</strong></div><div class="summary-line"><span>Wallet deduction</span><strong>—</strong></div><div class="summary-line total"><span>Balance after recharge</span><strong>Enter amount</strong></div>';$("#rechargeSubmit").disabled=false;return;}
    const calc=providerCommission(provider,amount),after=before-calc.walletDebit,enough=calc.valid&&after>=0;
    $("#rechargePreview").innerHTML='<div class="summary-line"><span>Commission earned</span><strong>'+money(calc.commission)+'</strong></div><div class="summary-line"><span>Wallet deduction</span><strong>'+money(calc.walletDebit)+'</strong></div><div class="summary-line"><span>Current wallet</span><strong>'+money(before)+'</strong></div><div class="summary-line total"><span>Balance after recharge</span><strong>'+money(after)+'</strong></div>'+(!calc.valid?'<div class="form-error">Invalid commission rule. Check provider settings.</div>':!enough?'<div class="form-error">Not enough wallet balance. Add funds in provider settings.</div>':"");
    $("#rechargeSubmit").disabled=!enough;
    $("#rechargeSubmit").innerHTML=icon("check-circle")+(enough?" Record recharge":"Insufficient wallet balance");
  };
  document.querySelectorAll("[data-service]").forEach(button=>button.onclick=()=>{rechargeService=button.dataset.service;updateService();preview();});
  providerSelect.onchange=preview;amountInput.oninput=preview;updateService();preview();
  $("#rechargeForm").onsubmit=async event=>{
    event.preventDefault();
    const providerId=providerSelect.value,amount=toPaise(amountInput.value),recipientValue=recipient.value.trim();
    if(!amount||amount<=0)throw new Error("Enter a valid recharge amount.");
    if(rechargeService==="mobile"&&digits(recipientValue).length!==10)throw new Error("Enter a valid 10-digit mobile number.");
    let customerId=null;
    if(digits(recipientValue).length===10)customerId=await resolveCustomer(customerNameInput.value.trim(),recipientValue);
    try {
      $("#rechargeSubmit").disabled=true;
      const result=await completeRecharge({providerId,serviceType:rechargeService,recipient:recipientValue,customerId,amountPaise:amount});
      toast("Recharge recorded. Commission "+money(result.commissionPaise)+".");
      await renderRecharge();
    } catch(error){toast(error.message||"Recharge failed.");preview();}
  };
}

/* Provider settings: one default rule plus exact amount / amount range overrides. */
async function renderProviders() {
  setTitle("Recharge providers");
  const [providers,wallets,suppliers,transactions]=await Promise.all([all("recharge_platforms"),all("recharge_wallets"),all("suppliers"),all("recharge_wallet_transactions")]);
  const walletMap=new Map(wallets.map(row=>[row.providerId||row.id,row]));
  const rechargeSuppliers=suppliers.filter(row=>row.supplierType==="recharge_distributor");
  const pendingTopups=transactions.filter(row=>row.entryType==="CREDIT"&&row.supplierId);
  let html='<div class="page-intro"><div><h2>Recharge providers</h2><p>Configure commission once. Every recharge automatically uses the matching default or amount-specific rate.</p></div><button class="btn btn-primary" id="addProvider">'+icon("plus")+'<span class="desktop-only">Add provider</span></button></div>';
  html+='<div class="stats-grid">'+statCard("Provider accounts",String(providers.length),"radio-tower","Recharge platforms")+statCard("Total wallet",money(totalBy(wallets,"balancePaise")),"wallet","Available credits")+statCard("Wallet credits",String(pendingTopups.length),"arrow-down-to-line","Funding transactions")+statCard("Commission rules",String(providers.reduce((sum,p)=>sum+(p.amountRules||[]).length+1,0)),"percent","Default + custom rules")+'</div>';
  if(!providers.length)html+='<div class="card provider-empty"><span class="empty-icon">'+icon("radio-tower")+'</span><h3>No recharge providers</h3><p>Add a recharge app or distributor, choose the linked supplier and configure its commission.</p><button class="btn btn-primary" id="addProviderEmpty">Add first provider</button></div>';
  html+='<div class="settings-grid">'+providers.map(provider=>{
    const wallet=walletMap.get(provider.id),supplier=rechargeSuppliers.find(s=>s.id===provider.supplierId);
    const overrides=(provider.amountRules||[]).length;
    return '<article class="card provider-card"><div class="provider-top"><span class="provider-logo">'+icon("radio-tower")+'</span><div class="provider-info"><h3>'+safe(provider.name)+'</h3><p>'+pill(provider.active===false?"Inactive":"Active",provider.active===false?"danger":"")+'</p></div></div><div class="provider-balance">'+money(wallet?.balancePaise||0)+'</div><div class="provider-meta">Default: '+safe(provider.commissionType==="fixed"?rupees(provider.commissionValue)+" per recharge":provider.commissionValue+"% commission")+'<br>'+overrides+' amount-specific override(s)<br>Supplier: '+safe(supplier?.name||"Not linked")+'<br>Wallet debit is always recharge amount − commission.</div><div class="provider-actions"><button class="btn btn-secondary btn-sm" data-topup="'+safe(provider.id)+'">'+icon("plus-circle")+' Add balance</button><button class="btn btn-quiet btn-sm" data-edit-provider="'+safe(provider.id)+'">'+icon("pencil")+' Edit rates</button></div></article>';
  }).join("")+'</div>';
  $("#view").innerHTML=html;
  const addButton=$("#addProvider")||$("#addProviderEmpty");if(addButton)addButton.onclick=()=>openProviderEditor();
  document.querySelectorAll("[data-edit-provider]").forEach(button=>button.onclick=()=>openProviderEditor(providers.find(p=>p.id===button.dataset.editProvider)));
  document.querySelectorAll("[data-topup]").forEach(button=>button.onclick=()=>openTopup(button.dataset.topup,providers.find(p=>p.id===button.dataset.topup)));
  refreshIcons();
}
function amountRuleRow(rule={},index=0) {
  return '<div class="card amount-rule-row" data-rule-row="'+index+'" style="padding:12px;margin-bottom:9px"><div class="form-grid two"><div class="field"><label>Recharge amount from (₹)</label><input class="rule-min" type="number" min="0.01" step="0.01" value="'+(rule.minAmountPaise!=null?rule.minAmountPaise/100:"")+'" placeholder="100"></div><div class="field"><label>To amount (₹) · same for exact</label><input class="rule-max" type="number" min="0.01" step="0.01" value="'+(rule.maxAmountPaise!=null?rule.maxAmountPaise/100:"")+'" placeholder="100"></div></div><div class="form-grid two"><div class="field"><label>Commission type</label><select class="rule-type"><option value="percentage">Percentage</option><option value="fixed">Fixed ₹</option></select></div><div class="field"><label>Commission value</label><input class="rule-value" type="number" min="0" step="0.01" value="'+Number(rule.commissionValue||0)+'"></div></div><button type="button" class="btn btn-danger btn-sm" data-remove-rule="'+index+'">'+icon("trash-2")+' Remove rule</button></div>';
}
function openProviderEditor(provider=null) {
  (async()=>{
    const suppliers=(await all("suppliers")).filter(row=>row.supplierType==="recharge_distributor");
    const body='<div class="field"><label>Recharge provider / app name *</label><input id="providerName" value="'+safe(provider?.name||"")+'" placeholder="e.g. Jio distributor app" required></div>'+
      '<div class="field"><label>Linked recharge distributor supplier (optional but recommended)</label><select id="providerSupplier"><option value="">Not linked</option>'+suppliers.map(s=>'<option value="'+safe(s.id)+'">'+safe(s.name)+'</option>').join("")+'</select><span class="field-hint">Wallet credits will add to this supplier’s payable balance. Settle with the supplier or one of their linked collection agents separately from wallet usage.</span></div>'+
      '<div class="section-heading"><h2>Default commission</h2><span class="tiny">Used when no amount rule matches</span></div>'+
      '<div class="form-grid two"><div class="field"><label>Default commission type</label><select id="defaultCommissionType"><option value="percentage">Percentage</option><option value="fixed">Fixed amount (₹)</option></select></div><div class="field"><label>Default commission value</label><input id="defaultCommissionValue" type="number" min="0" step="0.01" value="'+Number(provider?.commissionValue??4)+'"></div></div>'+
      '<div class="section-heading"><h2>Amount-specific commission</h2><button type="button" id="addAmountRule" class="btn btn-secondary btn-sm">'+icon("plus")+' Add rule</button></div><p class="inline-note">Example: recharge exactly ₹100 → commission 5%. Or set a range ₹100–₹199 with a different rate. The narrowest matching rule wins.</p><div id="amountRuleList"></div>'+
      '<div class="field"><label>Opening wallet balance (₹)</label><input id="providerOpening" type="number" min="0" step="0.01" value="0" '+(provider?"disabled":"")+'><span class="field-hint">'+(provider?"Existing wallet balance is preserved. Use Add balance for new credits.":"Enter the balance already present in your provider app.")+'</span></div>'+
      '<label class="setting-row"><input type="checkbox" id="providerActive" '+(provider?.active===false?"":"checked")+'><span class="setting-info"><b>Provider active</b><small>Inactive providers will not show in recharge entry.</small></span></label>';
    showModal(provider?"Edit recharge provider":"Add recharge provider",body,async()=>{
      const name=$("#providerName").value.trim(),value=Number($("#defaultCommissionValue").value||0);
      if(!name)throw Error("Enter provider name.");
      if(value<0||($("#defaultCommissionType").value==="percentage"&&value>100))throw Error("Check the default commission value.");
      const amountRules=[...document.querySelectorAll(".amount-rule-row")].map((row,i)=>{
        const min=toPaise($(".rule-min",row).value),maxValue=$(".rule-max",row).value.trim(),max=maxValue?toPaise(maxValue):min;
        const commissionType=$(".rule-type",row).value,commissionValue=Number($(".rule-value",row).value||0);
        if(min<=0||max<min||commissionValue<0)throw Error("Check amount rule "+(i+1)+".");
        if(commissionType==="percentage"&&commissionValue>100)throw Error("Rule percentage cannot exceed 100%.");
        return {id:uid(),minAmountPaise:min,maxAmountPaise:max,commissionType,commissionValue};
      });
      const openingBalancePaise=provider?undefined:toPaise($("#providerOpening").value);
      await saveRechargeProvider({id:provider?.id,name,supplierId:$("#providerSupplier").value||null,commissionType:$("#defaultCommissionType").value,commissionValue:value,amountRules,active:$("#providerActive").checked,openingBalancePaise});
      closeModal();toast("Provider commission settings saved.");await renderProviders();
    },"SETTINGS · RECHARGE PROVIDERS");
    $("#providerSupplier").value=provider?.supplierId||"";
    $("#defaultCommissionType").value=provider?.commissionType||"percentage";
    let rules=(provider?.amountRules||[]).map((row,i)=>({...row,index:i}));
    const draw=()=>{
      $("#amountRuleList").innerHTML=rules.map((rule,i)=>amountRuleRow(rule,i)).join("")||(emptyState("No amount-specific rules. The default commission will apply to all recharge amounts."));
      document.querySelectorAll("[data-remove-rule]").forEach(button=>button.onclick=()=>{rules.splice(Number(button.dataset.removeRule),1);draw();});
      rules.forEach((rule,i)=>{$(".rule-type",document.querySelector('[data-rule-row="'+i+'"]')).value=rule.commissionType||"percentage";});
      refreshIcons();
    };
    $("#addAmountRule").onclick=()=>{rules.push({minAmountPaise:toPaise(100),maxAmountPaise:toPaise(100),commissionType:"percentage",commissionValue:4});draw();};
    draw();
  })().catch(error=>toast(error.message));
}
async function openTopup(providerId,provider) {
  const suppliers=(await all("suppliers")).filter(row=>row.supplierType==="recharge_distributor");
  const body='<p class="inline-note">Credit the amount added to the external recharge app. The full amount is recorded as a supplier payable when a distributor is linked. Agent collection is recorded later when the agent visits, even if wallet balance remains.</p>'+
    '<div class="field"><label>Amount credited to recharge wallet (₹)</label><input id="topupAmount" type="number" min="0.01" step="0.01" placeholder="3000.00"></div>'+
    '<div class="field"><label>Distributor supplier</label><select id="topupSupplier"><option value="">Use provider linked supplier</option>'+suppliers.map(s=>'<option value="'+safe(s.id)+'">'+safe(s.name)+'</option>').join("")+'</select></div>'+
    '<div class="field"><label>Reference / note (optional)</label><input id="topupNote" placeholder="Agent credit / transaction reference"></div>';
  showModal("Add wallet balance",body,async()=>{
    const amount=toPaise($("#topupAmount").value);if(amount<=0)throw Error("Enter a valid top-up amount.");
    const supplierId=$("#topupSupplier").value||provider.supplierId||null;
    await topupRechargeWallet({providerId,amountPaise:amount,supplierId,note:$("#topupNote").value.trim()});
    closeModal();toast("Wallet credited. Supplier payable increased separately.");await renderProviders();
  },"PROVIDER WALLET","Credit wallet");
  $("#topupSupplier").value=provider.supplierId||"";
}

/* ---------------- REPAIR WORKFLOW ---------------- */
async function renderRepairs() {
  setTitle("Repair jobs");
  const [jobs,customers]=await Promise.all([all("repair_jobs"),all("customers")]);
  if(selectedRepairId){await renderRepairDetail(selectedRepairId);return;}
  let html='<div class="page-intro"><div><h2>Repair management</h2><p>Receive the device first. Add replacement parts, markup and service charge as work progresses.</p></div><button class="btn btn-primary" id="newRepair">'+icon("plus")+'<span class="desktop-only">New job</span></button></div>';
  html+='<div class="stats-grid">'+repairStatuses.map(([status,label])=>statCard(label,String(jobs.filter(row=>row.status===status).length),status==="completed"?"check-circle":status==="waiting_component"?"package-search":"wrench","Repair jobs")).join("")+'</div>';
  html+=sectionHeading("Repair register","Tap a job to add parts, service charges or update status");
  html+='<div class="record-list">'+(jobs.length?jobs.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(job=>{
    const customer=customers.find(row=>row.id===job.customerId);
    const status=repairStatuses.find(row=>row[0]===job.status)?.[1]||job.status;
    return '<article class="record-card repair-open" data-repair-open="'+safe(job.id)+'" role="button" tabindex="0"><span class="list-avatar">'+icon("wrench")+'</span><div class="record-info"><b>'+safe(job.deviceModel||job.device||"Device repair")+'</b><small>'+safe(customer?.name||job.customerName||"Customer")+' · '+safe(job.deviceBrand||"")+'</small><small>'+safe(job.imei||"No IMEI / serial")+'</small></div><div class="record-end">'+pill(status,job.status==="waiting_component"?"warning":job.status==="rejected"?"danger":"")+'<small>'+new Date(job.createdAt).toLocaleDateString("en-IN")+'</small></div></article>';
  }).join(""):emptyState("No repair jobs yet. Create a job card when a customer hands over a device."))+'</div>';
  $("#view").innerHTML=html;$("#newRepair").onclick=openRepairModal;
  document.querySelectorAll("[data-repair-open]").forEach(button=>{button.onclick=()=>{selectedRepairId=button.dataset.repairOpen;renderRepairDetail(selectedRepairId);};button.onkeydown=event=>{if(event.key==="Enter")button.click();};});
  refreshIcons();
}
async function openRepairModal() {
  const body=customerFields("repair",false)+
    '<div class="form-grid two"><div class="field"><label>Device brand</label><input id="repairBrand" placeholder="e.g. Samsung"></div><div class="field"><label>Model</label><input id="repairModel" placeholder="e.g. Galaxy A52"></div></div>'+
    '<div class="field"><label>IMEI / serial number (optional)</label><input id="repairImei" maxlength="40" placeholder="IMEI or serial number"></div>'+
    '<div class="field"><label>Reported problem *</label><textarea id="repairProblem" placeholder="Customer complaint / device issue" required></textarea></div>'+
    '<div class="field"><label>Device condition / items received (optional)</label><textarea id="repairCondition" placeholder="Screen condition, SIM tray, charger received, visible damage…"></textarea></div>'+
    '<p class="inline-note">Status starts as Pending. Parts and service charges are added later from the repair job.</p>';
  showModal("Receive repair device",body,async()=>{
    const problem=$("#repairProblem").value.trim();if(!problem)throw Error("Enter the reported problem.");
    const customerId=await resolveCustomer($("#repairName").value.trim(),$("#repairPhone").value.trim());
    if(!customerId)throw Error("Enter a customer name or phone number.");
    const customers=await all("customers"),customer=customers.find(row=>row.id===customerId);
    await createRepairJob({customerId,customerName:customer?.name,customerPhone:customer?.phone,deviceBrand:$("#repairBrand").value.trim(),deviceModel:$("#repairModel").value.trim(),imei:$("#repairImei").value.trim(),reportedProblem:problem,deviceCondition:$("#repairCondition").value.trim()});
    closeModal();toast("Repair job created · Pending.");selectedRepairId=null;await renderRepairs();
  },"REPAIR INTAKE","Create job card");
  bindCustomerLookup("repair");
}
async function renderRepairDetail(id) {
  const [jobs,customers,parts,services,payments,products]=await Promise.all([all("repair_jobs"),all("customers"),all("repair_job_parts"),all("repair_job_services"),all("repair_payments"),all("products")]);
  const job=jobs.find(row=>row.id===id);if(!job){selectedRepairId=null;await renderRepairs();return;}
  setTitle("Repair job");
  const customer=customers.find(row=>row.id===job.customerId);
  const jobParts=parts.filter(row=>row.repairJobId===id),jobServices=services.filter(row=>row.repairJobId===id),jobPayments=payments.filter(row=>row.repairJobId===id);
  const partsCharge=totalBy(jobParts,"customerTotalPaise"),partsCost=totalBy(jobParts,"costTotalPaise");
  const serviceCharge=totalBy(jobServices,"customerChargePaise"),serviceCost=totalBy(jobServices,"internalCostPaise");
  const total=partsCharge+serviceCharge,paid=totalBy(jobPayments,"amountPaise"),due=Math.max(0,total-paid);
  const status=repairStatuses.find(row=>row[0]===job.status)?.[1]||job.status;
  let html='<div class="page-intro"><div><button class="text-link" id="backRepairs">'+icon("arrow-left")+' Repair register</button><h2>'+safe(job.deviceModel||job.device||"Device repair")+'</h2><p>'+safe(customer?.name||job.customerName||"Customer")+' · Job '+safe(job.id.slice(0,8))+'</p></div><span>'+pill(status,job.status==="waiting_component"?"warning":job.status==="rejected"?"danger":"")+'</span></div>';
  html+='<div class="card"><div class="form-grid two"><div><span class="tiny">Customer</span><b style="display:block;margin-top:4px">'+safe(customer?.name||job.customerName||"—")+'</b><small class="muted">'+safe(customer?.phone||job.customerPhone||"")+'</small></div><div><span class="tiny">Device</span><b style="display:block;margin-top:4px">'+safe(job.deviceBrand||"")+" "+safe(job.deviceModel||"")+'</b><small class="muted">'+safe(job.imei||"IMEI / serial not supplied")+'</small></div></div><div style="margin-top:12px"><span class="tiny">Reported problem</span><p style="font-size:12px;margin:5px 0">'+safe(job.reportedProblem||"—")+'</p><span class="tiny">Condition received: '+safe(job.deviceCondition||"Not recorded")+'</span></div><div class="field" style="margin-top:15px"><label>Repair status</label><select id="repairStatus">'+repairStatuses.map(([key,label])=>'<option value="'+key+'">'+label+'</option>').join("")+'</select></div></div>';
  html+='<div class="section-heading"><h2>Parts & components</h2><button class="btn btn-secondary btn-sm" id="addRepairPart">'+icon("plus")+' Add part</button></div>';
  html+='<div class="card">'+(jobParts.length?'<div class="list-stack">'+jobParts.map(row=>listRow(row.productName,row.quantity+" × "+money(row.customerUnitPricePaise),money(row.customerTotalPaise),"Cost "+money(row.costTotalPaise)+" · Margin "+money(row.customerTotalPaise-row.costTotalPaise),"cpu")).join("")+'</div>':emptyState("No components added. Add a display, charging board, battery or other stock part when used."))+'</div>';
  html+='<div class="section-heading"><h2>Service charges</h2><button class="btn btn-secondary btn-sm" id="addRepairService">'+icon("plus")+' Add service</button></div>';
  html+='<div class="card">'+(jobServices.length?'<div class="list-stack">'+jobServices.map(row=>listRow(row.description,money(row.customerChargePaise)+" customer charge",money(row.customerChargePaise),"Internal cost "+money(row.internalCostPaise),"wrench")).join("")+'</div>':emptyState("Add a service charge. You can enter one total or split internal wages, electricity, room and miscellaneous costs."))+'</div>';
  html+='<div class="section-heading"><h2>Repair invoice summary</h2><span class="tiny">Customer sees parts + one service charge total</span></div>';
  html+='<div class="card"><div class="summary-line"><span>Parts charged</span><strong>'+money(partsCharge)+'</strong></div><div class="summary-line"><span>Service charge</span><strong>'+money(serviceCharge)+'</strong></div><div class="summary-line total"><span>Customer total</span><strong>'+money(total)+'</strong></div><div class="summary-line"><span>Parts cost</span><strong>'+money(partsCost)+'</strong></div><div class="summary-line"><span>Internal service cost</span><strong>'+money(serviceCost)+'</strong></div><div class="summary-line"><span>Repair contribution</span><strong>'+money(total-partsCost-serviceCost)+'</strong></div><div class="summary-line"><span>Payments received</span><strong>'+money(paid)+'</strong></div><div class="summary-line total"><span>Balance to collect</span><strong>'+money(due)+'</strong></div><button class="btn btn-primary btn-block" id="repairPayment" style="margin-top:10px" '+(due<=0?"disabled":"")+'>'+icon("wallet")+' Record customer payment</button></div>';
  html+='<div class="section-heading"><h2>Payment history</h2></div><div class="record-list">'+(jobPayments.length?jobPayments.map(row=>recordCard(row.paymentMethod,money(row.amountPaise),money(row.amountPaise),new Date(row.createdAt).toLocaleString("en-IN"),"wallet")).join(""):emptyState("No repair payments yet."))+'</div>';
  $("#view").innerHTML=html;$("#backRepairs").onclick=()=>{selectedRepairId=null;renderRepairs();};
  $("#repairStatus").value=job.status||"pending";
  $("#repairStatus").onchange=async()=>{await updateRepairStatus(id,$("#repairStatus").value,"Status updated");toast("Repair status updated.");};
  $("#addRepairPart").onclick=()=>openRepairPartModal(job,products);
  $("#addRepairService").onclick=()=>openRepairServiceModal(job);
  $("#repairPayment").onclick=()=>openRepairPayment(job,total,paid);
  refreshIcons();
}
function defaultRepairCharge(product) {
  const cost=Number(product.costPaise||0),value=Number(product.repairMarginValue||0);
  return product.repairMarginType==="percentage"?Math.round(cost*(1+value/100)):cost+toPaise(value);
}
function openRepairPartModal(job,products) {
  const available=products.filter(row=>Number(row.qty||0)>0);
  const body='<div class="field"><label>Component / product *</label><select id="repairPartProduct"><option value="">Select component from stock</option>'+available.map(p=>'<option value="'+safe(p.id)+'">'+safe(p.name)+' · '+Number(p.qty||0)+' available</option>').join("")+'</select></div>'+
    '<div class="form-grid two"><div class="field"><label>Quantity</label><input id="repairPartQty" type="number" min="1" step="1" value="1"></div><div class="field"><label>Customer price per unit (₹)</label><input id="repairPartPrice" type="number" min="0" step="0.01" placeholder="Auto from product markup"></div></div>'+
    '<p class="inline-note" id="repairPartCostHint">Purchase cost comes from inventory. Default customer price uses this product’s repair markup; you can change it for this job.</p>';
  showModal("Add repair component",body,async()=>{
    const product=available.find(row=>row.id===$("#repairPartProduct").value);if(!product)throw Error("Select a component.");
    const charge=$("#repairPartPrice").value.trim()===""?defaultRepairCharge(product):toPaise($("#repairPartPrice").value);
    await addRepairPart({repairJobId:job.id,productId:product.id,quantity:Number($("#repairPartQty").value||0),customerUnitPricePaise:charge});
    closeModal();toast("Component added and inventory reduced.");await renderRepairDetail(job.id);
  },"REPAIR COSTS");
  $("#repairPartProduct").onchange=()=>{
    const product=available.find(row=>row.id===$("#repairPartProduct").value);
    if(product){$("#repairPartPrice").value=(defaultRepairCharge(product)/100).toFixed(2);$("#repairPartCostHint").textContent="Shop cost: "+money(product.costPaise)+" · Default customer price: "+money(defaultRepairCharge(product))+" · Stock: "+product.qty;}
  };
}
function openRepairServiceModal(job) {
  const body='<div class="field"><label>Service description</label><input id="serviceDescription" value="Repair service" placeholder="e.g. Display replacement labour"></div>'+
    '<div class="field"><label>Customer service charge (₹) *</label><input id="serviceCharge" type="number" min="0" step="0.01" placeholder="e.g. 500"></div>'+
    '<div class="field"><label>Internal cost entry</label><select id="serviceCostMode"><option value="single">I only want to enter service charge</option><option value="split">Break down internal cost (customer will not see this)</option></select></div>'+
    '<div id="serviceBreakdown" hidden><p class="inline-note">These costs are for your own profit calculation. Customer invoice will show only one combined service charge.</p><div class="form-grid two"><div class="field"><label>Worker wage allocation (₹)</label><input id="serviceWage" type="number" min="0" step="0.01" value="0"></div><div class="field"><label>Electricity allocation (₹)</label><input id="servicePower" type="number" min="0" step="0.01" value="0"></div><div class="field"><label>Room / rent allocation (₹)</label><input id="serviceRent" type="number" min="0" step="0.01" value="0"></div><div class="field"><label>Other internal cost (₹)</label><input id="serviceOther" type="number" min="0" step="0.01" value="0"></div></div></div>';
  showModal("Add service charge",body,async()=>{
    const amount=toPaise($("#serviceCharge").value);if(amount<0)throw Error("Enter a valid service charge.");
    const split=$("#serviceCostMode").value==="split";
    const costBreakdown=split?{workerWage:toPaise($("#serviceWage").value),electricity:toPaise($("#servicePower").value),room:toPaise($("#serviceRent").value),other:toPaise($("#serviceOther").value)}:{};
    await addRepairService({repairJobId:job.id,description:$("#serviceDescription").value.trim()||"Repair service",customerChargePaise:amount,costBreakdown});
    closeModal();toast("Service charge added.");await renderRepairDetail(job.id);
  },"REPAIR COSTS");
  $("#serviceCostMode").onchange=()=>{$("#serviceBreakdown").hidden=$("#serviceCostMode").value!=="split";};
}
async function openRepairPayment(job,total,paid) {
  const due=Math.max(0,total-paid);if(!due)return;
  const body='<p class="inline-note">Repair invoice total: '+money(total)+' · Already paid: '+money(paid)+' · Due: <b>'+money(due)+'</b></p><div class="field"><label>Amount received (₹)</label><input id="repairPayAmount" type="number" min="0.01" max="'+(due/100)+'" step="0.01" value="'+(due/100).toFixed(2)+'"></div><div class="field"><label>Payment method</label><select id="repairPayMethod"><option>Cash</option><option>UPI</option><option>Bank</option><option>Card</option></select></div>';
  showModal("Repair payment",body,async()=>{
    const amount=toPaise($("#repairPayAmount").value);if(amount<=0||amount>due)throw Error("Payment must be within the outstanding balance.");
    await recordRepairPayment({repairJobId:job.id,customerId:job.customerId,amountPaise:amount,paymentMethod:$("#repairPayMethod").value});
    closeModal();toast("Repair payment saved.");await renderRepairDetail(job.id);
  },"CUSTOMER PAYMENT");
}

/* ---------------- GENERIC MODULES: EXPENSES / ACCOUNTS ---------------- */
const simplePages={
  expenses:{title:"Expenses",desc:"Rent, electricity, solder wire, LED, wages, transport and all other shop expenses.",store:"expenses",button:"Add expense",fields:[["category","Expense category","text"],["amount","Amount (₹)","number"],["paymentMethod","Paid from","select:Cash,UPI,Bank,Card"],["note","Description / details","text"]]},
  accounts:{title:"Money & day book",desc:"Record money received or paid. Supplier and customer settlements are recorded in their dedicated workflows.",store:"payments",button:"Record money entry",fields:[["party","Person / description","text"],["amount","Amount (₹)","number"],["direction","Direction","select:Received,Paid"],["paymentMethod","Account","select:Cash,UPI,Bank,Card"],["note","Note","text"]]}
};
async function renderSimple(page) {
  const config=simplePages[page];setTitle(config.title);
  const rows=(await all(config.store)).slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  let html='<div class="page-intro"><div><h2>'+config.title+'</h2><p>'+config.desc+'</p></div><button class="btn btn-primary" id="addSimple">'+icon("plus")+'<span class="desktop-only">'+config.button+'</span></button></div>';
  html+='<div class="record-list">'+(rows.length?rows.slice(0,100).map(row=>recordCard(row.category||row.party||row.note||"Entry",row.paymentMethod||row.note||"",money(row.amountPaise),new Date(row.createdAt).toLocaleString("en-IN"),page==="expenses"?"receipt":"wallet")).join(""):emptyState("No records yet."))+'</div>';
  $("#view").innerHTML=html;
  $("#addSimple").onclick=()=>{
    const body=config.fields.map(([key,label,type])=>'<div class="field"><label>'+label+'</label>'+(type.startsWith("select:")?'<select id="simple_'+key+'">'+type.slice(7).split(",").map(v=>'<option>'+v+'</option>').join("")+'</select>':'<input id="simple_'+key+'" type="'+type+'" '+(type==="number"?'min="0" step="0.01" inputmode="decimal"':"")+' required>')+'</div>').join("");
    showModal(config.button,body,async()=>{
      const row={id:uid(),createdAt:new Date().toISOString()};
      for(const [key,label,type] of config.fields){const value=$("#simple_"+key).value;row[key]=key==="amount"?undefined:value;if(key==="amount")row.amountPaise=toPaise(value);}
      await add(config.store,row);closeModal();toast("Record saved.");await renderSimple(page);
    },page.toUpperCase());
  };
  refreshIcons();
}

/* ---------------- REPORTS / SETTINGS / MORE ---------------- */
async function renderReports() {
  setTitle("Reports");
  const [sales,recharges,expenses,purchases,repairs,parts,services,suppliers,ledger]=await Promise.all(["sales","recharge_transactions","expenses","purchases","repair_jobs","repair_job_parts","repair_job_services","suppliers","supplier_ledger_entries"].map(all));
  const filter=(row,period)=>period==="today"?String(row.createdAt||"").slice(0,10)===todayKey():period==="month"?String(row.createdAt||"").slice(0,7)===todayKey().slice(0,7):true;
  const metric=(label,period)=>{
    const s=sales.filter(row=>filter(row,period)),r=recharges.filter(row=>filter(row,period)),e=expenses.filter(row=>filter(row,period));
    return '<div class="card"><h3 class="card-title">'+label+'</h3><div class="wallet-mini-grid"><div class="wallet-mini"><small>Sales</small><strong>'+money(totalBy(s,"totalPaise"))+'</strong></div><div class="wallet-mini"><small>Recharge commission</small><strong>'+money(totalBy(r,"commissionPaise"))+'</strong></div><div class="wallet-mini"><small>Expenses</small><strong>'+money(totalBy(e,"amountPaise"))+'</strong></div><div class="wallet-mini"><small>Sales due</small><strong>'+money(totalBy(s,"duePaise"))+'</strong></div></div></div>';
  };
  const supplierDue=suppliers.reduce((sum,s)=>sum+ledger.filter(row=>row.supplierId===s.id).reduce((v,row)=>v+Number(row.balanceDeltaPaise||0),0),0);
  let html='<div class="page-intro"><div><h2>Reports</h2><p>Operational summaries for daily, weekly, monthly and yearly review.</p></div></div>'+
    '<div class="stack">'+metric("Today","today")+metric("This month","month")+metric("All time","all")+'</div>'+
    '<div class="section-heading"><h2>Business activity</h2></div><div class="card"><div class="wallet-mini-grid"><div class="wallet-mini"><small>Purchase bills</small><strong>'+purchases.length+'</strong></div><div class="wallet-mini"><small>Repair jobs</small><strong>'+repairs.length+'</strong></div><div class="wallet-mini"><small>Repair parts margin</small><strong>'+money(totalBy(parts,"customerTotalPaise")-totalBy(parts,"costTotalPaise"))+'</strong></div><div class="wallet-mini"><small>Service contribution</small><strong>'+money(totalBy(services,"customerChargePaise")-totalBy(services,"internalCostPaise"))+'</strong></div><div class="wallet-mini"><small>Supplier outstanding</small><strong>'+money(supplierDue)+'</strong></div></div><p class="inline-note" style="margin-top:13px">These are operational totals. A fully reconciled statutory profit-and-loss report with complete journal posting, GST treatment and inventory valuation is still required before using this screen for tax filing.</p></div>';
  $("#view").innerHTML=html;refreshIcons();
}
async function renderSettings() {
  setTitle("Settings & backup");
  const [providers,suppliers]=await Promise.all([all("recharge_platforms"),all("suppliers")]);
  $("#view").innerHTML='<div class="page-intro"><div><h2>Settings & tools</h2><p>Manage provider commission, backup and application preferences.</p></div></div><div class="settings-grid">'+
    '<div class="card"><div class="setting-row"><span class="setting-icon">'+icon("radio-tower")+'</span><span class="setting-info"><b>Recharge providers</b><small>'+providers.length+' provider(s). Default and amount-specific commission rules.</small></span><button class="btn btn-secondary btn-sm" data-page="providers">Manage</button></div></div>'+
    '<div class="card"><div class="setting-row"><span class="setting-icon">'+icon("store")+'</span><span class="setting-info"><b>Supplier directory</b><small>'+suppliers.length+' supplier(s), multiple agents per supplier.</small></span><button class="btn btn-secondary btn-sm" data-page="suppliers">Manage</button></div></div>'+
    '<div class="card"><div class="setting-row"><span class="setting-icon">'+icon("database")+'</span><span class="setting-info"><b>Backup & restore</b><small>Export local records to JSON or restore a previous backup.</small></span></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" id="exportBtn">'+icon("download")+' Export backup</button><label class="btn btn-quiet btn-sm">'+icon("upload")+' Restore backup<input type="file" id="restoreFile" accept=".json,application/json" hidden></label></div></div>'+
    '<div class="card"><div class="setting-row"><span class="setting-icon">'+icon("palette")+'</span><span class="setting-info"><b>Appearance</b><small>Switch light and dark theme.</small></span><button class="btn btn-quiet btn-sm" id="themeSetting">Toggle</button></div></div>'+
    '<div class="card"><div class="setting-row"><span class="setting-icon">'+icon("smartphone")+'</span><span class="setting-info"><b>Install application</b><small>Add ERP to phone home screen or desktop.</small></span><button class="btn btn-quiet btn-sm" id="installBtn">Install</button></div></div></div>'+
    '<div class="section-heading"><h2>Important data safety</h2></div><div class="card"><p class="inline-note">All shop data is stored in this browser profile. Export a backup regularly and store it outside the device. Restoring a backup replaces local data. This is a single-device PWA; it does not synchronize to other devices.</p><p class="inline-note">Database schema v3 · Asia/Kolkata · Currency INR.</p></div>';
  bindPageActions();
  $("#exportBtn").onclick=async()=>{try{const data=await exportAll();downloadFile(JSON.stringify(data,null,2),"mobile-shop-erp-backup-"+todayKey()+".json","application/json");toast("Backup downloaded.");}catch(error){toast(error.message);}};
  $("#restoreFile").onchange=async event=>{const file=event.target.files[0];if(!file)return;if(!confirm("Restore replaces existing data in this browser. Continue?")){event.target.value="";return;}try{await restoreAll(JSON.parse(await file.text()));toast("Backup restored.");await render();}catch(error){toast(error.message||"Restore failed.");}};
  $("#themeSetting").onclick=toggleTheme;$("#installBtn").onclick=installApp;refreshIcons();
}
async function renderMore() {
  setTitle("More modules");
  const modules=[
    ["inventory","Products & inventory","Product catalogue, stock alerts","package"],
    ["purchases","Purchases","Line supply, market purchases, payments","truck"],
    ["customers","Customers","Customer details and outstanding","users"],
    ["suppliers","Suppliers","Direct, line and recharge distributors","store"],
    ["agents","Collection agents","Reusable agent contacts","hand-coins"],
    ["collections","Supplier collections","Pay supplier through a linked agent","wallet"],
    ["expenses","Expenses","Shop costs and wages","receipt"],
    ["accounts","Money & day book","Cash, UPI and bank entries","landmark"],
    ["reports","Reports","Daily, weekly, monthly, yearly","chart-no-axes-combined"],
    ["providers","Recharge provider settings","Commission rules and wallets","radio-tower"],
    ["settings","Settings & backup","PWA and data safety","settings"]
  ];
  $("#view").innerHTML='<div class="page-intro"><div><h2>All modules</h2><p>Everything else you need to run the shop.</p></div></div><div class="module-grid">'+modules.map(row=>'<button type="button" class="module-tile" data-page="'+row[0]+'"><span class="module-icon">'+icon(row[3])+'</span><span><b>'+row[1]+'</b><small>'+row[2]+'</small></span></button>').join("")+'</div>';
  bindPageActions();refreshIcons();
}

async function render() {
  renderNav();
  if(current==="home"){setTitle("Overview");$("#view").innerHTML=await renderHome();bindPageActions();}
  else if(current==="more")await renderMore();
  else if(current==="sales")await renderSales();
  else if(current==="inventory")await renderInventory();
  else if(current==="purchases")await renderPurchases();
  else if(current==="repairs")await renderRepairs();
  else if(current==="customers")await renderCustomers();
  else if(current==="suppliers")await renderSuppliers();
  else if(current==="agents")await renderAgents();
  else if(current==="collections")await renderCollections();
  else if(current==="recharge")await renderRecharge();
  else if(current==="providers")await renderProviders();
  else if(current==="expenses"||current==="accounts")await renderSimple(current);
  else if(current==="reports")await renderReports();
  else if(current==="settings")await renderSettings();
  else {current="home";await render();return;}
  refreshIcons();
}

function toggleTheme() {
  document.body.classList.toggle("theme-dark");
  localStorage.setItem("mobile-shop-theme",document.body.classList.contains("theme-dark")?"dark":"light");
  refreshIcons();
}
async function installApp() {
  if(!installPrompt){toast("Use the browser menu → Install app / Add to Home Screen.");return;}
  installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;
}
$("#themeBtn").onclick=toggleTheme;
if(localStorage.getItem("mobile-shop-theme")==="dark")document.body.classList.add("theme-dark");
window.addEventListener("beforeinstallprompt",event=>{event.preventDefault();installPrompt=event;});
if("serviceWorker"in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./sw.js").catch(error=>console.warn("Offline setup:",error)));
render().catch(error=>{console.error(error);$("#view").innerHTML='<div class="card empty-state">Could not open the local database. Reload the app or close other app tabs. '+safe(error.message)+'</div>';});
