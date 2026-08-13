function clean(value) {
  return String(value ?? '').trim();
}

export function normalizeEmployeeImportRows(rows = []) {
  const normalized = rows
    .map((row) => ({
      employee_no: clean(row.employee_no),
      name: clean(row.name),
      department: clean(row.department),
      active: row.active !== false,
    }))
    .filter((row) => row.name && row.department);

  const byKey = new Map();
  for (const row of normalized) {
    const key = row.employee_no ? `no:${row.employee_no}` : `nameDept:${row.name}|${row.department}`;
    byKey.set(key, row);
  }
  return [...byKey.values()];
}

export function mergeEmployeeRoster(currentRows = [], incomingRows = []) {
  const current = (currentRows || []).map((row) => ({ ...row, active: false }));
  const incoming = normalizeEmployeeImportRows(incomingRows);
  const incomingNameCount = new Map();
  for (const row of incoming) incomingNameCount.set(row.name, (incomingNameCount.get(row.name) || 0) + 1);

  for (const row of incoming) {
    let targetIndex = -1;
    if (row.employee_no) {
      targetIndex = current.findIndex((item) => clean(item.employee_no) === row.employee_no);
    } else if ((incomingNameCount.get(row.name) || 0) === 1) {
      const sameName = current
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => clean(item.name) === row.name);
      const exact = sameName.find(({ item }) => clean(item.department) === row.department);
      targetIndex = exact?.index ?? sameName[0]?.index ?? -1;
    } else {
      targetIndex = current.findIndex(
        (item) => clean(item.name) === row.name && clean(item.department) === row.department,
      );
    }

    if (targetIndex >= 0) {
      current[targetIndex] = { ...current[targetIndex], ...row, active: true };
      // if employee_no identifies a person, older duplicates become inactive
      if (row.employee_no) {
        current.forEach((item, index) => {
          if (index !== targetIndex && clean(item.employee_no) === row.employee_no) item.active = false;
        });
      } else if ((incomingNameCount.get(row.name) || 0) === 1) {
        current.forEach((item, index) => {
          if (index !== targetIndex && clean(item.name) === row.name) item.active = false;
        });
      }
    } else {
      current.push({ ...row, active: true });
    }
  }

  return current;
}
