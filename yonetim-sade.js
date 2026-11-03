/* TTK yönetici arayüzü — sadeleştirme 1. Sunucuya istek göndermez. */
(()=>{
'use strict';
if(document.getElementById('ttk-sade-style'))return;
const style=document.createElement('style');style.id='ttk-sade-style';
style.textContent=`
main{max-width:1040px;padding:20px}#onizleme .scroll{overflow:visible}
#tablo{display:block;width:100%;border:0}#tablo thead{display:none}#tablo tbody{display:grid;grid-template-columns:minmax(0,1fr);gap:14px}
#tablo tbody tr{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border:1px solid #405570;border-radius:14px;background:#14233a;padding:14px;gap:14px;scroll-margin-top:130px}
#tablo tbody td{display:block;min-width:0!important;width:100%;border:0;padding:0;overflow-wrap:anywhere}
#tablo tbody td:before{content:attr(data-sade-label);display:block;color:#9fb0c6;font-size:12px;margin-bottom:7px;font-weight:600}
#tablo tbody td:first-child{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;font-size:18px;font-weight:700}
#tablo tbody td:first-child:before{display:none}#tablo td input,#tablo td select{min-width:0!important;max-width:100%;width:100%}
#tablo td.shift-cell{font-size:13px;line-height:1.7}#tablo td .leave-note{font-size:13px}
#tablo tr[data-sade-open="no"] td:not(:first-child){display:none}
.sade-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.sade-toggle{font-size:13px;padding:8px 12px;background:#263d59;color:#fff;border:1px solid #50647d}
.sade-tag{font-size:12px;font-weight:500;color:#cbd5e1}.sade-tag[data-state="included"]{color:#7ce5c6}.sade-tag[data-state="excluded"]{color:#ffd58a}
#sade-tools{position:sticky;top:8px;z-index:10;border:1px solid #49617e;border-radius:14px;padding:14px;background:#17263df5;box-shadow:0 8px 22px #0004;margin:18px 0}
#sade-summary{font-size:17px;font-weight:700;margin-bottom:10px;line-height:1.5}#sade-tools .sade-actions{display:flex;gap:8px;flex-wrap:wrap}
#sade-tools button{font-size:13px;padding:8px 12px}#sade-search{width:100%;margin:10px 0 0;padding:10px}
.sade-help{font-size:13px;color:#cbd5e1;line-height:1.6;margin:10px 0}.sade-focus{outline:2px solid #ffd58a;outline-offset:3px}
#tablo tr.sade-filtered{display:none!important}#onizleme>section{background:#14233a;border:1px solid #344b67;border-radius:14px;padding:18px;margin:20px 0}#onizleme>section h2{margin-top:0}
@media(max-width:620px){main{padding:12px}#tablo tbody tr{grid-template-columns:minmax(0,1fr)}#sade-tools{top:0}.sade-controls{width:100%;justify-content:space-between}}
`;
document.head.append(style);
const preview=document.getElementById('onizleme'),table=document.getElementById('tablo');
if(!preview||!table)return;
const tools=document.createElement('div');tools.id='sade-tools';tools.hidden=true;
const summary=document.createElement('div');summary.id='sade-summary';summary.setAttribute('role','status');summary.setAttribute('aria-live','polite');
const actions=document.createElement('div');actions.className='sade-actions';
function button(text,handler){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=handler;actions.append(b);return b}
const search=document.createElement('input');search.id='sade-search';search.type='search';search.placeholder='Personel ara…';search.setAttribute('aria-label','Personel ara');
const help=document.createElement('p');help.className='sade-help';help.textContent='Kişinin Düzenle düğmesiyle yerleşke, kapsam, badi ve izin alanlarını aç. Kaydetmek yayınlamak değildir. Bu sürüm mevcut ay bilgilerini kendiliğinden getirmez; ilgili düğmeyi kullanmaya devam et.';
tools.append(summary,actions,search,help);table.closest('.scroll').before(tools);
let records=[],pending=false;
const lower=s=>String(s).toLocaleLowerCase('tr-TR');
function text(el,value){if(el.textContent!==value)el.textContent=value}
function open(rec,yes){rec.row.dataset.sadeOpen=yes?'yes':'no';rec.toggle.setAttribute('aria-expanded',String(yes));text(rec.toggle,yes?'Kapat':'Düzenle')}
function applySearch(){const q=lower(search.value.trim());for(const r of records)r.row.classList.toggle('sade-filtered',!lower(r.name).includes(q))}
button('Hepsini aç',()=>{for(const r of records)open(r,true)});
button('Hepsini kapat',()=>{for(const r of records)open(r,false)});
button('Eksik kapsamları göster',()=>{search.value='';applySearch();let first=null;for(const r of records){const missing=!r.scope?.value;open(r,missing);if(missing&&!first)first=r}if(first)first.row.scrollIntoView({behavior:'smooth',block:'start'})});
button('Uyarıdaki kişiye git',()=>{
 const messages=[...preview.querySelectorAll('.warn')].map(el=>el.textContent).join('\n')+'\n'+(document.getElementById('durum')?.textContent||'');
 const found=records.find(r=>messages.includes(r.name+':'));
 if(!found){text(help,'Kişi adına bağlı bir uyarı bulunamadı. Ön kontrol sonucunu veya ilgili kişi kartını incele.');return}
 search.value='';applySearch();for(const r of records)r.row.classList.remove('sade-focus');open(found,true);found.row.classList.add('sade-focus');found.row.scrollIntoView({behavior:'smooth',block:'start'});
});
search.addEventListener('input',applySearch);
function refresh(){
 pending=false;
 const headers=[...table.querySelectorAll('thead th')].map(x=>x.textContent.trim());
 const rows=[...table.querySelectorAll('tbody tr')];
 tools.hidden=preview.hidden||!rows.length;
 if(!rows.length){records=[];return}
 const column=(part)=>headers.findIndex(x=>lower(x).includes(lower(part)));
 const scopeIndex=column('Yayın kapsamı'),siteIndex=column('Yerleşke'),shiftIndex=column('Okunan vardiyalar');
 records=rows.map(row=>{
  const cells=[...row.children].filter(x=>x.tagName==='TD');
  if(!cells.length)return null;
  let rec=row._sadeRecord;
  if(!rec){
   const name=cells[0].textContent.trim();
   const controls=document.createElement('span');controls.className='sade-controls';
   const tag=document.createElement('span');tag.className='sade-tag';
   const toggle=document.createElement('button');toggle.type='button';toggle.className='sade-toggle';toggle.setAttribute('aria-label',name+' bilgilerini aç veya kapat');
   controls.append(tag,toggle);cells[0].append(controls);
   rec={row,name,tag,toggle};row._sadeRecord=rec;toggle.onclick=()=>open(rec,row.dataset.sadeOpen!=='yes');open(rec,false);
  }
  cells.forEach((cell,i)=>{if(cell.dataset.sadeLabel!==headers[i])cell.dataset.sadeLabel=headers[i]||'Bilgi'});
  rec.scope=cells[scopeIndex]?.querySelector('select');
  const site=cells[siteIndex]?.querySelector('select')?.value||'';
  const state=rec.scope?.value||'';
  const status=state==='included'?'Dahil':state==='excluded'?'Kapsam dışı':'Kapsam seçilmedi';
  text(rec.tag,status+(site?' · '+site:''));if(rec.tag.dataset.state!==state)rec.tag.dataset.state=state;
  const shift=cells[shiftIndex];
  if(shift){
   if(shift._sadeOriginal===undefined)shift._sadeOriginal=shift.textContent;
   const externalBlank=site==='Yeni Yerleşke'&&shift._sadeOriginal.trim()==='Vardiya okunamadı';
   text(shift,externalBlank?'Nöbet planlaması Yeni Yerleşke tarafından yapılmaktadır. Bu ekranda nöbet bilgileri gösterilmez.':shift._sadeOriginal);
  }
  return rec;
 }).filter(Boolean);
 const included=records.filter(r=>r.scope?.value==='included').length,excluded=records.filter(r=>r.scope?.value==='excluded').length,unselected=records.length-included-excluded;
 const month=document.getElementById('donem')?.value||'Ay seçilmedi';
 text(summary,month+' · '+records.length+' kişi · '+included+' dahil · '+excluded+' kapsam dışı'+(unselected?' · '+unselected+' seçim bekliyor':''));
 applySearch();
}
function schedule(){if(!pending){pending=true;requestAnimationFrame(refresh)}}
new MutationObserver(schedule).observe(preview,{childList:true,subtree:true});
new MutationObserver(schedule).observe(preview,{attributes:true,attributeFilter:['hidden']});
preview.addEventListener('input',schedule);preview.addEventListener('change',schedule);preview.addEventListener('click',schedule);
refresh();
})();
