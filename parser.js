const MONTHS = ["OCAK", "ŞUBAT", "MART", "NİSAN", "MAYIS", "HAZİRAN", "TEMMUZ", "AĞUSTOS", "EYLÜL", "EKİM", "KASIM", "ARALIK"];
const LABELS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

export function normId(value) {
  return String(value || "").normalize("NFC").replace(/\s+/g, " ").trim()
    .toLocaleUpperCase("tr-TR").replace(/İ/g, "I");
}
export function titleCase(value) {
  return String(value || "").trim().split(/\s+/).map(word => {
    const s = word.toLocaleLowerCase("tr-TR");
    return s.charAt(0).toLocaleUpperCase("tr-TR") + s.slice(1);
  }).join(" ");
}
function findPeriod(text) {
  const re = new RegExp("(" + MONTHS.join("|") + ")\\s+(\\d{4})", "g");
  const periods = new Map();
  for (const match of text.toLocaleUpperCase("tr-TR").matchAll(re)) {
    const p = { y: Number(match[2]), m: MONTHS.indexOf(match[1]) + 1 };
    periods.set(p.y + "-" + p.m, p);
  }
  if (periods.size > 1) throw new Error("Aynı sayfada farklı aylar bulundu.");
  return periods.size ? [...periods.values()][0] : null;
}
function findHeader(items) {
  const rows = new Map();
  for (const item of items) {
    if (item.rot || !/^\d{1,2}$/.test(item.s)) continue;
    const d = Number(item.s);
    if (d < 1 || d > 31) continue;
    const y = Math.round(item.y);
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(item);
  }
  let best = null;
  for (const row of rows.values()) {
    const cols = new Map(row.map(i => [Number(i.s), i.x + i.w / 2]));
    const days = [...cols.keys()].sort((a, b) => a - b);
    if (days.length < 28 || !days.every((d, i) => d === i + 1)) continue;
    if (!days.every((d, i) => i === 0 || cols.get(d) > cols.get(d - 1))) continue;
    if (!best || days.length > best.days.length) best = { cols, days, y: row[0].y };
  }
  return best;
}
function readTimes(items, shifts) {
  const rows = new Map();
  for (const item of items) {
    if (item.rot) continue;
    const y = Math.round(item.y);
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(item);
  }
  for (const row of rows.values()) {
    const text = row.sort((a, b) => a.x - b.x).map(i => i.s).join(" ").toLocaleUpperCase("tr-TR");
    const re = /(V\d+)\s*:\s*(?:SABAH|AKŞAM)?\s*(\d{1,2})[:.](\d{2})\s*(?:[-–—]\s*)?(?:SABAH|AKŞAM)?\s*(\d{1,2})[:.](\d{2})/g;
    for (const match of text.matchAll(re)) {
      const code = match[1];
      const a = Number(match[2]), b = Number(match[3]);
      const c = Number(match[4]), d = Number(match[5]);
      if (a > 23 || c > 23 || b > 59 || d > 59) throw new Error(code + " için geçersiz saat bulundu.");
      const start = a + b / 60;
      let end = c + d / 60;
      if (end <= start) end += 24;
      const pad = n => String(n).padStart(2, "0");
      const label = pad(a) + ":" + pad(b) + " – " + pad(c) + ":" + pad(d);
      if (shifts[code] && shifts[code].t !== label) throw new Error(code + " için farklı saat tanımları bulundu.");
      shifts[code] = { s: start, e: end, t: label, gece: end > 24 };
    }
  }
}
function multiply(a, b) {
  return [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
    a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
    a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
}
function rgb(args) {
  if (typeof args[0] === "string") {
    const m = /^#([0-9a-f]{6})$/i.exec(args[0]);
    return m ? [0,2,4].map(i => parseInt(m[1].slice(i,i+2),16)) : null;
  }
  const v = Array.from(args).slice(0,3).map(Number);
  if (v.length !== 3 || !v.every(Number.isFinite)) return null;
  return Math.max(...v) <= 1 ? v.map(n => n*255) : v;
}
async function readYellowRects(pdfjs, page) {
  const { fnArray, argsArray } = await page.getOperatorList();
  const O = pdfjs.OPS;
  let matrix = [1,0,0,1,0,0], color = null;
  const stack = [], path = [], rects = [];
  const fills = new Set([O.fill, O.eoFill, O.fillStroke, O.eoFillStroke,
    O.closeFillStroke, O.closeEOFillStroke].filter(v => v !== undefined));
  const endings = new Set([O.stroke, O.closeStroke, O.endPath].filter(v => v !== undefined));
  function addRect(x, y, w, h) {
    const pts = [[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(([a,b]) =>
      [matrix[0]*a+matrix[2]*b+matrix[4], matrix[1]*a+matrix[3]*b+matrix[5]]);
    const axisAligned = pts.every((p,i) => {
      const q = pts[(i+1)%4];
      return Math.abs(p[0]-q[0]) < 0.1 || Math.abs(p[1]-q[1]) < 0.1;
    });
    if (!axisAligned) return;
    path.push({ x0: Math.min(...pts.map(p=>p[0])), x1: Math.max(...pts.map(p=>p[0])),
      y0: Math.min(...pts.map(p=>p[1])), y1: Math.max(...pts.map(p=>p[1])) });
  }
  for (let i = 0; i < fnArray.length; i++) {
    const op = fnArray[i], a = argsArray[i] || [];
    if (op === O.save) stack.push({ matrix: [...matrix], color: color && [...color] });
    else if (op === O.restore) {
      const state = stack.pop();
      if (state) { matrix = state.matrix; color = state.color; }
    } else if (op === O.transform) matrix = multiply(matrix, a);
    else if (op === O.setFillRGBColor) color = rgb(a);
    else if (op === O.setFillGray) color = [Number(a[0])*255,Number(a[0])*255,Number(a[0])*255];
    else if (op === O.setFillCMYKColor) {
      const [c,m,y,k] = a.map(Number);
      color = [c,m,y].map(v => 255*(1-Math.min(1,v+k)));
    } else if ([O.setFillColor, O.setFillColorN, O.setFillColorSpace].includes(op)) color = null;
    else if (op === O.rectangle) addRect(...a);
    else if (op === O.constructPath) {
      const ops = a[0], coords = a[1];
      let offset = 0;
      for (const command of ops) {
        if (command === O.rectangle) {
          addRect(...Array.from(coords).slice(offset, offset+4)); offset += 4;
        } else if (command === O.moveTo || command === O.lineTo) offset += 2;
        else if (command === O.curveTo) offset += 6;
        else if (command === O.curveTo2 || command === O.curveTo3) offset += 4;
        else if (command !== O.closePath) throw new Error("Desteklenmeyen PDF çizim komutu.");
      }
    } else if (fills.has(op)) {
      if (color && color[0] > 220 && color[1] > 220 && color[2] < 100) rects.push(...path);
      path.length = 0;
    } else if (endings.has(op)) path.length = 0;
  }
  return rects.filter(r => r.x1-r.x0 > 2 && r.y1-r.y0 > 2);
}
function readPeople(items, header, period, pageNumber, warnings, yellowRects) {
  const { cols, days } = header;
  const width = (cols.get(days.length)-cols.get(1))/(days.length-1);
  const firstX = cols.get(1)-width/2, lastX = cols.get(days.length)+width/2;
  const expected = new Date(period.y,period.m,0).getDate();
  if (days.length !== expected) throw new Error("Sayfa " + pageNumber + ": " + expected + " gün bekleniyordu, " + days.length + " gün bulundu.");
  function dayOf(x) {
    let best = null, distance = Infinity;
    for (const day of days) {
      const delta = Math.abs(cols.get(day)-x);
      if (delta < distance) { best = day; distance = delta; }
    }
    return distance <= width*0.65 ? best : null;
  }
  const excluded = /ADI\s*SOYADI|TÜRK\s*TARİH\s*KURUMU|NÖBET\s*ÇİZELGESİ|ONAY|İMZA|AÇIKLAMA/i;
  const candidates = items.filter(i => !i.rot && i.x >= 20 && i.x+i.w < firstX+2 &&
    i.y < header.y-5 && /[A-ZÇĞİÖŞÜ]{2,}/.test(i.s.toLocaleUpperCase("tr-TR")) && !excluded.test(i.s))
    .sort((a,b)=>b.y-a.y || a.x-b.x);
  const rows = [];
  for (const item of candidates) {
    let row = rows.find(r=>Math.abs(r.y-item.y)<3);
    if (!row) { row = {y:item.y,parts:[]}; rows.push(row); }
    row.parts.push(item);
  }
  const matched = new Map(rows.map(r=>[r,[]]));
  for (const rect of yellowRects) {
    if (rect.x1 < firstX || rect.x0 > lastX || rect.y0 >= header.y) continue;
    const owners = rows.filter(r=>r.y >= rect.y0-1 && r.y <= rect.y1+1);
    if (owners.length !== 1 || rect.x0 < firstX-width*0.2 || rect.x1 > lastX+width*0.2) {
      warnings.push("Sayfa " + pageNumber + ": bir sarı alan güvenle tek kişiye eşleştirilemedi; PDF'yi kontrol edin.");
      continue;
    }
    const covered = days.filter(d=>cols.get(d)>rect.x0 && cols.get(d)<rect.x1);
    if (covered.length) matched.get(owners[0]).push(...covered);
  }
  const date = d => period.y + "-" + String(period.m).padStart(2,"0") + "-" + String(d).padStart(2,"0");
  const people = [];
  for (const row of rows) {
    const rawName = row.parts.sort((a,b)=>a.x-b.x).map(i=>i.s).join(" ").replace(/\s+/g," ").trim();
    if (!rawName) continue;
    const cells = items.filter(i=>!i.rot && Math.abs(i.y-row.y)<5 && i.x>=firstX-4 && i.x<=lastX);
    const schedule = {}, notes = [];
    for (const cell of cells) {
      const tokens = cell.s.split(/\s+/).filter(Boolean);
      if (!tokens.length || !tokens.every(t=>/^V\d+$/i.test(t))) { notes.push(cell.s); continue; }
      const step = cell.w/tokens.length;
      tokens.forEach((token,index)=>{
        const day = dayOf(cell.x+step*(index+0.5));
        if (day === null) throw new Error(rawName + ": vardiyanın günü belirlenemedi.");
        if (schedule[day]) throw new Error(rawName + ": " + day + ". günde birden fazla kod var.");
        schedule[day] = token.toUpperCase();
      });
    }
    const covered = [...new Set(matched.get(row))].sort((a,b)=>a-b);
    const ranges = [];
    for (const day of covered) {
      const last = ranges[ranges.length-1];
      if (last && day === last[1]+1) last[1] = day;
      else ranges.push([day,day]);
    }
    const detectedLeaves = ranges.map(([a,b])=>({start:date(a),end:date(b),source:"pdf-yellow"}));
    if (!Object.keys(schedule).length) warnings.push(rawName + ": vardiya okunamadı; PDF ile kontrol edin.");
    if (detectedLeaves.length > 1) warnings.push(rawName + ": birden fazla ayrı sarı aralık bulundu; tek aralıklı editöre otomatik aktarılmadı.");
    if (notes.length) warnings.push(rawName + ': "' + notes.join(" / ") + '" metni bulundu; açıklamayı sarı alanlarla karşılaştırın. Gün sayısından tarih hesaplanmadı.');
    if (notes.some(n=>/İZ[İI]N/i.test(n.toLocaleUpperCase("tr-TR"))) && !detectedLeaves.length)
      warnings.push(rawName + ": izin açıklaması var ancak sarı tarih aralığı okunamadı; elle kontrol gerekli.");
    people.push({id:normId(rawName),name:titleCase(rawName),loc:"",s:schedule,notes,sourcePage:pageNumber,
      detectedLeaves,detectedLeave:detectedLeaves.length===1?detectedLeaves[0]:null});
  }
  return people;
}
export async function parsePdf(pdfjs,data) {
  const doc = await pdfjs.getDocument({data,verbosity:0}).promise;
  const warnings = ["Önizlemeyi orijinal PDF ile karşılaştırmadan yayınlamayın.",
    "Sarı dikdörtgenler izin adayı olarak okunur; farklı renkler ve taranmış görüntüler otomatik izin tespiti kapsamında değildir. Bölüm adları doğrulanmaz."];
  const people = [], shifts = {};
  let period = null, schedulePageCount = 0;
  try {
    for (let n=1;n<=doc.numPages;n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items = content.items.filter(i=>i.str && i.str.trim()).map(i=>({s:i.str.trim(),x:i.transform[4],y:i.transform[5],w:i.width,rot:Math.abs(i.transform[1])>0.01}));
      readTimes(items,shifts);
      const header = findHeader(items);
      if (!header) { warnings.push("Sayfa " + n + ": gün tablosu bulunamadı; atlanan sayfayı kontrol edin."); page.cleanup(); continue; }
      const found = findPeriod(items.map(i=>i.s).join(" "));
      if (found) {
        if (period && (period.y!==found.y || period.m!==found.m)) throw new Error("PDF içinde farklı aylara ait tablolar var.");
        period = found;
      }
      if (!period) throw new Error("Sayfa " + n + ": ay/yıl bulunamadı.");
      let rects = [];
      try { rects = await readYellowRects(pdfjs,page); }
      catch (error) { warnings.push("Sayfa " + n + ": renkli alanlar okunamadı; izinleri elle kontrol edin. " + error.message); }
      people.push(...readPeople(items,header,period,n,warnings,rects));
      schedulePageCount++;
      page.cleanup();
    }
    if (!period || !people.length) throw new Error("Okunabilir personel çizelgesi bulunamadı.");
    const seen = new Set();
    for (const person of people) {
      if (seen.has(person.id)) warnings.push(person.name + ": tekrarlanan isim; eşleştirmeyi kontrol edin.");
      seen.add(person.id);
      for (const code of new Set(Object.values(person.s))) if (!shifts[code]) warnings.push(person.name + ": " + code + " kodunun saati okunamadı.");
    }
    return {month:{key:period.y+"-"+String(period.m).padStart(2,"0"),y:period.y,m:period.m,
      title:LABELS[period.m-1]+" "+period.y,people,shifts},warnings:[...new Set(warnings)],pageCount:doc.numPages,schedulePageCount,requiresReview:true};
  } finally { await doc.destroy(); }
}
