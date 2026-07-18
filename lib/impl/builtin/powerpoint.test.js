const assert = require('node:assert/strict');
const test = require('node:test');
const JSZip = require('jszip');

const powerpoint = require('./powerpoint');

test('buildSlides parses JSON collection rows', () => {
  const slides = powerpoint._private.buildSlides([
    {
      type: 'deck-data',
      documents: [{
        json: [
          { name: 'Accomplishments', content: ['One', 'Two', 'Three'] },
          { name: 'Focus', content: ['Monday', 'Tuesday'] }
        ]
      }]
    }
  ]);

  assert.deepEqual(slides, [
    { title: 'Accomplishments', bullets: ['One', 'Two', 'Three'] },
    { title: 'Focus', bullets: ['Monday', 'Tuesday'] }
  ]);
});

test('buildSlides parses markdown sections', () => {
  const slides = powerpoint._private.buildSlides([
    {
      type: 'WeeklyPresentation',
      documents: [{
        content: '## Accomplishments\n1. A\n2. B\n\n## Focus\n- C\n- D'
      }]
    }
  ]);

  assert.deepEqual(slides, [
    { title: 'Accomplishments', bullets: ['A', 'B'] },
    { title: 'Focus', bullets: ['C', 'D'] }
  ]);
});

test('createPptx creates expected Open XML parts', async () => {
  const buffer = await powerpoint._private.createPptx({
    title: 'Weekly Direction',
    subtitle: '2026-05-23',
    slides: [{ title: 'Accomplishments', bullets: ['A', 'B', 'C'] }]
  });
  const zip = await JSZip.loadAsync(buffer);

  assert.ok(zip.file('[Content_Types].xml'));
  assert.ok(zip.file('ppt/presentation.xml'));
  assert.ok(zip.file('ppt/slides/slide1.xml'));
  assert.ok(zip.file('ppt/slides/slide2.xml'));
});
