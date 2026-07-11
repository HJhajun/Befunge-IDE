class BefungeIDE {
  constructor() {
    this.gridEl = document.getElementById('grid');
    this.rowsInput = document.getElementById('rowsInput');
    this.colsInput = document.getElementById('colsInput');
    this.speedInput = document.getElementById('speedInput');
    this.speedLabel = document.getElementById('speedLabel');
    this.cursorStatus = document.getElementById('cursorStatus');
    this.directionStatus = document.getElementById('directionStatus');
    this.stringModeStatus = document.getElementById('stringModeStatus');
    this.execStatus = document.getElementById('execStatus');
    this.stackView = document.getElementById('stackView');
    this.pathView = document.getElementById('pathView');
    this.outputView = document.getElementById('outputView');
    this.inputView = document.getElementById('inputView');
    this.recentFilesSelect = document.getElementById('recentFilesSelect');
    this.examplesSelect = document.getElementById('examplesSelect');

    this.rows = Number(this.rowsInput.value);
    this.cols = Number(this.colsInput.value);
    this.grid = this.createGrid(this.rows, this.cols);

    this.cursor = { r: 0, c: 0 };
    this.editorDir = { dr: 0, dc: 1, symbol: '>' };
    this.moveHistory = [];

    this.selection = { start: { r: 0, c: 0 }, end: { r: 0, c: 0 } };
    this.dragging = false;

    this.clipboard = [[' ']];
    this.undoStack = [];
    this.redoStack = [];

    this.breakpoints = new Set();

    this.runtime = this.createRuntime();
    this.runTimer = null;

    this.examples = {
      hello: '>              v\n v",!dlroW olleH"<\n >:v\n ^,_@',
      counter: '>987v>.v\n v456<  :\n >321 ^ _@',
      echo: '~:,_@'
    };

    this.bindEvents();
    this.loadRecentFiles();
    this.pushUndoState();
    this.renderAll();
  }

  createGrid(rows, cols, fill = ' ') {
    return Array.from({ length: rows }, () => Array.from({ length: cols }, () => fill));
  }

  cloneGrid(grid = this.grid) {
    return grid.map((row) => [...row]);
  }

  toIndexKey(r, c) {
    return `${r},${c}`;
  }

  within(r, c) {
    return r >= 0 && r < this.rows && c >= 0 && c < this.cols;
  }

  normalizeSelection(sel = this.selection) {
    const r1 = Math.min(sel.start.r, sel.end.r);
    const r2 = Math.max(sel.start.r, sel.end.r);
    const c1 = Math.min(sel.start.c, sel.end.c);
    const c2 = Math.max(sel.start.c, sel.end.c);
    return { r1, r2, c1, c2 };
  }

  createRuntime() {
    return {
      ip: { r: 0, c: 0 },
      dir: { dr: 0, dc: 1, symbol: '>' },
      stack: [],
      output: '',
      stringMode: false,
      path: [],
      heatmap: new Map(),
      terminated: false,
      waitingInput: false,
      skipNext: false,
      inputCursor: 0
    };
  }

  bindEvents() {
    document.getElementById('undoBtn').addEventListener('click', () => this.undo());
    document.getElementById('redoBtn').addEventListener('click', () => this.redo());
    document.getElementById('copyBtn').addEventListener('click', () => this.copySelection());
    document.getElementById('cutBtn').addEventListener('click', () => this.cutSelection());
    document.getElementById('pasteBtn').addEventListener('click', () => this.pasteClipboard());
    document.getElementById('rotatePasteBtn').addEventListener('click', () => this.rotateAndPaste());
    document.getElementById('flipHBtn').addEventListener('click', () => this.flipClipboardH());
    document.getElementById('flipVBtn').addEventListener('click', () => this.flipClipboardV());

    document.getElementById('resizeBtn').addEventListener('click', () => this.resizeGrid());
    document.getElementById('insertRowBtn').addEventListener('click', () => this.insertRow());
    document.getElementById('deleteRowBtn').addEventListener('click', () => this.deleteRow());
    document.getElementById('insertColBtn').addEventListener('click', () => this.insertCol());
    document.getElementById('deleteColBtn').addEventListener('click', () => this.deleteCol());

    document.getElementById('runBtn').addEventListener('click', () => this.run());
    document.getElementById('pauseBtn').addEventListener('click', () => this.pause());
    document.getElementById('stepBtn').addEventListener('click', () => this.step());
    document.getElementById('resetBtn').addEventListener('click', () => this.resetRuntime());

    this.speedInput.addEventListener('input', () => {
      this.speedLabel.textContent = this.speedInput.value;
      if (this.runTimer) {
        this.pause();
        this.run();
      }
    });

    document.getElementById('saveBtn').addEventListener('click', () => this.saveFile());
    document.getElementById('openBtn').addEventListener('click', () => document.getElementById('openFileInput').click());
    document.getElementById('openFileInput').addEventListener('change', (e) => this.openFile(e.target.files?.[0]));
    this.recentFilesSelect.addEventListener('change', () => this.loadRecentSelection());
    this.examplesSelect.addEventListener('change', () => this.loadExample());

    document.addEventListener('keydown', (e) => this.onKeyDown(e));

    this.gridEl.addEventListener('mousedown', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell) return;
      const r = Number(cell.dataset.r);
      const c = Number(cell.dataset.c);
      this.cursor = { r, c };
      this.selection = { start: { r, c }, end: { r, c } };
      this.dragging = true;
      this.renderAll();
    });

    this.gridEl.addEventListener('mouseover', (e) => {
      if (!this.dragging) return;
      const cell = e.target.closest('.cell');
      if (!cell) return;
      const r = Number(cell.dataset.r);
      const c = Number(cell.dataset.c);
      this.selection.end = { r, c };
      this.renderAll();
    });

    this.gridEl.addEventListener('dblclick', (e) => {
      const cell = e.target.closest('.cell');
      if (!cell) return;
      const r = Number(cell.dataset.r);
      const c = Number(cell.dataset.c);
      const key = this.toIndexKey(r, c);
      if (this.breakpoints.has(key)) this.breakpoints.delete(key);
      else this.breakpoints.add(key);
      this.renderAll();
    });

    document.addEventListener('mouseup', () => {
      this.dragging = false;
    });
  }

  pushUndoState() {
    this.undoStack.push({
      grid: this.cloneGrid(),
      rows: this.rows,
      cols: this.cols,
      cursor: { ...this.cursor },
      selection: JSON.parse(JSON.stringify(this.selection))
    });
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  restoreState(state) {
    this.grid = this.cloneGrid(state.grid);
    this.rows = state.rows;
    this.cols = state.cols;
    this.rowsInput.value = String(this.rows);
    this.colsInput.value = String(this.cols);
    this.cursor = { ...state.cursor };
    this.selection = JSON.parse(JSON.stringify(state.selection));
    this.resetRuntime();
    this.renderAll();
  }

  undo() {
    if (this.undoStack.length <= 1) return;
    const current = this.undoStack.pop();
    this.redoStack.push(current);
    const prev = this.undoStack[this.undoStack.length - 1];
    this.restoreState(prev);
  }

  redo() {
    if (!this.redoStack.length) return;
    const next = this.redoStack.pop();
    this.undoStack.push(next);
    this.restoreState(next);
  }

  renderGrid() {
    this.gridEl.style.gridTemplateColumns = `repeat(${this.cols}, var(--cell-size))`;

    const { r1, r2, c1, c2 } = this.normalizeSelection();
    const execKey = this.toIndexKey(this.runtime.ip.r, this.runtime.ip.c);

    const frag = document.createDocumentFragment();
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const cell = document.createElement('div');
        const key = this.toIndexKey(r, c);
        cell.className = 'cell';
        cell.dataset.r = String(r);
        cell.dataset.c = String(c);
        cell.textContent = this.grid[r][c] === ' ' ? '·' : this.grid[r][c];

        if (this.cursor.r === r && this.cursor.c === c) cell.classList.add('cursor');
        if (r >= r1 && r <= r2 && c >= c1 && c <= c2) cell.classList.add('selected');
        if (this.breakpoints.has(key)) cell.classList.add('breakpoint');
        if (this.runtime.heatmap.get(key) > 0) {
          cell.classList.add('visited');
          const hit = Math.min(0.55, this.runtime.heatmap.get(key) / 20);
          cell.style.backgroundColor = `rgba(255, 130, 130, ${hit})`;
        }
        if (execKey === key && !this.runtime.terminated) cell.classList.add('exec');

        frag.appendChild(cell);
      }
    }

    this.gridEl.innerHTML = '';
    this.gridEl.appendChild(frag);
  }

  renderStatus() {
    this.cursorStatus.textContent = `Cursor: (${this.cursor.r}, ${this.cursor.c})`;
    this.directionStatus.textContent = `Direction: ${this.editorDir.symbol} / Exec ${this.runtime.dir.symbol}`;
    this.stringModeStatus.textContent = `String Mode: ${this.runtime.stringMode ? 'ON' : 'OFF'}`;
    this.execStatus.textContent = this.runtime.terminated ? 'Terminated' : this.runTimer ? 'Running' : 'Paused';

    this.stackView.textContent = JSON.stringify(this.runtime.stack, null, 2);
    this.outputView.value = this.runtime.output;
    this.pathView.textContent = this.runtime.path.slice(-100).map((p) => `(${p.r},${p.c})`).join(' → ');
  }

  renderAll() {
    this.renderGrid();
    this.renderStatus();
  }

  updateCursorAndSelection(r, c, shift = false) {
    if (!this.within(r, c)) return;
    if (shift) {
      this.selection.end = { r, c };
    } else {
      this.selection = { start: { r, c }, end: { r, c } };
    }
    this.cursor = { r, c };
  }

  setDirectionByArrow(key) {
    if (key === 'ArrowUp') this.editorDir = { dr: -1, dc: 0, symbol: '^' };
    if (key === 'ArrowDown') this.editorDir = { dr: 1, dc: 0, symbol: 'v' };
    if (key === 'ArrowLeft') this.editorDir = { dr: 0, dc: -1, symbol: '<' };
    if (key === 'ArrowRight') this.editorDir = { dr: 0, dc: 1, symbol: '>' };
  }

  flowDirectionFromCell(ch) {
    if (ch === '>') return { dr: 0, dc: 1, symbol: '>' };
    if (ch === '<') return { dr: 0, dc: -1, symbol: '<' };
    if (ch === '^') return { dr: -1, dc: 0, symbol: '^' };
    if (ch === 'v') return { dr: 1, dc: 0, symbol: 'v' };
    return null;
  }

  moveCursorByFlow() {
    const prev = { ...this.cursor };
    const nr = Math.max(0, Math.min(this.rows - 1, this.cursor.r + this.editorDir.dr));
    const nc = Math.max(0, Math.min(this.cols - 1, this.cursor.c + this.editorDir.dc));
    this.moveHistory.push(prev);
    this.updateCursorAndSelection(nr, nc, false);

    const nextFlow = this.flowDirectionFromCell(this.grid[nr][nc]);
    if (nextFlow) this.editorDir = nextFlow;
  }

  onKeyDown(e) {
    const arrow = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      this.undo();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      this.redo();
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      this.copySelection();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
      e.preventDefault();
      this.cutSelection();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      this.pasteClipboard();
      return;
    }

    if (arrow.includes(e.key) && e.altKey) {
      e.preventDefault();
      this.pushUndoState();
      this.moveSelectionBlock(e.key);
      this.renderAll();
      return;
    }

    if (arrow.includes(e.key)) {
      e.preventDefault();
      if (e.shiftKey) {
        const dr = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
        const dc = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
        const r = Math.max(0, Math.min(this.rows - 1, this.selection.end.r + dr));
        const c = Math.max(0, Math.min(this.cols - 1, this.selection.end.c + dc));
        this.updateCursorAndSelection(r, c, true);
      } else {
        this.setDirectionByArrow(e.key);
        this.moveCursorByFlow();
      }
      this.renderAll();
      return;
    }

    if (e.key === 'Backspace') {
      e.preventDefault();
      this.pushUndoState();
      this.grid[this.cursor.r][this.cursor.c] = ' ';
      const prev = this.moveHistory.pop();
      if (prev) this.updateCursorAndSelection(prev.r, prev.c);
      this.renderAll();
      return;
    }

    if (e.key === 'Delete') {
      e.preventDefault();
      this.pushUndoState();
      this.grid[this.cursor.r][this.cursor.c] = ' ';
      this.renderAll();
      return;
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      this.pushUndoState();
      this.grid[this.cursor.r][this.cursor.c] = e.key;
      this.moveCursorByFlow();
      this.renderAll();
    }
  }

  getSelectionMatrix() {
    const { r1, r2, c1, c2 } = this.normalizeSelection();
    const matrix = [];
    for (let r = r1; r <= r2; r++) {
      matrix.push(this.grid[r].slice(c1, c2 + 1));
    }
    return matrix;
  }

  clearSelection() {
    const { r1, r2, c1, c2 } = this.normalizeSelection();
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) this.grid[r][c] = ' ';
    }
  }

  copySelection() {
    this.clipboard = this.getSelectionMatrix();
  }

  cutSelection() {
    this.pushUndoState();
    this.copySelection();
    this.clearSelection();
    this.renderAll();
  }

  pasteClipboard() {
    this.pushUndoState();
    const baseR = this.cursor.r;
    const baseC = this.cursor.c;
    for (let r = 0; r < this.clipboard.length; r++) {
      for (let c = 0; c < this.clipboard[r].length; c++) {
        const tr = baseR + r;
        const tc = baseC + c;
        if (this.within(tr, tc)) this.grid[tr][tc] = this.clipboard[r][c];
      }
    }
    this.renderAll();
  }

  rotateMatrix(matrix) {
    const rows = matrix.length;
    const cols = matrix[0].length;
    const result = Array.from({ length: cols }, () => Array.from({ length: rows }, () => ' '));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) result[c][rows - 1 - r] = matrix[r][c];
    }
    return result;
  }

  rotateAndPaste() {
    this.clipboard = this.rotateMatrix(this.clipboard);
    this.pasteClipboard();
  }

  flipClipboardH() {
    this.clipboard = this.clipboard.map((row) => [...row].reverse());
    this.pasteClipboard();
  }

  flipClipboardV() {
    this.clipboard = [...this.clipboard].reverse();
    this.pasteClipboard();
  }

  moveSelectionBlock(key) {
    const { r1, r2, c1, c2 } = this.normalizeSelection();
    const dr = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0;
    const dc = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;

    const nr1 = r1 + dr;
    const nr2 = r2 + dr;
    const nc1 = c1 + dc;
    const nc2 = c2 + dc;
    if (!this.within(nr1, nc1) || !this.within(nr2, nc2)) return;

    const chunk = this.getSelectionMatrix();
    this.clearSelection();
    for (let r = 0; r < chunk.length; r++) {
      for (let c = 0; c < chunk[r].length; c++) this.grid[nr1 + r][nc1 + c] = chunk[r][c];
    }
    this.selection = { start: { r: nr1, c: nc1 }, end: { r: nr2, c: nc2 } };
    this.cursor = { r: nr1, c: nc1 };
  }

  resizeGrid() {
    const newRows = Math.max(1, Number(this.rowsInput.value) || this.rows);
    const newCols = Math.max(1, Number(this.colsInput.value) || this.cols);
    this.pushUndoState();

    const next = this.createGrid(newRows, newCols);
    for (let r = 0; r < Math.min(this.rows, newRows); r++) {
      for (let c = 0; c < Math.min(this.cols, newCols); c++) next[r][c] = this.grid[r][c];
    }
    this.rows = newRows;
    this.cols = newCols;
    this.grid = next;

    this.cursor.r = Math.min(this.cursor.r, this.rows - 1);
    this.cursor.c = Math.min(this.cursor.c, this.cols - 1);

    this.resetRuntime();
    this.renderAll();
  }

  insertRow() {
    this.pushUndoState();
    const idx = this.cursor.r;
    this.grid.splice(idx, 0, Array.from({ length: this.cols }, () => ' '));
    this.rows += 1;
    this.rowsInput.value = String(this.rows);
    this.resetRuntime();
    this.renderAll();
  }

  deleteRow() {
    if (this.rows <= 1) return;
    this.pushUndoState();
    this.grid.splice(this.cursor.r, 1);
    this.rows -= 1;
    this.rowsInput.value = String(this.rows);
    this.cursor.r = Math.min(this.cursor.r, this.rows - 1);
    this.resetRuntime();
    this.renderAll();
  }

  insertCol() {
    this.pushUndoState();
    const idx = this.cursor.c;
    for (const row of this.grid) row.splice(idx, 0, ' ');
    this.cols += 1;
    this.colsInput.value = String(this.cols);
    this.resetRuntime();
    this.renderAll();
  }

  deleteCol() {
    if (this.cols <= 1) return;
    this.pushUndoState();
    for (const row of this.grid) row.splice(this.cursor.c, 1);
    this.cols -= 1;
    this.colsInput.value = String(this.cols);
    this.cursor.c = Math.min(this.cursor.c, this.cols - 1);
    this.resetRuntime();
    this.renderAll();
  }

  serializeGrid() {
    return this.grid.map((row) => row.join('').replace(/\s+$/g, '')).join('\n');
  }

  loadFromText(text) {
    const lines = text.replace(/\r/g, '').split('\n');
    const rows = Math.max(1, lines.length);
    const cols = Math.max(1, ...lines.map((l) => l.length));

    this.rows = rows;
    this.cols = cols;
    this.rowsInput.value = String(rows);
    this.colsInput.value = String(cols);

    this.grid = this.createGrid(rows, cols);
    for (let r = 0; r < rows; r++) {
      const line = lines[r] || '';
      for (let c = 0; c < line.length; c++) this.grid[r][c] = line[c];
    }

    this.cursor = { r: 0, c: 0 };
    this.selection = { start: { r: 0, c: 0 }, end: { r: 0, c: 0 } };
    this.editorDir = { dr: 0, dc: 1, symbol: '>' };
    this.moveHistory = [];

    this.resetRuntime();
    this.pushUndoState();
    this.renderAll();
  }

  saveFile() {
    const text = this.serializeGrid();
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const name = `program-${Date.now()}.bf`;
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    this.addRecentFile(name, text);
  }

  openFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      this.loadFromText(text);
      this.addRecentFile(file.name, text);
    };
    reader.readAsText(file);
  }

  addRecentFile(name, text) {
    const key = 'befunge-ide-recent-files';
    const recent = JSON.parse(localStorage.getItem(key) || '[]');
    const next = [{ name, text, at: Date.now() }, ...recent.filter((x) => x.name !== name)].slice(0, 8);
    localStorage.setItem(key, JSON.stringify(next));
    this.loadRecentFiles();
  }

  loadRecentFiles() {
    const key = 'befunge-ide-recent-files';
    const recent = JSON.parse(localStorage.getItem(key) || '[]');
    this.recentFilesSelect.innerHTML = '<option value="">선택</option>';
    recent.forEach((file, i) => {
      const option = document.createElement('option');
      option.value = String(i);
      option.textContent = file.name;
      this.recentFilesSelect.appendChild(option);
    });
  }

  loadRecentSelection() {
    const idx = this.recentFilesSelect.value;
    if (idx === '') return;
    const key = 'befunge-ide-recent-files';
    const recent = JSON.parse(localStorage.getItem(key) || '[]');
    const chosen = recent[Number(idx)];
    if (chosen) this.loadFromText(chosen.text);
  }

  loadExample() {
    const example = this.examplesSelect.value;
    if (!example || !this.examples[example]) return;
    this.loadFromText(this.examples[example]);
  }

  dirBySymbol(symbol) {
    if (symbol === '>') return { dr: 0, dc: 1, symbol: '>' };
    if (symbol === '<') return { dr: 0, dc: -1, symbol: '<' };
    if (symbol === '^') return { dr: -1, dc: 0, symbol: '^' };
    if (symbol === 'v') return { dr: 1, dc: 0, symbol: 'v' };
    return this.runtime.dir;
  }

  popStack() {
    return this.runtime.stack.length ? this.runtime.stack.pop() : 0;
  }

  pushStack(v) {
    this.runtime.stack.push((Number(v) || 0) | 0);
  }

  advanceIP() {
    this.runtime.ip.r = (this.runtime.ip.r + this.runtime.dir.dr + this.rows) % this.rows;
    this.runtime.ip.c = (this.runtime.ip.c + this.runtime.dir.dc + this.cols) % this.cols;
  }

  step() {
    if (this.runtime.terminated) return;

    const key = this.toIndexKey(this.runtime.ip.r, this.runtime.ip.c);
    if (this.breakpoints.has(key) && this.runtime.path.length > 0) {
      this.pause();
      this.renderAll();
      return;
    }

    const instr = this.grid[this.runtime.ip.r][this.runtime.ip.c] || ' ';
    this.runtime.path.push({ r: this.runtime.ip.r, c: this.runtime.ip.c });
    this.runtime.heatmap.set(key, (this.runtime.heatmap.get(key) || 0) + 1);

    if (this.runtime.stringMode && instr !== '"') {
      this.pushStack(instr.charCodeAt(0));
    } else {
      this.executeInstruction(instr);
    }

    if (!this.runtime.terminated) {
      this.advanceIP();
      if (this.runtime.skipNext) {
        this.runtime.skipNext = false;
        this.advanceIP();
      }
    }

    this.renderAll();
  }

  executeInstruction(instr) {
    if (/\d/.test(instr)) {
      this.pushStack(Number(instr));
      return;
    }

    switch (instr) {
      case ' ':
        break;
      case '+': {
        const b = this.popStack();
        const a = this.popStack();
        this.pushStack(a + b);
        break;
      }
      case '-': {
        const b = this.popStack();
        const a = this.popStack();
        this.pushStack(a - b);
        break;
      }
      case '*': {
        const b = this.popStack();
        const a = this.popStack();
        this.pushStack(a * b);
        break;
      }
      case '/': {
        const b = this.popStack();
        const a = this.popStack();
        this.pushStack(b === 0 ? 0 : Math.trunc(a / b));
        break;
      }
      case '%': {
        const b = this.popStack();
        const a = this.popStack();
        this.pushStack(b === 0 ? 0 : a % b);
        break;
      }
      case '!': {
        const a = this.popStack();
        this.pushStack(a === 0 ? 1 : 0);
        break;
      }
      case '`': {
        const b = this.popStack();
        const a = this.popStack();
        this.pushStack(a > b ? 1 : 0);
        break;
      }
      case '>':
      case '<':
      case '^':
      case 'v':
        this.runtime.dir = this.dirBySymbol(instr);
        break;
      case '?': {
        const dirs = ['>', '<', '^', 'v'];
        this.runtime.dir = this.dirBySymbol(dirs[Math.floor(Math.random() * dirs.length)]);
        break;
      }
      case '_': {
        const a = this.popStack();
        this.runtime.dir = this.dirBySymbol(a === 0 ? '>' : '<');
        break;
      }
      case '|': {
        const a = this.popStack();
        this.runtime.dir = this.dirBySymbol(a === 0 ? 'v' : '^');
        break;
      }
      case '"':
        this.runtime.stringMode = !this.runtime.stringMode;
        break;
      case ':': {
        const a = this.popStack();
        this.pushStack(a);
        this.pushStack(a);
        break;
      }
      case '\\': {
        const a = this.popStack();
        const b = this.popStack();
        this.pushStack(a);
        this.pushStack(b);
        break;
      }
      case '$':
        this.popStack();
        break;
      case '.': {
        const a = this.popStack();
        this.runtime.output += `${a} `;
        break;
      }
      case ',': {
        const a = this.popStack();
        this.runtime.output += String.fromCharCode(((a % 256) + 256) % 256);
        break;
      }
      case '#':
        this.runtime.skipNext = true;
        break;
      case 'p': {
        const y = this.popStack();
        const x = this.popStack();
        const v = this.popStack();
        if (this.within(y, x)) this.grid[y][x] = String.fromCharCode(((v % 256) + 256) % 256);
        break;
      }
      case 'g': {
        const y = this.popStack();
        const x = this.popStack();
        const ch = this.within(y, x) ? this.grid[y][x] : ' ';
        this.pushStack(ch.charCodeAt(0));
        break;
      }
      case '&': {
        const token = this.consumeInputToken();
        const num = Number.parseInt(token, 10);
        this.pushStack(Number.isNaN(num) ? 0 : num);
        break;
      }
      case '~': {
        const ch = this.consumeInputChar();
        this.pushStack(ch ? ch.charCodeAt(0) : 0);
        break;
      }
      case '@':
        this.runtime.terminated = true;
        this.pause();
        break;
      default:
        break;
    }
  }

  consumeInputToken() {
    const text = this.inputView.value || '';
    let i = this.runtime.inputCursor;
    while (i < text.length && /\s/.test(text[i])) i += 1;
    let j = i;
    while (j < text.length && !/\s/.test(text[j])) j += 1;
    this.runtime.inputCursor = j;
    return text.slice(i, j);
  }

  consumeInputChar() {
    const text = this.inputView.value || '';
    if (this.runtime.inputCursor >= text.length) return '';
    const ch = text[this.runtime.inputCursor];
    this.runtime.inputCursor += 1;
    return ch;
  }

  run() {
    if (this.runTimer || this.runtime.terminated) return;
    const speed = Math.max(1, Number(this.speedInput.value) || 10);
    this.runTimer = setInterval(() => this.step(), Math.max(1, Math.floor(1000 / speed)));
    this.renderAll();
  }

  pause() {
    if (!this.runTimer) return;
    clearInterval(this.runTimer);
    this.runTimer = null;
    this.renderAll();
  }

  resetRuntime() {
    this.pause();
    this.runtime = this.createRuntime();
    this.renderAll();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  new BefungeIDE();
});
