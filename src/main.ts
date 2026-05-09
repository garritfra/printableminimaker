import { generatePDF, buildFilename, type PageSizeKey } from './pdf';
import { DEFAULT_CUSTOM_WIDTH_MM, SIZE_LABELS } from './sizes';
import type { DnDSize, Entry } from './types';

const rows: Entry[] = [];

const rowsEl = document.getElementById('rows') as HTMLElement;
const addBtn = document.getElementById('add-row') as HTMLButtonElement;
const generateBtn = document.getElementById('generate') as HTMLButtonElement;
const pageSizeSel = document.getElementById('page-size') as HTMLSelectElement;
const numberDuplicatesEl = document.getElementById('number-duplicates') as HTMLInputElement;

// Seed from the DOM so browser-restored checkbox/select state survives reloads.
let pageSize: PageSizeKey = pageSizeSel.value as PageSizeKey;
let numberDuplicates = numberDuplicatesEl.checked;

function isValid(): boolean {
  return (
    rows.length > 0 &&
    rows.every(
      (r) =>
        r.image &&
        r.count > 0 &&
        (r.size !== 'custom' || (r.customWidthMm != null && r.customWidthMm > 0)),
    )
  );
}

function updateGenerateBtn() {
  generateBtn.disabled = !isValid();
}

function buildRow(entry: Entry): HTMLElement {
  const el = document.createElement('div');
  el.className = 'row';

  // Thumb
  const thumb = document.createElement('div');
  thumb.className = 'thumb' + (entry.image ? '' : ' empty');
  if (entry.image) {
    const img = document.createElement('img');
    const url = URL.createObjectURL(entry.image);
    img.src = url;
    img.onload = () => URL.revokeObjectURL(url);
    thumb.appendChild(img);
  }
  el.appendChild(thumb);

  // File input + name
  const fileWrap = document.createElement('div');
  fileWrap.className = 'file-wrap';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'image/png,image/jpeg,image/webp';
  fileInput.addEventListener('change', () => {
    entry.image = fileInput.files?.[0] ?? null;
    render();
  });
  fileWrap.appendChild(fileInput);
  if (entry.image) {
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = entry.image.name;
    fileWrap.appendChild(name);
  }
  el.appendChild(fileWrap);

  // Size dropdown + optional custom width input
  const sizeWrap = document.createElement('div');
  sizeWrap.className = 'size-wrap';

  const sizeSel = document.createElement('select');
  for (const [val, label] of Object.entries(SIZE_LABELS)) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    if (val === entry.size) opt.selected = true;
    sizeSel.appendChild(opt);
  }
  sizeWrap.appendChild(sizeSel);

  const customInput = document.createElement('input');
  customInput.type = 'number';
  customInput.min = '1';
  customInput.step = '0.5';
  customInput.className = 'custom-width';
  customInput.placeholder = 'mm';
  customInput.title = 'Base width in mm';
  customInput.value = String(entry.customWidthMm ?? '');
  customInput.style.display = entry.size === 'custom' ? '' : 'none';
  customInput.addEventListener('input', () => {
    const n = parseFloat(customInput.value);
    entry.customWidthMm = Number.isFinite(n) && n > 0 ? n : undefined;
    updateGenerateBtn();
  });
  sizeWrap.appendChild(customInput);

  sizeSel.addEventListener('change', () => {
    entry.size = sizeSel.value as DnDSize;
    if (entry.size === 'custom') {
      if (entry.customWidthMm == null || entry.customWidthMm <= 0) {
        entry.customWidthMm = DEFAULT_CUSTOM_WIDTH_MM;
        customInput.value = String(DEFAULT_CUSTOM_WIDTH_MM);
      }
      customInput.style.display = '';
    } else {
      customInput.style.display = 'none';
    }
    updateGenerateBtn();
  });

  el.appendChild(sizeWrap);

  // Count input
  const countInput = document.createElement('input');
  countInput.type = 'number';
  countInput.min = '1';
  countInput.value = String(entry.count);
  countInput.addEventListener('input', () => {
    const n = parseInt(countInput.value, 10);
    entry.count = !Number.isFinite(n) || n < 1 ? 1 : n;
    updateGenerateBtn();
  });
  el.appendChild(countInput);

  // Remove
  const remove = document.createElement('button');
  remove.className = 'remove';
  remove.type = 'button';
  remove.textContent = '×';
  remove.title = 'Remove row';
  remove.addEventListener('click', () => {
    const i = rows.indexOf(entry);
    if (i >= 0) rows.splice(i, 1);
    render();
  });
  el.appendChild(remove);

  return el;
}

function render() {
  rowsEl.innerHTML = '';
  if (rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = 'No entries yet. Click "+ Add row" to start.';
    rowsEl.appendChild(empty);
  } else {
    for (const entry of rows) rowsEl.appendChild(buildRow(entry));
  }
  updateGenerateBtn();
}

addBtn.addEventListener('click', () => {
  rows.push({ image: null, size: 'medium', count: 1 });
  render();
});

pageSizeSel.addEventListener('change', () => {
  pageSize = pageSizeSel.value as PageSizeKey;
});

numberDuplicatesEl.addEventListener('change', () => {
  numberDuplicates = numberDuplicatesEl.checked;
});

generateBtn.addEventListener('click', async () => {
  const original = generateBtn.textContent;
  generateBtn.disabled = true;
  generateBtn.textContent = 'Generating…';
  try {
    const bytes = await generatePDF(rows, { pageSize, numberDuplicates });
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = buildFilename();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (err) {
    console.error(err);
    alert('Failed to generate PDF: ' + (err instanceof Error ? err.message : String(err)));
  } finally {
    generateBtn.textContent = original;
    updateGenerateBtn();
  }
});

render();
