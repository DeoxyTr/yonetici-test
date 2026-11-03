const MONTHS = [
  "OCAK", "ŞUBAT", "MART", "NİSAN", "MAYIS", "HAZİRAN",
  "TEMMUZ", "AĞUSTOS", "EYLÜL", "EKİM", "KASIM", "ARALIK"
];
const LABELS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"
];

export function normId(value) {
  return String(value || "").normalize("NFC")
    .replace(/\s+/g, " ").trim()
    .toLocaleUpperCase("tr-TR").replace(/İ/g, "I");
}

export function titleCase(value) {
  return String(value || "").trim().split(/\s+/).map(word => {
    const s = word.toLocaleLowerCase("tr-TR");
    return s.charAt(0).toLocaleUpperCase("tr-TR") + s.slice(1);
  }).join(" ");
}

function findPeriod(text) {
  const re = new RegExp(
    "(" + MONTHS.join("|") + ")\\s+(\\d{4})", "g"
  );
  const periods = new Map();
  for (const match of text.toLocaleUpperCase("tr-TR").matchAll(re)) {
    const p = { y: Number(match[2]), m: MONTHS.indexOf(match[1]) + 1 };
    periods.set(p.y + "-" + p.m, p);
  }
  if (periods.size > 1) {
    throw new Error("Aynı sayfada farklı aylar bulundu.");
  }
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
    if (days.length < 28) continue;
    if (!days.every((d, i) => d === i + 1)) continue;
    if (!days.every((d, i) => i === 0 || cols.get(d) > cols.get(d - 1))) {
      continue;
    }
    if (!best || days.length > best.days.length) {
      best = { cols, days, y: row[0].y };
    }
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
    const text = row.sort((a, b) => a.x - b.x)
      .map(i => i.s).join(" ").toLocaleUpperCase("tr-TR");
    const re = /(V\d+)\s*:\s*(?:SABAH|AKŞAM)?\s*(\d{1,2})[:.](\d{2})\s*(?:[-–—]\s*)?(?:SABAH|AKŞAM)?\s*(\d{1,2})[:.](\d{2})/g;

    for (const match of text.matchAll(re)) {
      const code = match[1];
      const a = Number(match[2]), b = Number(match[3]);
      const c = Number(match[4]), d = Number(match[5]);
      if (a > 23 || c > 23 || b > 59 || d > 59) {
        throw new Error(code + " için geçersiz saat bulundu.");
      }

      const start = a + b / 60;
      let end = c + d / 60;
      if (end <= start) end += 24;
      const pad = n => String(n).padStart(2, "0");
      const label = pad(a) + ":" + pad(b) + " – " + pad(c) + ":" + pad(d);

      if (shifts[code] && shifts[code].t !== label) {
        throw new Error(code + " için farklı saat tanımları bulundu.");
      }
      shifts[code] = { s: start, e: end, t: label, gece: end > 24 };
    }
  }
}

function readPeople(items, header, period, pageNumber, warnings) {
  const { cols, days } = header;
  const width = (cols.get(days.length) - cols.get(1)) / (days.length - 1);
  const firstX = cols.get(1) - width / 2;
  const lastX = cols.get(days.length) + width / 2;
  const expected = new Date(period.y, period.m, 0).getDate();
  if (days.length !== expected) {
    throw new Error(
      "Sayfa " + pageNumber + ": " + expected + " gün bekleniyordu, " +
      days.length + " gün bulundu."
    );
  }

  function dayOf(x) {
    let best = null, distance = Infinity;
    for (const day of days) {
      const delta = Math.abs(cols.get(day) - x);
      if (delta < distance) { best = day; distance = delta; }
    }
    return distance <= width * 0.65 ? best : null;
  }

  const excluded = /ADI\s*SOYADI|TÜRK\s*TARİH\s*KURUMU|NÖBET\s*ÇİZELGESİ|ONAY|İMZA|AÇIKLAMA/i;
  const candidates = items.filter(i =>
    !i.rot && i.x >= 20 && i.x + i.w < firstX + 2 &&
    i.y < header.y - 5 &&
    /[A-ZÇĞİÖŞÜ]{2,}/.test(i.s.toLocaleUpperCase("tr-TR")) &&
    !excluded.test(i.s)
  ).sort((a, b) => b.y - a.y || a.x - b.x);

  const rows = [];
  for (const item of candidates) {
    let row = rows.find(r => Math.abs(r.y - item.y) < 3);
    if (!row) { row = { y: item.y, parts: [] }; rows.push(row); }
    row.parts.push(item);
  }

  const people = [];
  for (const row of rows) {
    const rawName = row.parts.sort((a, b) => a.x - b.x)
      .map(i => i.s).join(" ").replace(/\s+/g, " ").trim();
    if (!rawName) continue;

    const cells = items.filter(i =>
      !i.rot && Math.abs(i.y - row.y) < 5 &&
      i.x >= firstX - 4 && i.x <= lastX
    );
    const schedule = {}, notes = [];

    for (const cell of cells) {
      const tokens = cell.s.split(/\s+/).filter(Boolean);
      if (!tokens.length || !tokens.every(t => /^V\d+$/i.test(t))) {
        notes.push(cell.s);
        continue;
      }
      const step = cell.w / tokens.length;
      tokens.forEach((token, index) => {
        const day = dayOf(cell.x + step * (index + 0.5));
        if (day === null) {
          throw new Error(rawName + ": vardiyanın günü belirlenemedi.");
        }
        if (schedule[day]) {
          throw new Error(rawName + ": " + day + ". günde birden fazla kod var.");
        }
        schedule[day] = token.toUpperCase();
      });
    }

    if (!Object.keys(schedule).length) {
      warnings.push(rawName + ": vardiya okunamadı; PDF ile kontrol edin.");
    }
    if (notes.length) {
      warnings.push(
        rawName + ': "' + notes.join(" / ") +
        '" metni bulundu; otomatik izin kaydına çevrilmedi.'
      );
    }
    people.push({
      id: normId(rawName), name: titleCase(rawName), loc: "",
      s: schedule, notes, sourcePage: pageNumber
    });
  }
  return people;
}

export async function parsePdf(pdfjs, data) {
  const doc = await pdfjs.getDocument({ data, verbosity: 0 }).promise;
  const warnings = [
    "Önizlemeyi orijinal PDF ile karşılaştırmadan yayınlamayın.",
    "Renkler, izin aralıkları ve bölüm adları otomatik doğrulanmaz."
  ];
  const people = [], shifts = {};
  let period = null, schedulePageCount = 0;

  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items = content.items.filter(i => i.str && i.str.trim()).map(i => ({
        s: i.str.trim(), x: i.transform[4], y: i.transform[5],
        w: i.width, rot: Math.abs(i.transform[1]) > 0.01
      }));

      readTimes(items, shifts);
      const header = findHeader(items);
      if (!header) {
        warnings.push(
          "Sayfa " + n + ": gün tablosu bulunamadı; atlanan sayfayı kontrol edin."
        );
        page.cleanup();
        continue;
      }

      const found = findPeriod(items.map(i => i.s).join(" "));
      if (found) {
        if (period && (period.y !== found.y || period.m !== found.m)) {
          throw new Error("PDF içinde farklı aylara ait tablolar var.");
        }
        period = found;
      }
      if (!period) throw new Error("Sayfa " + n + ": ay/yıl bulunamadı.");

      people.push(...readPeople(items, header, period, n, warnings));
      schedulePageCount++;
      page.cleanup();
    }

    if (!period || !people.length) {
      throw new Error("Okunabilir personel çizelgesi bulunamadı.");
    }

    const seen = new Set();
    for (const person of people) {
      if (seen.has(person.id)) {
        warnings.push(person.name + ": tekrarlanan isim; eşleştirmeyi kontrol edin.");
      }
      seen.add(person.id);
      for (const code of new Set(Object.values(person.s))) {
        if (!shifts[code]) {
          warnings.push(person.name + ": " + code + " kodunun saati okunamadı.");
        }
      }
    }

    return {
      month: {
        key: period.y + "-" + String(period.m).padStart(2, "0"),
        y: period.y, m: period.m,
        title: LABELS[period.m - 1] + " " + period.y,
        people, shifts
      },
      warnings: [...new Set(warnings)],
      pageCount: doc.numPages,
      schedulePageCount,
      requiresReview: true
    };
  } finally {
    await doc.destroy();
  }
}
// DOSYA SONU
