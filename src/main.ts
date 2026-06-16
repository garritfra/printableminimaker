import { generatePDF, buildFilename } from './pdf';
import { packMinis, type PageSizeKey } from './packing';
import { DEFAULT_CUSTOM_WIDTH_MM, SIZE_LABELS, SIZE_WIDTH_MM } from './sizes';
import type { DnDPresetSize, DnDSize, Entry } from './types';

const rows: Entry[] = [];

const rowsEl = document.getElementById('rows') as HTMLElement;
const generateBtn = document.getElementById('generate') as HTMLButtonElement;
const pageSizeSel = document.getElementById('page-size') as HTMLSelectElement;
const numberDuplicatesEl = document.getElementById('number-duplicates') as HTMLInputElement;
const dropzone = document.getElementById('dropzone') as HTMLElement;
const fileInput = document.getElementById('file-input') as HTMLInputElement;
const rowsToolbar = document.getElementById('rows-toolbar') as HTMLElement;
const rowsHeader = document.getElementById('rows-header') as HTMLElement;
const addBlankBtn = document.getElementById('add-blank') as HTMLButtonElement;
const bulkSizeSel = document.getElementById('bulk-size') as HTMLSelectElement;
const countReadout = document.getElementById('count-readout') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;
const dragOverlay = document.getElementById('drag-overlay') as HTMLElement;

const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'];

// --- Settings persistence (page size + number duplicates only; files are
// explicitly not persisted). ---

const LS_KEY = 'pmg-settings';

let pageSize: PageSizeKey = pageSizeSel.value as PageSizeKey;
let numberDuplicates = numberDuplicatesEl.checked;

function loadSettings() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as { pageSize?: string; numberDuplicates?: boolean };
    if (s.pageSize === 'a4' || s.pageSize === 'letter') {
      pageSize = s.pageSize;
      pageSizeSel.value = s.pageSize;
    }
    if (typeof s.numberDuplicates === 'boolean') {
      numberDuplicates = s.numberDuplicates;
      numberDuplicatesEl.checked = s.numberDuplicates;
    }
  } catch {
    // Ignore malformed/unavailable storage — fall back to defaults.
  }
}

function saveSettings() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ pageSize, numberDuplicates }));
  } catch {
    // Storage may be disabled (private mode); persistence is best-effort.
  }
}

// --- Status region (replaces blocking alert()). ---

let statusTimer: ReturnType<typeof setTimeout> | undefined;

// `source` lets updateCount() retract only its own oversized warning without
// clobbering a generation error or success message.
function showStatus(message: string, kind: 'error' | 'info', source = 'manual') {
  if (statusTimer) clearTimeout(statusTimer);
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`;
  statusEl.dataset.source = source;
  statusEl.hidden = false;
  if (kind === 'info') {
    statusTimer = setTimeout(clearStatus, 5000);
  }
}

function clearStatus() {
  if (statusTimer) clearTimeout(statusTimer);
  statusEl.hidden = true;
  statusEl.textContent = '';
  delete statusEl.dataset.source;
}

// --- File ingestion (shared by drop + multi-select). Always appends. ---

function ingestFiles(files: FileList | File[]) {
  const list = Array.from(files).filter((f) => ACCEPTED.includes(f.type.toLowerCase()));
  const rejected = Array.from(files).length - list.length;
  if (list.length === 0) {
    if (rejected > 0) showStatus('Those files aren’t PNG, JPG or WebP images.', 'error');
    return;
  }
  clearStatus();
  for (const file of list) {
    rows.push({ image: file, size: 'medium', count: 1 });
  }
  if (rejected > 0) {
    showStatus(`Added ${list.length} image${list.length === 1 ? '' : 's'}; skipped ${rejected} non-image file${rejected === 1 ? '' : 's'}.`, 'info');
  }
  render();
}

// --- Row rendering ---

// Row elements, parallel to `rows`, so the count pass can flag oversized rows
// without rebuilding the DOM.
let rowEls: HTMLElement[] = [];

function buildRow(entry: Entry, index: number): HTMLElement {
  const el = document.createElement('div');
  el.className = 'row';

  // Thumbnail — non-cropping (contain) so it matches the print output. Doubles
  // as a drop target / click target to replace this entry's artwork.
  const thumb = document.createElement('div');
  thumb.className = 'thumb' + (entry.image ? '' : ' empty');
  thumb.title = 'Drop or click to replace image';
  if (entry.image) {
    const img = document.createElement('img');
    const url = URL.createObjectURL(entry.image);
    img.src = url;
    img.onload = () => {
      const known = entry.naturalWidth != null;
      entry.naturalWidth = img.naturalWidth;
      entry.naturalHeight = img.naturalHeight;
      URL.revokeObjectURL(url);
      if (!known) updateCount();
    };
    thumb.appendChild(img);
  }
  thumb.addEventListener('click', () => replaceImage(entry));
  thumb.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    thumb.classList.add('drop-target');
  });
  thumb.addEventListener('dragleave', () => thumb.classList.remove('drop-target'));
  thumb.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    thumb.classList.remove('drop-target');
    const file = Array.from(e.dataTransfer?.files ?? []).find((f) =>
      ACCEPTED.includes(f.type.toLowerCase()),
    );
    if (file) {
      entry.image = file;
      entry.naturalWidth = undefined;
      entry.naturalHeight = undefined;
      render();
    } else {
      showStatus('That file isn’t a PNG, JPG or WebP image.', 'error');
    }
  });

  // Warning badge for an oversized mini (toggled by updateCount).
  const warn = document.createElement('span');
  warn.className = 'warn-badge';
  warn.textContent = '!';
  warn.hidden = true;
  warn.title = 'This mini is too large for the printable area and will be left out. Reduce its size or pick a larger page.';
  thumb.appendChild(warn);

  el.appendChild(thumb);

  // Image column: file name (or a prompt to add one).
  const fileWrap = document.createElement('div');
  fileWrap.className = 'file-wrap';
  const name = document.createElement('span');
  name.className = 'file-name';
  name.textContent = entry.image ? entry.image.name : 'No image — click the thumbnail';
  if (!entry.image) name.classList.add('placeholder');
  fileWrap.appendChild(name);
  el.appendChild(fileWrap);

  // Size column — dropdown + optional custom-width field with a mm affix.
  const sizeWrap = document.createElement('div');
  sizeWrap.className = 'field size-wrap';
  sizeWrap.append(fieldLabel('Size'));

  const sizeSel = document.createElement('select');
  for (const [val, label] of Object.entries(SIZE_LABELS)) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    if (val === entry.size) opt.selected = true;
    sizeSel.appendChild(opt);
  }
  sizeWrap.appendChild(sizeSel);

  const customWrap = document.createElement('div');
  customWrap.className = 'custom-width-wrap';
  customWrap.style.display = entry.size === 'custom' ? '' : 'none';
  const customInput = document.createElement('input');
  customInput.type = 'number';
  customInput.min = '1';
  customInput.step = '0.5';
  customInput.className = 'custom-width';
  customInput.setAttribute('aria-label', 'Custom base width in millimetres');
  customInput.value = String(entry.customWidthMm ?? '');
  customInput.addEventListener('input', () => {
    const n = parseFloat(customInput.value);
    entry.customWidthMm = Number.isFinite(n) && n > 0 ? n : undefined;
    updateCount();
  });
  const unit = document.createElement('span');
  unit.className = 'unit';
  unit.textContent = 'mm';
  customWrap.append(customInput, unit);
  sizeWrap.appendChild(customWrap);

  sizeSel.addEventListener('change', () => {
    entry.size = sizeSel.value as DnDSize;
    if (entry.size === 'custom') {
      if (entry.customWidthMm == null || entry.customWidthMm <= 0) {
        entry.customWidthMm = DEFAULT_CUSTOM_WIDTH_MM;
        customInput.value = String(DEFAULT_CUSTOM_WIDTH_MM);
      }
      customWrap.style.display = '';
    } else {
      customWrap.style.display = 'none';
    }
    updateCount();
  });
  el.appendChild(sizeWrap);

  // Copies column.
  const copiesWrap = document.createElement('div');
  copiesWrap.className = 'field copies-wrap';
  copiesWrap.append(fieldLabel('Copies'));
  const countInput = document.createElement('input');
  countInput.type = 'number';
  countInput.min = '1';
  countInput.className = 'copies';
  countInput.value = String(entry.count);
  countInput.addEventListener('input', () => {
    const n = parseInt(countInput.value, 10);
    entry.count = !Number.isFinite(n) || n < 1 ? 1 : n;
    updateCount();
  });
  copiesWrap.appendChild(countInput);
  el.appendChild(copiesWrap);

  // Per-row actions: duplicate + remove.
  const actions = document.createElement('div');
  actions.className = 'row-actions';

  const dup = document.createElement('button');
  dup.className = 'dup';
  dup.type = 'button';
  dup.textContent = '⧉';
  dup.title = 'Duplicate row';
  dup.addEventListener('click', () => {
    const i = rows.indexOf(entry);
    if (i >= 0) rows.splice(i + 1, 0, { ...entry });
    render();
  });
  actions.appendChild(dup);

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
  actions.appendChild(remove);
  el.appendChild(actions);

  el.dataset.index = String(index);
  return el;
}

function fieldLabel(text: string): HTMLElement {
  const span = document.createElement('span');
  span.className = 'field-label';
  span.textContent = text;
  return span;
}

function replaceImage(entry: Entry) {
  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = 'image/png,image/jpeg,image/webp';
  picker.addEventListener('change', () => {
    const file = picker.files?.[0];
    if (file && ACCEPTED.includes(file.type.toLowerCase())) {
      entry.image = file;
      entry.naturalWidth = undefined;
      entry.naturalHeight = undefined;
      render();
    }
  });
  picker.click();
}

function render() {
  const hasRows = rows.length > 0;
  dropzone.classList.toggle('slim', hasRows);
  rowsToolbar.hidden = !hasRows;
  rowsHeader.hidden = !hasRows;

  rowsEl.innerHTML = '';
  rowEls = [];
  rows.forEach((entry, i) => {
    const el = buildRow(entry, i);
    rowEls.push(el);
    rowsEl.appendChild(el);
  });

  updateCount();
}

// Recomputes the live "N minis → M pages" readout, flags oversized rows, and
// toggles the Generate button — all from the pure packing module.
function updateCount() {
  const result = packMinis(rows, { pageSize, numberDuplicates });

  const oversized = new Set(result.oversizedEntryIndices);
  rowEls.forEach((el, i) => {
    const badge = el.querySelector('.warn-badge') as HTMLElement | null;
    const isOversized = oversized.has(i);
    el.classList.toggle('oversized', isOversized);
    if (badge) badge.hidden = !isOversized;
  });

  const pageLabel = pageSize === 'a4' ? 'A4' : 'Letter';
  if (result.miniCount === 0) {
    countReadout.textContent = rows.length === 0 ? 'No minis yet' : 'No minis fit yet';
  } else {
    const minis = `${result.miniCount} mini${result.miniCount === 1 ? '' : 's'}`;
    const pages = `${result.pageCount} page${result.pageCount === 1 ? '' : 's'}`;
    countReadout.textContent = `${minis} → ${pages} (${pageLabel})`;
  }

  if (result.skipped.length > 0) {
    showStatus(
      `${result.skipped.length} mini${result.skipped.length === 1 ? '' : 's'} too large for ${pageLabel} — left out (see flagged rows).`,
      'error',
      'oversized',
    );
  } else if (statusEl.dataset.source === 'oversized') {
    // Retract the oversized warning once everything fits again.
    clearStatus();
  }

  generateBtn.disabled = result.miniCount === 0;
}

// --- Settings wiring ---

pageSizeSel.addEventListener('change', () => {
  pageSize = pageSizeSel.value as PageSizeKey;
  saveSettings();
  updateCount();
});

numberDuplicatesEl.addEventListener('change', () => {
  numberDuplicates = numberDuplicatesEl.checked;
  saveSettings();
  updateCount();
});

// --- Dropzone + multi-select ---

dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => {
  if (fileInput.files && fileInput.files.length > 0) ingestFiles(fileInput.files);
  fileInput.value = ''; // allow re-selecting the same file(s)
});

addBlankBtn.addEventListener('click', () => {
  rows.push({ image: null, size: 'medium', count: 1 });
  render();
});

// --- Bulk "set all to size" ---

for (const [val, label] of Object.entries(SIZE_LABELS)) {
  if (val === 'custom') continue; // custom needs a per-row width
  const opt = document.createElement('option');
  opt.value = val;
  opt.textContent = label;
  bulkSizeSel.appendChild(opt);
}
bulkSizeSel.addEventListener('change', () => {
  const size = bulkSizeSel.value as DnDPresetSize;
  if (!SIZE_WIDTH_MM[size]) return;
  for (const entry of rows) entry.size = size;
  bulkSizeSel.value = '';
  render();
});

// --- Full-window drag overlay (drop anywhere to append). ---

let dragDepth = 0;

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files');
}

window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  dragOverlay.hidden = false;
});
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
});
window.addEventListener('dragleave', (e) => {
  if (!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) dragOverlay.hidden = true;
});
window.addEventListener('drop', (e) => {
  if (!e.dataTransfer) return;
  e.preventDefault();
  dragDepth = 0;
  dragOverlay.hidden = true;
  // Thumbnail drops call stopPropagation, so anything reaching here appends.
  if (e.dataTransfer.files.length > 0) ingestFiles(e.dataTransfer.files);
});

// --- Generate ---

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
    showStatus('PDF downloaded.', 'info');
  } catch (err) {
    console.error(err);
    showStatus(
      'Couldn’t generate the PDF: ' + (err instanceof Error ? err.message : String(err)),
      'error',
    );
  } finally {
    generateBtn.textContent = original;
    updateCount();
  }
});

loadSettings();
render();
