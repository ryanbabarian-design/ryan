import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportXlsx } from '../js/reports/report-xlsx.js';
import { makeLayoutReport } from './fixtures/report-layout-fixture.js';

function workbookParts(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decode = new TextDecoder();
  const parts = new Map();
  let offset = 0;
  while (view.getUint32(offset, true) === 0x04034b50) {
    assert.equal(view.getUint16(offset + 8, true), 0, 'The report writer emits stored ZIP entries');
    const size = view.getUint32(offset + 18, true);
    const nameSize = view.getUint16(offset + 26, true);
    const extraSize = view.getUint16(offset + 28, true);
    const start = offset + 30 + nameSize + extraSize;
    const name = decode.decode(bytes.subarray(offset + 30, offset + 30 + nameSize));
    parts.set(name, decode.decode(bytes.subarray(start, start + size)));
    offset = start + size;
  }
  return parts;
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w:]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]));
}

function xmlValue(value = '') {
  return value.replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

function cells(sheet) {
  return new Map([...sheet.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)].map(([, tag, body]) => {
    const { r: ref } = attributes(tag);
    return [ref, {
      value: body.includes('<is>') ? xmlValue(body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/)?.[1]) : Number(body.match(/<v>(.*?)<\/v>/)?.[1]),
      formula: body.includes('<f>') ? xmlValue(body.match(/<f>([\s\S]*?)<\/f>/)[1]) : undefined,
    }];
  }));
}

test('the downloaded workbook prints all four worksheets in landscape', () => {
  const parts = workbookParts(buildReportXlsx(makeLayoutReport()));
  const sheets = [1, 2, 3, 4].map(n => parts.get(`xl/worksheets/sheet${n}.xml`));
  for (const [index, sheet] of sheets.entries()) {
    assert.ok(sheet, `Worksheet ${index + 1} must be present`);
    const setup = attributes(sheet.match(/<pageSetup\b[^>]*\/>/)[0]);
    assert.equal(setup.orientation, 'landscape', `Worksheet ${index + 1} print orientation`);
    assert.equal(setup.paperSize, index === 0 ? '9' : '8', 'Keep A4 summary and A3 detail sheets');
  }
});

test('the summary shows every department in paired panels with its own linked figures', () => {
  const report = makeLayoutReport();
  const sheet = workbookParts(buildReportXlsx(report)).get('xl/worksheets/sheet1.xml');
  const data = cells(sheet);
  const departmentRows = new Set();
  for (const department of report.departments) {
    const matches = [...data].filter(([, cell]) => cell.value === department.department);
    assert.equal(matches.length, 1, `${department.department} must appear once on the cover`);
    departmentRows.add(Number(matches[0][0].match(/\d+/)[0]));
  }
  assert.ok(departmentRows.size <= 10, 'Nineteen departments fit in two ten-row panels');
  assert.equal([...data.values()].some(cell => /^기타 \d+개 부서$/.test(cell.value)), false);
  for (const [name, sourceRow, award] of [
    ['제조01부', 7, 10000],
    ['제조10부', 16, 0],
    ['제조11부', 17, 0],
    ['제조19부', 25, 190000],
  ]) {
    const [ref] = [...data].find(([, cell]) => cell.value === name);
    const [, column, row] = ref.match(/^([A-Z]+)(\d+)$/);
    assert.ok(['A', 'J'].includes(column), 'Each panel has a separate department column');
    const amount = data.get(`${column === 'A' ? 'H' : 'Q'}${row}`);
    assert.deepEqual(amount, { formula: `'부서별 실적'!P${sourceRow}`, value: award });
  }
  const [totalRef] = [...data].find(([, cell]) => cell.value === '전체 합계');
  const totalRow = totalRef.match(/\d+/)[0];
  assert.deepEqual(data.get(`H${totalRow}`), { formula: "'부서별 실적'!P26", value: 400000 });
});

test('long reports keep one-page width and repeat only the department headings on later cover pages', () => {
  const parts = workbookParts(buildReportXlsx(makeLayoutReport(61)));
  for (let index = 1; index <= 4; index++) {
    const setup = attributes(parts.get(`xl/worksheets/sheet${index}.xml`).match(/<pageSetup\b[^>]*\/>/)[0]);
    assert.equal(setup.fitToWidth, '1', `Worksheet ${index} fits the printable page width`);
    assert.equal(setup.fitToHeight, '0', `Worksheet ${index} may continue onto more pages`);
  }
  const summary = cells(parts.get('xl/worksheets/sheet1.xml'));
  const [headerRef] = [...summary].find(([, cell]) => cell.value === '접수부서');
  const headerRow = headerRef.match(/\d+/)[0];
  const names = [...parts.get('xl/workbook.xml').matchAll(/<definedName\b([^>]*)>(.*?)<\/definedName>/g)];
  const title = names.find(([, tag]) => {
    const attrs = attributes(tag);
    return attrs.name === '_xlnm.Print_Titles' && attrs.localSheetId === '0';
  });
  assert.ok(title, 'The cover repeats its department headings when it spans pages');
  assert.equal(xmlValue(title[2]), `'관리부 제출요약'!$${headerRow}:$${headerRow}`);
});

test('the exported totals retain their calculation formulas and cached financial values', () => {
  const parts = workbookParts(buildReportXlsx(makeLayoutReport()));
  const personal = cells(parts.get('xl/worksheets/sheet2.xml'));
  const department = cells(parts.get('xl/worksheets/sheet3.xml'));
  const detail = cells(parts.get('xl/worksheets/sheet4.xml'));
  assert.deepEqual(personal.get('R45'), { formula: 'SUM(R7:R44)', value: 19 });
  assert.deepEqual(personal.get('U45'), { formula: 'SUM(U7:U44)', value: 7 });
  assert.deepEqual(personal.get('Z45'), { formula: 'SUM(Z7:Z44)', value: 400000 });
  assert.deepEqual(personal.get('AA45'), { formula: 'SUM(AA7:AA44)', value: 140000 });
  assert.deepEqual(department.get('F26'), { formula: 'SUM(F7:F25)', value: 19 });
  assert.deepEqual(department.get('P26'), { formula: 'SUM(P7:P25)', value: 400000 });
  assert.deepEqual(detail.get('P26'), { formula: 'SUM(P7:P25)', value: 400000 });
  assert.deepEqual(detail.get('R26'), { formula: 'SUM(R7:R25)', value: 29700 });
});
