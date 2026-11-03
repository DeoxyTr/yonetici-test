const MONTHS = [
  "OCAK", "ŞUBAT", "MART", "NİSAN", "MAYIS", "HAZİRAN",
  "TEMMUZ", "AĞUSTOS", "EYLÜL", "EKİM", "KASIM", "ARALIK"
];

const MONTH_LABELS = [
  "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran",
  "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"
];

export function normId(value) {
  return String(value || "")
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("tr-TR")
    .replace(/İ/g, "I");
}

export function titleCase(value) {
  return String(value || "")
    .trim()
    .split(/\s+/)
    .map(word => {
      const lower = word.toLocaleLowerCase("tr-TR");
      return lower.charAt(0).toLocaleUpperCase("tr-TR")
        + lower.slice(1);
    })
    .join(" ");
}

function findPeriod(text) {
  const pattern = new RegExp(
    "(" + MONTHS.join("|") + ")\\s+(\\d{4})",
    "g"
  );

  const found = Array.from(
    text.toLocaleUpperCase("tr-TR").matchAll(pattern)
  ).map(match => ({
    y: Number(match[2]),
    m: MONTHS.indexOf(match[1]) + 1
  }));

  const unique = new Map(
    found.map(p => [p.y + "-" + p.m, p])
  );

  if (unique.size > 1) {
    throw new Error(
      "Aynı sayfada birden fazla ay/yıl bulundu. " +
      "Bu PDF otomatik olarak işlenemez."
    );
  }

  return unique.size ? Array.from(unique.values())[0] : null;
}

function findDayHeader(items) {
  const groups = new Map();

  for (const item of items) {
    if (item.rot || !/^\d{1,2}$/.test(item.s)) continue;
    const day = Number(item.s);
    if (day < 1 || day > 31) continue;

    const key = Math.round(item.y);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  let best = null;

  for (const row of groups.values()) {
    const columns = new Map();

    for (const item of row) {
      columns.set(Number(item.s), item.x + item.w / 2);
    }

    if (!columns.has(1) || columns.size < 28) continue;

    const days = Array.from(columns.keys()).sort((a, b) => a - b);
    const consecutive = days.every((day, index) => day === index + 1);
    const ordered = days.every((day, index) =>
      index === 0 ||
      columns.get(day) > columns.get(days[index - 1])
    );

    if (!consecutive || !ordered) continue;

    if (!best || columns.size > best.columns.size) {
      best = {
        columns,
        days,
        y: row[0].y
      };
    }
  }

  return best;
}

function readShiftTimes(items, shifts, warnings, pageNumber) {
  for (const item of items) {
    const pattern =
          const pattern =
      /(V\d+)\s*:\s*(?:SABAH|AKŞAM)?\s*(\d{1,2})[:.](\d{2})\s*(?:[-–—]\s*)?(?:SABAH|AKŞAM)?\s*(\d{1,2})[:.](\d{2})/gi;

    for (const match of item.s.matchAll(pattern)) {
      const code = match[1].toUpperCase();
      const startHour = Number(match[2]);
      const startMinute = Number(match[3]);
      const endHour = Number(match[4]);
      const endMinute = Number(match[5]);

      if (
        startHour > 23 || endHour > 23 ||
        startMinute > 59 || endMinute > 59
      ) {
        warnings.push(
          `Sayfa ${pageNumber}: ${code} saatleri geçerli değil.`
        );
        continue;
      }

      const start = startHour + startMinute / 60;
      let end = endHour + endMinute / 60;
      if (end <= start) end += 24;

      const label =
        String(startHour).padStart(2, "0") + ":" +
        String(startMinute).padStart(2, "0") + " – " +
        String(endHour).padStart(2, "0") + ":" +
        String(endMinute).padStart(2, "0");

      if (shifts[code] && shifts[code].t !== label) {
        throw new Error(
          `${code} için farklı saat tanımları bulundu. ` +
          "PDF elle kontrol edilmeli."
        );
      }

      shifts[code] = {
        s: start,
        e: end,
        t: label,
        gece: end > 24
      };
    }
  }
}

function readPeople(items, header, period, pageNumber, warnings) {
  const columns = header.columns;
  const days = header.days;
  const firstCenter = columns.get(days[0]);
  const lastCenter = columns.get(days[days.length - 1]);
  const width = (lastCenter - firstCenter) / (days.length - 1);
  const firstX = firstCenter - width / 2;
  const lastX = lastCenter + width / 2;
  const expectedDays = new Date(period.y, period.m, 0).getDate();

  if (days.length !== expectedDays) {
    throw new Error(
      `Sayfa ${pageNumber}: ${days.length} gün sütunu bulundu; ` +
      `${expectedDays} gün bekleniyordu.`
    );
  }

  const dayOf = x => {
    let result = null;
    let distance = Infinity;

    for (const day of days) {
      const current = Math.abs(columns.get(day) - x);
      if (current < distance) {
        distance = current;
        result = day;
      }
    }

    return distance <= width * 0.65 ? result : null;
  };

  const excluded =
    /ADI\s*SOYADI|TÜRK\s*TARİH\s*KURUMU|NÖBET\s*ÇİZELGESİ|ONAY|İMZA|AÇIKLAMA/i;

  const candidates = items.filter(item =>
    !item.rot &&
    item.x >= 20 &&
    item.x + item.w < firstX + 2 &&
    item.y < header.y - 5 &&
    /[A-ZÇĞİÖŞÜ]{2,}/.test(
      item.s.toLocaleUpperCase("tr-TR")
    ) &&
    !excluded.test(item.s)
  );

  const nameRows = [];

  for (const item of candidates.sort((a, b) => b.y - a.y || a.x - b.x)) {
    let row = nameRows.find(r => Math.abs(r.y - item.y) < 3);
    if (!row) {
      row = { y: item.y, parts: [] };
      nameRows.push(row);
    }
    row.parts.push(item);
  }

  const people = [];

  for (const row of nameRows) {
    const rawName = row.parts
      .sort((a, b) => a.x - b.x)
      .map(item => item.s)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    if (!rawName) continue;

    const cells = items.filter(item =>
      !item.rot &&
      Math.abs(item.y - row.y) < 5 &&
      item.x >= firstX - 4 &&
      item.x <= lastX
    );

    const schedule = {};
    const notes = [];

    for (const cell of cells) {
      const tokens = cell.s.split(/\s+/).filter(Boolean);

      if (tokens.length && tokens.every(t => /^V\d+$/i.test(t))) {
        const tokenWidth = cell.w / tokens.length;

        tokens.forEach((token, index) => {
          const day = dayOf(
            cell.x + tokenWidth * (index + 0.5)
          );

          if (day === null) {
            throw new Error(
                            `${rawName}: bir vardiya gün sütununa yerleştirilemedi.`
            );
          }

          const code = token.toUpperCase();

          if (schedule[day]) {
            throw new Error(
              `${rawName}: ${day}. günde birden fazla kod bulundu.`
            );
          }

          schedule[day] = code;
        });
      } else {
        notes.push(cell.s);
      }
    }

    if (!Object.keys(schedule).length) {
      warnings.push(
        `Sayfa ${pageNumber}: "${rawName}" için vardiya okunamadı. ` +
        "Personel satırı mı, not/imza mı kontrol edilmeli."
      );
    }

    if (notes.length) {
      warnings.push(
        `${rawName}: ayrıca "${notes.join(" / ")}" metni bulundu. ` +
        "Bu metin otomatik nöbet veya izin kaydına çevrilmedi."
      );
    }

    people.push({
      id: normId(rawName),
      name: titleCase(rawName),
      loc: "",
      s: schedule,
      notes,
      sourcePage: pageNumber
    });
  }

  return people;
}

export async function parsePdf(pdfjs, data) {
  const doc = await pdfjs.getDocument({
    data,
    verbosity: 0
  }).promise;

  const warnings = [
    "Önizlemeyi PDF ile karşılaştırmadan yayınlamayın.",
    "Renkler, izin aralıkları ve bölüm adları bu sürümde " +
    "otomatik doğrulanmaz."
  ];

  const people = [];
  const shifts = {};
  let period = null;
  let schedulePageCount = 0;

  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();

      const items = content.items
        .filter(item => item.str && item.str.trim())
        .map(item => ({
          s: item.str.trim(),
          x: item.transform[4],
          y: item.transform[5],
          w: item.width,
          rot: Math.abs(item.transform[1]) > 0.01
        }));

      readShiftTimes(items, shifts, warnings, pageNumber);

      const header = findDayHeader(items);

      if (!header) {
        warnings.push(
          `Sayfa ${pageNumber}: gün tablosu bulunamadı, ` +
          "sayfa atlandı. Nöbet içerip içermediğini kontrol edin."
        );
        continue;
      }

      const pagePeriod = findPeriod(
        items.map(item => item.s).join(" ")
      );

      if (pagePeriod) {
        if (
          period &&
          (period.y !== pagePeriod.y || period.m !== pagePeriod.m)
        ) {
          throw new Error(
            "PDF içinde farklı aylara ait çizelgeler bulundu. " +
            "Her ayı ayrı yükleyin."
          );
        }
        period = pagePeriod;
      }

      if (!period) {
        throw new Error(
          `Sayfa ${pageNumber}: ay/yıl bulunamadı.`
        );
      }

      const pagePeople = readPeople(
        items, header, period, pageNumber, warnings
      );

      people.push(...pagePeople);
      schedulePageCount++;
      page.cleanup();
    }

    if (!period || !people.length) {
      throw new Error(
        "Okunabilir personel çizelgesi bulunamadı. " +
        "Taranmış görüntü PDF veya farklı tablo düzeni olabilir."
      );
    }

    const seen = new Set();

    for (const person of people) {
      if (seen.has(person.id)) {
        warnings.push(
          `"${person.name}" birden fazla kez bulundu. ` +
          "Bu satırlar otomatik birleştirilmedi; eşleştirme kontrolü gerekli."
        );
      }

      seen.add(person.id);

      for (const code of new Set(Object.values(person.s))) {
        if (!shifts[code]) {
          warnings.push(
            `${person.name}: ${code} kodunun saati okunamadı.`
          );
        }
      }
    }

    return {
      month: {
        key: `${period.y}-${String(period.m).padStart(2, "0")}`,
        y: period.y,
        m: period.m,
        title: `${MONTH_LABELS[period.m - 1]} ${period.y}`,
        people,
        shifts
      },
      warnings: Array.from(new Set(warnings)),
      pageCount: doc.numPages,
      schedulePageCount,
      requiresReview: true
    };
  } finally {
    await doc.destroy();
  }
}
