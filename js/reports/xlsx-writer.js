/** Minimal write-only OOXML serializer for the fixed annual report.
 * Uses ZIP STORE (no CDN, no executable formulas from user text, no external links).
 * Not a general-purpose spreadsheet editor. Formula results are explicitly cached.
 */
const enc=new TextEncoder();
export function xmlText(value) {return String(value??'').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
export function columnName(n){let s='';for(;n>0;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
export function excelDate(iso){return Math.round((new Date(`${iso}T00:00:00Z`).valueOf()-Date.UTC(1899,11,30))/86400000);}
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let j=0;j<8;j++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function zipStore(files){
  const chunks=[],central=[];let offset=0;
  const u16=(v,n,x)=>v.setUint16(n,x,true),u32=(v,n,x)=>v.setUint32(n,x>>>0,true);
  for(const [path,value] of Object.entries(files)){
    const name=enc.encode(path),bytes=typeof value==='string'?enc.encode(value):value;
    let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);crc=(crc^0xffffffff)>>>0;
    const local=new Uint8Array(30+name.length),v=new DataView(local.buffer);u32(v,0,0x04034b50);u16(v,4,20);u16(v,6,0x0800);u16(v,12,33);u32(v,14,crc);u32(v,18,bytes.length);u32(v,22,bytes.length);u16(v,26,name.length);local.set(name,30);
    chunks.push(local,bytes);
    const c=new Uint8Array(46+name.length),cv=new DataView(c.buffer);u32(cv,0,0x02014b50);u16(cv,4,20);u16(cv,6,20);u16(cv,8,0x0800);u16(cv,14,33);u32(cv,16,crc);u32(cv,20,bytes.length);u32(cv,24,bytes.length);u16(cv,28,name.length);u32(cv,42,offset);c.set(name,46);central.push(c);offset+=local.length+bytes.length;
  }
  const centralSize=central.reduce((s,b)=>s+b.length,0),end=new Uint8Array(22),e=new DataView(end.buffer);u32(e,0,0x06054b50);u16(e,8,central.length);u16(e,10,central.length);u32(e,12,centralSize);u32(e,16,offset);
  const out=new Uint8Array(offset+centralSize+22);let i=0;for(const c of [...chunks,...central,end]){out.set(c,i);i+=c.length;}return out;
}
const XML='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export const XLSX_STYLES={body:0,title:1,subtitle:2,header:3,integer:4,money:5,percent:6,total:7,totalMoney:8,muted:9,warning:10,center:11,date:12,wrap:13,section:14,kpi:15,text:16};
function styles(){
  const font=(size,color,bold=false)=>`<font><sz val="${size}"/><color rgb="FF${color}"/><name val="맑은 고딕"/><family val="2"/>${bold?'<b/>':''}</font>`;
  const fill=c=>`<fill><patternFill patternType="solid"><fgColor rgb="FF${c}"/><bgColor indexed="64"/></patternFill></fill>`;
  const xf=(f=0,fill=0,b=1,num=0,align='left',wrap=false)=>`<xf numFmtId="${num}" fontId="${f}" fillId="${fill}" borderId="${b}" xfId="0" applyNumberFormat="1" applyAlignment="1" applyFont="1" applyFill="1" applyBorder="1"><alignment horizontal="${align}" vertical="center"${wrap?' wrapText="1"':''}/></xf>`;
  const xfs=[xf(),xf(1,2,0,0,'left'),xf(2,0,0),xf(3,2,1,0,'center',true),xf(0,0,1,164,'right'),xf(0,0,1,164,'right'),xf(0,0,1,165,'right'),xf(4,3,1,164,'right'),xf(4,3,1,164,'right'),xf(2,0,0),xf(5,4,0,0,'left',true),xf(0,0,1,0,'center'),xf(0,0,1,166,'center'),xf(0,0,1,0,'left',true),xf(4,3,0,0,'left'),xf(6,3,0,164,'center'),xf(0,0,1,49,'left')];
  return XML+`<styleSheet xmlns="${NS}"><numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0;[Red](#,##0);0"/><numFmt numFmtId="165" formatCode="0.0%"/><numFmt numFmtId="166" formatCode="yyyy-mm-dd"/></numFmts><fonts count="7">${font(10,'14243C')}${font(22,'FFFFFF',true)}${font(9,'627188')}${font(10,'FFFFFF',true)}${font(10,'123B45',true)}${font(9,'9F3412')}${font(23,'087C66',true)}</fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${fill('10213B')}${fill('EAF4F3')}${fill('FFF4E5')}</fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="hair"><color rgb="FFD9E1EA"/></left><right style="hair"><color rgb="FFD9E1EA"/></right><top style="hair"><color rgb="FFD9E1EA"/></top><bottom style="hair"><color rgb="FFD9E1EA"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}
function sheetXml(s){
  const cellXml=(c,r,col)=>{
    if(c===null||c===undefined)return '';
    const o=typeof c==='object'?c:{value:c};const ref=`${columnName(col)}${r}`,style=o.style??(typeof o.value==='number'?4:0);
    if(o.formula!==undefined)return `<c r="${ref}" s="${style}"><f>${xmlText(o.formula.replace(/^=/,''))}</f><v>${Number.isFinite(o.result)?o.result:0}</v></c>`;
    if(typeof o.value==='number'&&Number.isFinite(o.value))return `<c r="${ref}" s="${style}"><v>${o.value}</v></c>`;
    return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xmlText(String(o.value??'').slice(0,32767))}</t></is></c>`;
  };
  const lastCol=columnName(s.widths.length),lastRow=Math.max(s.rows.length,1);const freeze=s.freeze||null;
  return XML+`<worksheet xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${lastCol}${lastRow}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0">${freeze?`<pane xSplit="${freeze.x||0}" ySplit="${freeze.y||0}" topLeftCell="${columnName((freeze.x||0)+1)}${(freeze.y||0)+1}" activePane="${freeze.x?'bottomRight':'bottomLeft'}" state="frozen"/>`:''}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols>${s.widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"${s.hidden?.includes(i+1)?' hidden="1"':''}/>`).join('')}</cols><sheetData>${s.rows.map((row,i)=>`<row r="${i+1}" ht="${s.heights?.[i+1]||20}" customHeight="1">${row.map((c,j)=>cellXml(c,i+1,j+1)).join('')}</row>`).join('')}</sheetData>${s.filter?`<autoFilter ref="${s.filter}"/>`:''}${s.merges?.length?`<mergeCells count="${s.merges.length}">${s.merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`:''}<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.15" footer="0.15"/><pageSetup paperSize="${s.paperSize||9}" orientation="${s.orientation||'landscape'}" fitToWidth="1" fitToHeight="${s.onePage?1:0}"/><headerFooter><oddFooter>${xmlText('&L하나금속 · 제안실적&C&F&R&P / &N')}</oddFooter></headerFooter>${s.logo?'<drawing r:id="rIdLogo"/>':''}</worksheet>`;
}
export function writeXlsx({sheets,title='제안실적',created=new Date().toISOString(),logoBytes}){
  const files={};
  files['[Content_Types].xml']=XML+`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${logoBytes?'<Default Extension="png" ContentType="image/png"/>':''}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${sheets.map((s,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}${logoBytes?'<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>':''}</Types>`;
  files['_rels/.rels']=XML+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>';
  files['docProps/core.xml']=XML+`<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlText(title)}</dc:title><dc:creator>하나금속 제안관리</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date(created).toISOString()}</dcterms:created></cp:coreProperties>`;
  files['xl/workbook.xml']=XML+`<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${sheets.map((s,i)=>`<sheet name="${xmlText(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets><definedNames>${sheets.map((s,i)=>`<definedName name="_xlnm.Print_Area" localSheetId="${i}">${xmlText(`'${s.name.replace(/'/g,"''")}'!$A$1:$${s.printLastCol||columnName(s.widths.length)}$${s.rows.length}`)}</definedName>${s.repeatRows?`<definedName name="_xlnm.Print_Titles" localSheetId="${i}">${xmlText(`'${s.name.replace(/'/g,"''")}'!$1:$${s.repeatRows}`)}</definedName>`:''}`).join('')}</definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
  files['xl/_rels/workbook.xml.rels']=XML+`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  files['xl/styles.xml']=styles();
  sheets.forEach((s,i)=>files[`xl/worksheets/sheet${i+1}.xml`]=sheetXml(s));
  if(logoBytes){
    files['xl/media/logo.png']=logoBytes;
    files['xl/worksheets/_rels/sheet1.xml.rels']=XML+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>';
    files['xl/drawings/_rels/drawing1.xml.rels']=XML+'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.png"/></Relationships>';
    files['xl/drawings/drawing1.xml']=XML+'<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:oneCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>114300</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>76200</xdr:rowOff></xdr:from><xdr:ext cx="1952625" cy="571500"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="하나금속 로고"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>';
  }
  return zipStore(files);
}
