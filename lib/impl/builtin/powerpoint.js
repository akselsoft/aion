const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');
const { resolveConfigPath } = require('../../utils/paths');

module.exports = {
  async run(ctx, engineCfg, personaCfg) {
    const projectRoot = personaCfg.__projectRoot || process.cwd();
    const inputType = engineCfg.inputType;
    if (!inputType) throw new Error('powerpoint responder: inputType is required');

    const items = Array.isArray(ctx.passedFiles) ? ctx.passedFiles : [];
    const selected = items.filter(item => item.type === inputType);
    if (!selected.length) {
      console.warn(`⚠️ powerpoint responder skipped: no passedFiles with type="${inputType}".`);
      return;
    }

    const title = engineCfg.title || engineCfg.presentationTitle || inputType;
    const subtitle = engineCfg.subtitle || formatDate(new Date());
    const slides = buildSlides(selected);
    if (!slides.length) {
      console.warn('⚠️ powerpoint responder skipped: no slide content found.');
      return;
    }

    const filename = engineCfg.filename || `${inputType}.pptx`;
    const outPath = resolveOutputPath(projectRoot, filename);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });

    const pptx = await createPptx({ title, subtitle, slides });
    fs.writeFileSync(outPath, pptx);
    console.log(`[powerpoint] wrote ${path.relative(projectRoot, outPath)}`);
  }
};

function buildSlides(items) {
  const slides = [];
  for (const item of items) {
    for (const doc of item.documents || []) {
      if (doc.json !== undefined) {
        slides.push(...slidesFromJson(doc.json));
        continue;
      }

      const content = String(doc.content || '').trim();
      if (!content) continue;
      const parsed = slidesFromMarkdown(content);
      if (parsed.length) {
        slides.push(...parsed);
      } else {
        slides.push({
          title: item.name || doc.filename || item.type || 'Content',
          bullets: contentToBullets(content)
        });
      }
    }
  }
  return slides.filter(slide => slide.title && slide.bullets.length);
}

function slidesFromJson(value) {
  const rows = Array.isArray(value)
    ? value
    : Array.isArray(value?.data)
      ? value.data
      : Array.isArray(value?.slides)
        ? value.slides
        : value && typeof value === 'object'
          ? [value]
          : [];

  return rows.map(row => ({
    title: row.name || row.title || row.section || 'Slide',
    bullets: contentToBullets(row.content ?? row.bullets ?? row.items ?? row.points ?? '')
  }));
}

function slidesFromMarkdown(content) {
  const lines = String(content || '').split(/\r?\n/);
  const slides = [];
  let current = null;

  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+?)\s*$/);
    if (heading) {
      if (current) slides.push(current);
      current = { title: heading[1].trim(), bullets: [] };
      continue;
    }
    if (!current) continue;
    const bullet = line.match(/^\s*(?:[-*]|\d+[.)])\s+(.+?)\s*$/);
    if (bullet) current.bullets.push(bullet[1].trim());
  }

  if (current) slides.push(current);
  return slides.filter(slide => slide.bullets.length);
}

function contentToBullets(value) {
  if (Array.isArray(value)) return value.flatMap(contentToBullets);
  if (value && typeof value === 'object') return Object.values(value).flatMap(contentToBullets);
  return String(value || '')
    .split(/\r?\n/)
    .map(line => line.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim())
    .filter(Boolean);
}

async function createPptx({ title, subtitle, slides }) {
  const zip = new JSZip();
  const slideCount = slides.length + 1;

  zip.file('[Content_Types].xml', contentTypesXml(slideCount));
  zip.file('_rels/.rels', rootRelsXml());
  zip.file('docProps/core.xml', coreXml(title));
  zip.file('docProps/app.xml', appXml(slideCount));
  zip.file('ppt/presentation.xml', presentationXml(slideCount));
  zip.file('ppt/_rels/presentation.xml.rels', presentationRelsXml(slideCount));
  zip.file('ppt/theme/theme1.xml', themeXml());
  zip.file('ppt/slideMasters/slideMaster1.xml', slideMasterXml());
  zip.file('ppt/slideMasters/_rels/slideMaster1.xml.rels', slideMasterRelsXml());
  zip.file('ppt/slideLayouts/slideLayout1.xml', slideLayoutXml());
  zip.file('ppt/slideLayouts/_rels/slideLayout1.xml.rels', slideLayoutRelsXml());
  zip.file('ppt/slides/slide1.xml', slideXml(title, [subtitle], true));
  zip.file('ppt/slides/_rels/slide1.xml.rels', slideRelsXml());

  slides.forEach((slide, idx) => {
    const slideNumber = idx + 2;
    zip.file(`ppt/slides/slide${slideNumber}.xml`, slideXml(slide.title, slide.bullets, false));
    zip.file(`ppt/slides/_rels/slide${slideNumber}.xml.rels`, slideRelsXml());
  });

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function slideXml(title, bullets, isTitleSlide) {
  const body = isTitleSlide
    ? textBoxXml(914400, 2200000, 7315200, 900000, title, [], 3600)
      + textBoxXml(914400, 3300000, 7315200, 600000, bullets[0] || '', [], 2200)
    : textBoxXml(685800, 350000, 7772400, 650000, title, [], 3000)
      + textBoxXml(914400, 1300000, 7315200, 4200000, '', bullets, 1800);

  return xmlHeader() + `<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>${body}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

let shapeId = 2;
function textBoxXml(x, y, cx, cy, title, bullets, fontSize) {
  const id = shapeId++;
  const paragraphs = bullets.length
    ? bullets.map(text => `<a:p><a:pPr marL="342900" indent="-171450"><a:buChar char="•"/></a:pPr><a:r><a:rPr lang="en-US" sz="${fontSize}"/><a:t>${escapeXml(text)}</a:t></a:r></a:p>`).join('')
    : `<a:p><a:r><a:rPr lang="en-US" sz="${fontSize}" b="${fontSize >= 3000 ? 1 : 0}"/><a:t>${escapeXml(title)}</a:t></a:r></a:p>`;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="TextBox ${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0"/><a:lstStyle/>${paragraphs}</p:txBody></p:sp>`;
}

function contentTypesXml(slideCount) {
  const slides = Array.from({ length: slideCount }, (_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('');
  return xmlHeader() + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
}

function rootRelsXml() {
  return xmlHeader() + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>';
}

function presentationXml(slideCount) {
  const ids = Array.from({ length: slideCount }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('');
  return xmlHeader() + `<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${ids}</p:sldIdLst><p:sldSz cx="9144000" cy="5143500" type="screen16x9"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
}

function presentationRelsXml(slideCount) {
  const slides = Array.from({ length: slideCount }, (_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('');
  return xmlHeader() + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>${slides}</Relationships>`;
}

function slideRelsXml() {
  return xmlHeader() + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/></Relationships>';
}

function slideMasterXml() {
  return xmlHeader() + '<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>';
}

function slideMasterRelsXml() {
  return xmlHeader() + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>';
}

function slideLayoutXml() {
  return xmlHeader() + '<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>';
}

function slideLayoutRelsXml() {
  return xmlHeader() + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>';
}

function themeXml() {
  return xmlHeader() + '<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="AION"><a:themeElements><a:clrScheme name="AION"><a:dk1><a:srgbClr val="1F2937"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="374151"/></a:dk2><a:lt2><a:srgbClr val="F9FAFB"/></a:lt2><a:accent1><a:srgbClr val="2563EB"/></a:accent1><a:accent2><a:srgbClr val="059669"/></a:accent2><a:accent3><a:srgbClr val="DC2626"/></a:accent3><a:accent4><a:srgbClr val="D97706"/></a:accent4><a:accent5><a:srgbClr val="7C3AED"/></a:accent5><a:accent6><a:srgbClr val="0891B2"/></a:accent6><a:hlink><a:srgbClr val="2563EB"/></a:hlink><a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme><a:fontScheme name="AION"><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme><a:fmtScheme name="AION"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>';
}

function coreXml(title) {
  const now = new Date().toISOString();
  return xmlHeader() + `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(title)}</dc:title><dc:creator>AION</dc:creator><cp:lastModifiedBy>AION</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
}

function appXml(slideCount) {
  return xmlHeader() + `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>AION</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat><Slides>${slideCount}</Slides></Properties>`;
}

function resolveOutputPath(projectRoot, filename) {
  if (filename.startsWith('~') || path.isAbsolute(filename)) return resolveConfigPath(projectRoot, filename);
  return path.join(projectRoot, 'outputs', filename);
}

function formatDate(date) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function escapeXml(value) {
  return String(value || '').replace(/[<>&'"]/g, char => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;'
  }[char]));
}

function xmlHeader() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
}

module.exports._private = {
  buildSlides,
  slidesFromJson,
  slidesFromMarkdown,
  contentToBullets,
  createPptx
};
