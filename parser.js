const MONTHS = [
  "OCAK", "ŞUBAT", "MART", "NİSAN", "MAYIS", "HAZİRAN",
  "TEMMUZ", "AĞUSTOS", "EYLÜL", "EKİM", "KASIM", "ARALIK"
];

const LABELS = [
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
      const s = word.toLocaleLowerCase("tr-TR");
      return s.charAt(0).toLocaleUpperCase("tr-TR") + s.slice(1);
    })
    .join(" ");
}

function findPeriod(text) {
  const re = new RegExp(
    "(" + MONTHS.join("|") + ")\\s+(\\d{4})",
    "g"
  );

  const periods = new Map();

  for (const match of text.toLocaleUpperCase("tr-TR").matchAll(re)) {
    const period = {
      y: Number(match[2]),
      m: MONTHS.indexOf(match[1]) + 1
    };

    periods.set(period.y + "-" + period.m, period);
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

    const day = Number(item.s);
    if (day < 1 || day > 31) continue;

    const y = Math.round(item.y);

    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push(item);
  }

  let best = null;

  for (const row of rows.values()) {
    const cols = new Map(
      row.map(item => [
        Number(item.s),
        item.x + item.w / 2
      ])
    );

    const days = [...cols.keys()].sort((a, b) => a - b);

    if (days.length < 28) continue;
    if (!days.every((day, index) => day === index + 1)) continue;

    const increasing = days.every((day, index) =>
      index === 0 || cols.get(day) > cols.get(day - 1)
    );

    if (!increasing) continue;

    if (!best || days.length > best.days.length) {
      best = {
        cols,
        days,
        y: row[0].y
      };
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
    const text = row
      .sort((a, b) => a.x - b.x)
      .map(item => item.s)
      .join(" ")
      .toLocaleUpperCase("tr-TR");

    const re = /(V\d+)\s*:\s*(?:SABAH|AKŞAM)?\s*(\d{1,2})[:.](\d{2})\s*(?:[-–—]\s*)?(?:SABAH|AKŞAM)?\s*(\d{1,2})[:.](\d{2})/g;

    for (const match of text.matchAll(re)) {
      const code = match[1];
      const a = Number(match[2]);
      const b = Number(match[3]);
      const c = Number(match[4]);
      const d = Number(match[5]);

      if (a > 23 || c > 23 || b > 59 || d > 59) {
        throw new Error(code + " için geçersiz saat bulundu.");
      }

      const start = a + b / 60;
      let end = c + d / 60;

      if (end <= start) end += 24;

      const pad = number => String(number).padStart(2, "0");

      const label =
        pad(a) + ":" + pad(b) +
        " – " +
        pad(c) + ":" + pad(d);

      if (shifts[code] && shifts[code].t !== label) {
        throw new Error(
          code + " için farklı saat tanımları bulundu."
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

function multiply(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5]
  ];
}

function rgb(args) {
  if (typeof args[0] === "string") {
    const match = /^#([0-9a-f]{6})$/i.exec(args[0]);

    if (!match) return null;

    return [0, 2, 4].map(index =>
      parseInt(match[1].slice(index, index + 2), 16)
    );
  }

  const values = Array.from(args)
    .slice(0, 3)
    .map(Number);

  if (
    values.length !== 3 ||
    !values.every(Number.isFinite)
  ) {
    return null;
  }

  return Math.max(...values) <= 1
    ? values.map(value => value * 255)
    : values;
}

async function readYellowRects(pdfjs, page) {
  const { fnArray, argsArray } = await page.getOperatorList();
  const O = pdfjs.OPS;

  let matrix = [1, 0, 0, 1, 0, 0];
  let color = null;
  let points = [];
  let curved = false;

  const stack = [];
  const path = [];
  const rects = [];

  const fills = new Set([
    O.fill,
    O.eoFill,
    O.fillStroke,
    O.eoFillStroke,
    O.closeFillStroke,
    O.closeEOFillStroke
  ].filter(value => value !== undefined));

  const endings = new Set([
    O.stroke,
    O.closeStroke,
    O.endPath
  ].filter(value => value !== undefined));

  function transform(x, y) {
    return [
      matrix[0] * x + matrix[2] * y + matrix[4],
      matrix[1] * x + matrix[3] * y + matrix[5]
    ];
  }

  function finishSubpath() {
    let current = points;
    points = [];

    if (curved) {
      curved = false;
      return;
    }

    if (
      current.length === 5 &&
      Math.hypot(
        current[0][0] - current[4][0],
        current[0][1] - current[4][1]
      ) < 0.1
    ) {
      current = current.slice(0, 4);
    }

    if (current.length !== 4) return;

    const x0 = Math.min(...current.map(point => point[0]));
    const x1 = Math.max(...current.map(point => point[0]));
    const y0 = Math.min(...current.map(point => point[1]));
    const y1 = Math.max(...current.map(point => point[1]));

    if (x1 - x0 <= 2 || y1 - y0 <= 2) return;

    const corners = new Set();

    for (let index = 0; index < 4; index++) {
      const a = current[index];
      const b = current[(index + 1) % 4];

      if (
        Math.abs(a[0] - b[0]) > 0.1 &&
        Math.abs(a[1] - b[1]) > 0.1
      ) {
        return;
      }

      const left = Math.abs(a[0] - x0) < 0.1;
      const right = Math.abs(a[0] - x1) < 0.1;
      const bottom = Math.abs(a[1] - y0) < 0.1;
      const top = Math.abs(a[1] - y1) < 0.1;

      if (!(left || right) || !(bottom || top)) return;

      corners.add(
        (left ? "L" : "R") +
        (bottom ? "B" : "T")
      );
    }

    if (corners.size === 4) {
      path.push({ x0, x1, y0, y1 });
    }
  }

  function command(op, args) {
    if (op === O.rectangle) {
      finishSubpath();

      const [x, y, width, height] = args;

      points = [
        [x, y],
        [x + width, y],
        [x + width, y + height],
        [x, y + height]
      ].map(([a, b]) => transform(a, b));

      finishSubpath();
    } else if (op === O.moveTo) {
      finishSubpath();
      points = [transform(args[0], args[1])];
    } else if (op === O.lineTo) {
      points.push(transform(args[0], args[1]));
    } else if (op === O.closePath) {
      finishSubpath();
    } else if (
      [O.curveTo, O.curveTo2, O.curveTo3].includes(op)
    ) {
      curved = true;
    }
  }

  for (let index = 0; index < fnArray.length; index++) {
    const op = fnArray[index];
    const args = argsArray[index] || [];

    if (op === O.save) {
      stack.push({
        matrix: [...matrix],
        color: color && [...color]
      });
    } else if (op === O.restore) {
      const state = stack.pop();

      if (state) {
        matrix = state.matrix;
        color = state.color;
      }
    } else if (op === O.transform) {
      matrix = multiply(matrix, args);
    } else if (op === O.setFillRGBColor) {
      color = rgb(args);
    } else if (op === O.setFillGray) {
      const gray = Number(args[0]) * 255;
      color = [gray, gray, gray];
    } else if (op === O.setFillCMYKColor) {
      const [c, m, y, k] = Array.from(args).map(Number);

      color = [c, m, y].map(value =>
        255 * (1 - Math.min(1, value + k))
      );
    } else if (
      [
        O.setFillColor,
        O.setFillColorN,
        O.setFillColorSpace
      ].includes(op)
    ) {
      color = null;
    } else if (op === O.constructPath) {
      const commands = args[0];
      const coordinates = args[1];
      let offset = 0;

      for (const sub of commands) {
        let size = 0;

        if (sub === O.rectangle) {
          size = 4;
        } else if (
          sub === O.moveTo ||
          sub === O.lineTo
        ) {
          size = 2;
        } else if (sub === O.curveTo) {
          size = 6;
        } else if (
          sub === O.curveTo2 ||
          sub === O.curveTo3
        ) {
          size = 4;
        } else if (sub !== O.closePath) {
          throw new Error(
            "Desteklenmeyen PDF çizim komutu."
          );
        }

        command(
          sub,
          Array.from(coordinates).slice(
            offset,
            offset + size
          )
        );

        offset += size;
      }
    } else if (
      [
        O.rectangle,
        O.moveTo,
        O.lineTo,
        O.closePath,
        O.curveTo,
        O.curveTo2,
        O.curveTo3
      ].includes(op)
    ) {
      command(op, args);
    } else if (fills.has(op)) {
      finishSubpath();

      if (
        color &&
        color[0] > 220 &&
        color[1] > 220 &&
        color[2] < 100
      ) {
        rects.push(...path);
      }

      path.length = 0;
    } else if (endings.has(op)) {
      points = [];
      curved = false;
      path.length = 0;
    }
  }

  return rects;
}

function readPeople(
  items,
  header,
  period,
  pageNumber,
  warnings,
  yellowRects
) {
  const { cols, days } = header;

  const width =
    (cols.get(days.length) - cols.get(1)) /
    (days.length - 1);

  const firstX = cols.get(1) - width / 2;
  const lastX = cols.get(days.length) + width / 2;

  const expected = new Date(
    period.y,
    period.m,
    0
  ).getDate();

  if (days.length !== expected) {
    throw new Error(
      "Sayfa " + pageNumber + ": " +
      expected + " gün bekleniyordu, " +
      days.length + " gün bulundu."
    );
  }

  function dayOf(x) {
    let best = null;
    let distance = Infinity;

    for (const day of days) {
      const delta = Math.abs(cols.get(day) - x);

      if (delta < distance) {
        best = day;
        distance = delta;
      }
    }

    return distance <= width * 0.65 ? best : null;
  }

  const excluded = /ADI\s*SOYADI|TÜRK\s*TARİH\s*KURUMU|NÖBET\s*ÇİZELGESİ|ONAY|İMZA|AÇIKLAMA/i;

  const candidates = items
    .filter(item =>
      !item.rot &&
      item.x >= 20 &&
      item.x + item.w < firstX + 2 &&
      item.y < header.y - 5 &&
      /[A-ZÇĞİÖŞÜ]{2,}/.test(
        item.s.toLocaleUpperCase("tr-TR")
      ) &&
      !excluded.test(item.s)
    )
    .sort((a, b) =>
      b.y - a.y || a.x - b.x
    );

  const rows = [];

  for (const item of candidates) {
    let row = rows.find(candidate =>
      Math.abs(candidate.y - item.y) < 3
    );

    if (!row) {
      row = {
        y: item.y,
        parts: []
      };

      rows.push(row);
    }

    row.parts.push(item);
  }

  const matched = new Map(
    rows.map(row => [row, []])
  );

  for (const rect of yellowRects) {
    if (
      rect.x1 < firstX ||
      rect.x0 > lastX ||
      rect.y0 >= header.y
    ) {
      continue;
    }

    const owners = rows.filter(row =>
      row.y >= rect.y0 - 1 &&
      row.y <= rect.y1 + 1
    );

    if (
      owners.length !== 1 ||
      rect.x0 < firstX - width * 0.2 ||
      rect.x1 > lastX + width * 0.2
    ) {
      warnings.push(
        "Sayfa " + pageNumber +
        ": bir sarı alan güvenle tek kişiye eşleştirilemedi; " +
        "PDF'yi kontrol edin."
      );

      continue;
    }

    const covered = days.filter(day =>
      cols.get(day) > rect.x0 &&
      cols.get(day) < rect.x1
    );

    matched.get(owners[0]).push(...covered);
  }

  function date(day) {
    return (
      period.y + "-" +
      String(period.m).padStart(2, "0") + "-" +
      String(day).padStart(2, "0")
    );
  }

  const people = [];

  for (const row of rows) {
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
      const tokens = cell.s
        .split(/\s+/)
        .filter(Boolean);

      if (
        !tokens.length ||
        !tokens.every(token => /^V\d+$/i.test(token))
      ) {
        notes.push(cell.s);
        continue;
      }

      const step = cell.w / tokens.length;

      tokens.forEach((token, index) => {
        const day = dayOf(
          cell.x + step * (index + 0.5)
        );

        if (day === null) {
          throw new Error(
            rawName + ": vardiyanın günü belirlenemedi."
          );
        }

        if (schedule[day]) {
          throw new Error(
            rawName + ": " + day +
            ". günde birden fazla kod var."
          );
        }

        schedule[day] = token.toUpperCase();
      });
    }

    const covered = [...new Set(matched.get(row))]
      .sort((a, b) => a - b);

    const ranges = [];

    for (const day of covered) {
      const last = ranges[ranges.length - 1];

      if (last && day === last[1] + 1) {
        last[1] = day;
      } else {
        ranges.push([day, day]);
      }
    }

    const detectedLeaves = ranges.map(([start, end]) => ({
      start: date(start),
      end: date(end),
      source: "pdf-yellow"
    }));

    if (!Object.keys(schedule).length) {
      warnings.push(
        rawName + ": vardiya okunamadı; PDF ile kontrol edin."
      );
    }

    if (detectedLeaves.length > 1) {
      warnings.push(
        rawName +
        ": birden fazla ayrı sarı aralık bulundu; " +
        "tek aralıklı editöre otomatik aktarılmadı."
      );
    }

    if (notes.length) {
      warnings.push(
        rawName + ': "' + notes.join(" / ") +
        '" metni bulundu; açıklamayı sarı alanlarla karşılaştırın. ' +
        "Gün sayısından tarih hesaplanmadı."
      );
    }

    const hasLeaveNote = notes.some(note =>
      /İZ[İI]N/i.test(
        note.toLocaleUpperCase("tr-TR")
      )
    );

    if (hasLeaveNote && !detectedLeaves.length) {
      warnings.push(
        rawName +
        ": izin açıklaması var ancak sarı tarih aralığı " +
        "okunamadı; elle kontrol gerekli."
      );
    }

    people.push({
      id: normId(rawName),
      name: titleCase(rawName),
      loc: "",
      s: schedule,
      notes,
      sourcePage: pageNumber,
      detectedLeaves,
      detectedLeave:
        detectedLeaves.length === 1
          ? detectedLeaves[0]
          : null
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
    "İzin okuyucu sürümü: auto-izin-2 (çizgi yolları desteklenir).",
    "Önizlemeyi orijinal PDF ile karşılaştırmadan yayınlamayın.",
    "Sarı alanlar izin adayı olarak okunur; farklı renkler ve " +
    "taranmış görüntüler otomatik izin tespiti kapsamında değildir. " +
    "Bölüm adları doğrulanmaz."
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

      readTimes(items, shifts);

      const header = findHeader(items);

      if (!header) {
        warnings.push(
          "Sayfa " + pageNumber +
          ": gün tablosu bulunamadı; atlanan sayfayı kontrol edin."
        );

        page.cleanup();
        continue;
      }

      const found = findPeriod(
        items.map(item => item.s).join(" ")
      );

      if (found) {
        if (
          period &&
          (
            period.y !== found.y ||
            period.m !== found.m
          )
        ) {
          throw new Error(
            "PDF içinde farklı aylara ait tablolar var."
          );
        }

        period = found;
      }

      if (!period) {
        throw new Error(
          "Sayfa " + pageNumber + ": ay/yıl bulunamadı."
        );
      }

      let rects = [];

      try {
        rects = await readYellowRects(pdfjs, page);

        warnings.push(
          "Sayfa " + pageNumber + ": " +
          rects.length + " sarı dikdörtgen adayı okundu."
        );
      } catch (error) {
        warnings.push(
          "Sayfa " + pageNumber +
          ": renkli alanlar okunamadı; izinleri elle kontrol edin. " +
          error.message
        );
      }

      people.push(
        ...readPeople(
          items,
          header,
          period,
          pageNumber,
          warnings,
          rects
        )
      );

      schedulePageCount++;
      page.cleanup();
    }

    if (!period || !people.length) {
      throw new Error(
        "Okunabilir personel çizelgesi bulunamadı."
      );
    }

    const seen = new Set();

    for (const person of people) {
      if (seen.has(person.id)) {
        warnings.push(
          person.name +
          ": tekrarlanan isim; eşleştirmeyi kontrol edin."
        );
      }

      seen.add(person.id);

      const codes = new Set(
        Object.values(person.s)
      );

      for (const code of codes) {
        if (!shifts[code]) {
          warnings.push(
            person.name + ": " +
            code + " kodunun saati okunamadı."
          );
        }
      }
    }

    return {
      month: {
        key:
          period.y + "-" +
          String(period.m).padStart(2, "0"),
        y: period.y,
        m: period.m,
        title:
          LABELS[period.m - 1] + " " + period.y,
        people,
        shifts
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

// DOSYA SONU — auto-izin-2
