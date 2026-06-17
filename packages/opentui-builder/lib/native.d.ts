type NativePointer = object

interface OpenTUIBindings {
  // ── System ──

  getArenaAllocatedBytes(): number
  getBuildOptions(outPtr: ArrayBuffer): void
  getAllocatorStats(outPtr: ArrayBuffer): void

  // ── Callbacks ──

  setLogCallback(callback: (level: number, message: string) => void): void
  setEventCallback(
    callback: (eventType: number, data: ArrayBuffer) => void,
  ): void

  // ── Renderer ──

  createRenderer(
    width: number,
    height: number,
    testing: boolean,
    remote: boolean,
  ): NativePointer
  destroyRenderer(renderer: NativePointer): void
  render(renderer: NativePointer, force: boolean): void
  getNextBuffer(renderer: NativePointer): NativePointer
  getCurrentBuffer(renderer: NativePointer): NativePointer
  setBackgroundColor(
    renderer: NativePointer,
    r: number,
    g: number,
    b: number,
    a: number,
  ): void
  setRenderOffset(renderer: NativePointer, offset: number): void
  setUseThread(renderer: NativePointer, useThread: boolean): void
  setDebugOverlay(
    renderer: NativePointer,
    enabled: boolean,
    corner: number,
  ): void
  clearTerminal(renderer: NativePointer): void
  setCursorPosition(
    renderer: NativePointer,
    x: number,
    y: number,
    visible: boolean,
  ): void
  setTerminalEnvVar(
    renderer: NativePointer,
    key: string,
    value: string,
  ): boolean
  updateStats(
    renderer: NativePointer,
    time: number,
    fps: number,
    frameCallbackTime: number,
  ): void
  updateMemoryStats(
    renderer: NativePointer,
    heapUsed: number,
    heapTotal: number,
    arrayBuffers: number,
  ): void
  getLastOutputForTest(renderer: NativePointer): string
  setHyperlinksCapability(renderer: NativePointer, enabled: boolean): void
  resizeRenderer(renderer: NativePointer, width: number, height: number): void
  getTerminalCapabilities(renderer: NativePointer): object
  processCapabilityResponse(renderer: NativePointer, response: string): void
  setCursorColor(
    renderer: NativePointer,
    r: number,
    g: number,
    b: number,
    a: number,
  ): void
  setCursorStyleOptions(
    renderer: NativePointer,
    style: number,
    blinking: boolean,
    cursor: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): void
  getCursorState(renderer: NativePointer): {
    x: number
    y: number
    visible: boolean
  }
  setTerminalTitle(renderer: NativePointer, title: string): void
  copyToClipboardOSC52(
    renderer: NativePointer,
    target: number,
    payload: string,
  ): boolean
  clearClipboardOSC52(renderer: NativePointer, target: number): boolean
  dumpBuffers(renderer: NativePointer, timestamp: number): void
  dumpStdoutBuffer(renderer: NativePointer, timestamp: number): void
  dumpHitGrid(renderer: NativePointer): void
  restoreTerminalModes(renderer: NativePointer): void
  enableMouse(renderer: NativePointer, enableMovement: boolean): void
  disableMouse(renderer: NativePointer): void
  queryPixelResolution(renderer: NativePointer): void
  enableKittyKeyboard(renderer: NativePointer, flags: number): void
  disableKittyKeyboard(renderer: NativePointer): void
  setKittyKeyboardFlags(renderer: NativePointer, flags: number): void
  getKittyKeyboardFlags(renderer: NativePointer): number
  setupTerminal(renderer: NativePointer, useAlternateScreen: boolean): void
  suspendRenderer(renderer: NativePointer): void
  resumeRenderer(renderer: NativePointer): void
  writeOut(renderer: NativePointer, data: string): void

  // ── Buffer ──

  createOptimizedBuffer(
    width: number,
    height: number,
    respectAlpha: boolean,
    widthMethod: number,
    id: string,
  ): NativePointer
  destroyOptimizedBuffer(buffer: NativePointer): void
  destroyFrameBuffer(frameBuffer: NativePointer): void
  drawFrameBuffer(
    target: NativePointer,
    destX: number,
    destY: number,
    frameBuffer: NativePointer,
    sourceX: number,
    sourceY: number,
    sourceWidth: number,
    sourceHeight: number,
  ): void
  getBufferWidth(buffer: NativePointer): number
  getBufferHeight(buffer: NativePointer): number
  bufferClear(
    buffer: NativePointer,
    r: number,
    g: number,
    b: number,
    a: number,
  ): void
  bufferResize(buffer: NativePointer, width: number, height: number): void
  bufferFillRect(
    buffer: NativePointer,
    x: number,
    y: number,
    width: number,
    height: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): void
  bufferGetCharPtr(buffer: NativePointer): ArrayBuffer
  bufferGetFgPtr(buffer: NativePointer): ArrayBuffer
  bufferGetBgPtr(buffer: NativePointer): ArrayBuffer
  bufferGetAttributesPtr(buffer: NativePointer): ArrayBuffer
  bufferGetRespectAlpha(buffer: NativePointer): boolean
  bufferSetRespectAlpha(buffer: NativePointer, respectAlpha: boolean): void
  bufferGetId(buffer: NativePointer): string
  bufferGetRealCharSize(buffer: NativePointer): number
  bufferWriteResolvedChars(
    buffer: NativePointer,
    addLineBreaks: boolean,
  ): number
  bufferDrawText(
    buffer: NativePointer,
    text: string,
    x: number,
    y: number,
    fgR: number,
    fgG: number,
    fgB: number,
    fgA: number,
    bgR: number,
    bgG: number,
    bgB: number,
    bgA: number,
    attributes: number,
  ): void
  bufferSetCellWithAlphaBlending(
    buffer: NativePointer,
    x: number,
    y: number,
    char: number,
    fgR: number,
    fgG: number,
    fgB: number,
    fgA: number,
    bgR: number,
    bgG: number,
    bgB: number,
    bgA: number,
    attributes: number,
  ): void
  bufferSetCell(
    buffer: NativePointer,
    x: number,
    y: number,
    char: number,
    fgR: number,
    fgG: number,
    fgB: number,
    fgA: number,
    bgR: number,
    bgG: number,
    bgB: number,
    bgA: number,
    attributes: number,
  ): void
  bufferColorMatrix(
    buffer: NativePointer,
    matrix: Float32Array,
    cellMask: Float32Array,
    cellMaskCount: number,
    strength: number,
    target: number,
  ): void
  bufferColorMatrixUniform(
    buffer: NativePointer,
    matrix: Float32Array,
    strength: number,
    target: number,
  ): void
  bufferDrawPackedBuffer(
    buffer: NativePointer,
    data: ArrayBuffer,
    posX: number,
    posY: number,
    terminalWidthCells: number,
    terminalHeightCells: number,
  ): void
  bufferDrawGrayscaleBuffer(
    buffer: NativePointer,
    posX: number,
    posY: number,
    intensities: Float32Array,
    srcWidth: number,
    srcHeight: number,
    fgR: number,
    fgG: number,
    fgB: number,
    fgA: number,
    bgR: number,
    bgG: number,
    bgB: number,
    bgA: number,
  ): void
  bufferDrawGrayscaleBufferSupersampled(
    buffer: NativePointer,
    posX: number,
    posY: number,
    intensities: Float32Array,
    srcWidth: number,
    srcHeight: number,
    fgR: number,
    fgG: number,
    fgB: number,
    fgA: number,
    bgR: number,
    bgG: number,
    bgB: number,
    bgA: number,
  ): void
  bufferPushScissorRect(
    buffer: NativePointer,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void
  bufferPopScissorRect(buffer: NativePointer): void
  bufferClearScissorRects(buffer: NativePointer): void
  bufferPushOpacity(buffer: NativePointer, opacity: number): void
  bufferPopOpacity(buffer: NativePointer): void
  bufferGetCurrentOpacity(buffer: NativePointer): number
  bufferClearOpacity(buffer: NativePointer): void
  bufferDrawSuperSampleBuffer(
    buffer: NativePointer,
    x: number,
    y: number,
    pixelData: ArrayBuffer,
    format: number,
    alignedBytesPerRow: number,
  ): void
  bufferDrawGrid(
    buffer: NativePointer,
    borderChars: ArrayBuffer,
    borderFgR: number,
    borderFgG: number,
    borderFgB: number,
    borderFgA: number,
    borderBgR: number,
    borderBgG: number,
    borderBgB: number,
    borderBgA: number,
    colOffsets: ArrayBuffer,
    rowOffsets: ArrayBuffer,
    options: ArrayBuffer,
  ): void
  bufferDrawBox(
    buffer: NativePointer,
    x: number,
    y: number,
    w: number,
    h: number,
    borderChars: ArrayBuffer,
    packedOpts: number,
    borderR: number,
    borderG: number,
    borderB: number,
    borderA: number,
    bgR: number,
    bgG: number,
    bgB: number,
    bgA: number,
  ): void
  bufferDrawEditorView(
    buffer: NativePointer,
    editorView: NativePointer,
    x: number,
    y: number,
  ): void
  bufferDrawTextBufferView(
    buffer: NativePointer,
    textBufferView: NativePointer,
    x: number,
    y: number,
  ): void
  bufferDrawChar(
    buffer: NativePointer,
    char: number,
    x: number,
    y: number,
    fgR: number,
    fgG: number,
    fgB: number,
    fgA: number,
    bgR: number,
    bgG: number,
    bgB: number,
    bgA: number,
    attributes: number,
  ): void

  // ── Link ──

  clearGlobalLinkPool(): void
  linkAlloc(url: string): number
  linkGetUrl(id: number): string
  attributesWithLink(baseAttributes: number, linkId: number): number
  attributesGetLinkId(attributes: number): number

  // ── HitGrid ──

  addToHitGrid(
    renderer: NativePointer,
    x: number,
    y: number,
    width: number,
    height: number,
    id: number,
  ): void
  clearCurrentHitGrid(renderer: NativePointer): void
  hitGridPushScissorRect(
    renderer: NativePointer,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void
  hitGridPopScissorRect(renderer: NativePointer): void
  hitGridClearScissorRects(renderer: NativePointer): void
  addToCurrentHitGridClipped(
    renderer: NativePointer,
    x: number,
    y: number,
    width: number,
    height: number,
    id: number,
  ): void
  checkHit(renderer: NativePointer, x: number, y: number): number
  getHitGridDirty(renderer: NativePointer): boolean

  // ── TextBuffer ──

  createTextBuffer(widthMethod: number): NativePointer
  destroyTextBuffer(textBuffer: NativePointer): void
  textBufferGetLength(textBuffer: NativePointer): number
  textBufferGetByteSize(textBuffer: NativePointer): number
  textBufferReset(textBuffer: NativePointer): void
  textBufferClear(textBuffer: NativePointer): void
  textBufferSetDefaultFg(
    textBuffer: NativePointer,
    r: number,
    g: number,
    b: number,
    a: number,
  ): void
  textBufferSetDefaultBg(
    textBuffer: NativePointer,
    r: number,
    g: number,
    b: number,
    a: number,
  ): void
  textBufferSetDefaultAttributes(
    textBuffer: NativePointer,
    attributes: number,
  ): void
  textBufferResetDefaults(textBuffer: NativePointer): void
  textBufferGetTabWidth(textBuffer: NativePointer): number
  textBufferSetTabWidth(textBuffer: NativePointer, width: number): void
  textBufferRegisterMemBuffer(
    textBuffer: NativePointer,
    data: string,
    owned: boolean,
  ): string
  textBufferReplaceMemBuffer(
    textBuffer: NativePointer,
    id: string,
    data: string,
    owned: boolean,
  ): void
  textBufferClearMemRegistry(textBuffer: NativePointer): void
  textBufferSetTextFromMem(textBuffer: NativePointer, id: string): void
  textBufferAppend(textBuffer: NativePointer, data: string): void
  textBufferAppendFromMemId(textBuffer: NativePointer, id: string): void
  textBufferLoadFile(textBuffer: NativePointer, path: string): void
  textBufferSetStyledText(
    textBuffer: NativePointer,
    chunks: ArrayBuffer,
    chunkCount: number,
  ): void
  textBufferGetLineCount(textBuffer: NativePointer): number
  textBufferGetPlainText(textBuffer: NativePointer): string
  textBufferAddHighlight(
    textBuffer: NativePointer,
    lineIdx: number,
    start: number,
    end: number,
    styleId: number,
    priority: number,
    hlRef: number,
  ): void
  textBufferAddHighlightByCharRange(
    textBuffer: NativePointer,
    start: number,
    end: number,
    styleId: number,
    priority: number,
    hlRef: number,
  ): void
  textBufferRemoveHighlightsByRef(
    textBuffer: NativePointer,
    hlRef: number,
  ): void
  textBufferClearLineHighlights(
    textBuffer: NativePointer,
    lineIdx: number,
  ): void
  textBufferClearAllHighlights(textBuffer: NativePointer): void
  textBufferSetSyntaxStyle(
    textBuffer: NativePointer,
    syntaxStyle: NativePointer,
  ): void
  textBufferGetLineHighlightsPtr(
    textBuffer: NativePointer,
    lineIdx: number,
  ): ArrayBuffer
  textBufferFreeLineHighlights(ptr: ArrayBuffer, count: number): void
  textBufferGetHighlightCount(textBuffer: NativePointer): number
  textBufferGetTextRange(
    textBuffer: NativePointer,
    startOffset: number,
    endOffset: number,
  ): string
  textBufferGetTextRangeByCoords(
    textBuffer: NativePointer,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): string

  // ── TextBufferView ──

  createTextBufferView(textBuffer: NativePointer): NativePointer
  destroyTextBufferView(view: NativePointer): void
  textBufferViewSetSelection(
    view: NativePointer,
    start: number,
    end: number,
    bgR: number,
    bgG: number,
    bgB: number,
    bgA: number,
    fgR: number,
    fgG: number,
    fgB: number,
    fgA: number,
  ): void
  textBufferViewResetSelection(view: NativePointer): void
  textBufferViewGetSelectionInfo(
    view: NativePointer,
  ): { start: number; end: number } | undefined
  textBufferViewSetLocalSelection(
    view: NativePointer,
    anchorX: number,
    anchorY: number,
    focusX: number,
    focusY: number,
    bgR: number,
    bgG: number,
    bgB: number,
    bgA: number,
    fgR: number,
    fgG: number,
    fgB: number,
    fgA: number,
  ): boolean
  textBufferViewUpdateSelection(
    view: NativePointer,
    end: number,
    bgR: number,
    bgG: number,
    bgB: number,
    bgA: number,
    fgR: number,
    fgG: number,
    fgB: number,
    fgA: number,
  ): void
  textBufferViewUpdateLocalSelection(
    view: NativePointer,
    anchorX: number,
    anchorY: number,
    focusX: number,
    focusY: number,
    bgR: number,
    bgG: number,
    bgB: number,
    bgA: number,
    fgR: number,
    fgG: number,
    fgB: number,
    fgA: number,
  ): boolean
  textBufferViewResetLocalSelection(view: NativePointer): void
  textBufferViewSetWrapWidth(view: NativePointer, width: number): void
  textBufferViewSetWrapMode(view: NativePointer, mode: number): void
  textBufferViewSetViewportSize(
    view: NativePointer,
    width: number,
    height: number,
  ): void
  textBufferViewSetViewport(
    view: NativePointer,
    x: number,
    y: number,
    width: number,
    height: number,
  ): void
  textBufferViewGetVirtualLineCount(view: NativePointer): number
  textBufferViewGetLineInfoDirect(view: NativePointer): object
  textBufferViewGetLogicalLineInfoDirect(view: NativePointer): object
  textBufferViewGetSelectedText(view: NativePointer): string
  textBufferViewGetPlainText(view: NativePointer): string
  textBufferViewSetTabIndicator(view: NativePointer, indicator: number): void
  textBufferViewSetTabIndicatorColor(
    view: NativePointer,
    r: number,
    g: number,
    b: number,
    a: number,
  ): void
  textBufferViewSetTruncate(view: NativePointer, truncate: boolean): void
  textBufferViewMeasureForDimensions(
    view: NativePointer,
    width: number,
    height: number,
  ): { lines: number; width: number }

  // ── EditBuffer ──

  createEditBuffer(widthMethod: number): NativePointer
  destroyEditBuffer(editBuffer: NativePointer): void
  editBufferGetTextBuffer(editBuffer: NativePointer): NativePointer
  editBufferInsertText(editBuffer: NativePointer, text: string): void
  editBufferDeleteRange(
    editBuffer: NativePointer,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): void
  editBufferDeleteCharBackward(editBuffer: NativePointer): void
  editBufferDeleteChar(editBuffer: NativePointer): void
  editBufferMoveCursorLeft(editBuffer: NativePointer): void
  editBufferMoveCursorRight(editBuffer: NativePointer): void
  editBufferMoveCursorUp(editBuffer: NativePointer): void
  editBufferMoveCursorDown(editBuffer: NativePointer): void
  editBufferGetCursor(editBuffer: NativePointer): { row: number; col: number }
  editBufferSetCursor(editBuffer: NativePointer, row: number, col: number): void
  editBufferSetCursorToLineCol(
    editBuffer: NativePointer,
    row: number,
    col: number,
  ): void
  editBufferSetCursorByOffset(editBuffer: NativePointer, offset: number): void
  editBufferGetNextWordBoundary(editBuffer: NativePointer): number
  editBufferGetPrevWordBoundary(editBuffer: NativePointer): number
  editBufferGetEOL(editBuffer: NativePointer): number
  editBufferOffsetToPosition(
    editBuffer: NativePointer,
    offset: number,
  ): { row: number; col: number }
  editBufferPositionToOffset(
    editBuffer: NativePointer,
    row: number,
    col: number,
  ): number
  editBufferGetLineStartOffset(editBuffer: NativePointer, row: number): number
  editBufferGetTextRange(
    editBuffer: NativePointer,
    startOffset: number,
    endOffset: number,
  ): string
  editBufferGetTextRangeByCoords(
    editBuffer: NativePointer,
    startRow: number,
    startCol: number,
    endRow: number,
    endCol: number,
  ): string
  editBufferSetText(editBuffer: NativePointer, text: string): void
  editBufferSetTextFromMem(editBuffer: NativePointer, memId: string): void
  editBufferReplaceText(editBuffer: NativePointer, text: string): void
  editBufferReplaceTextFromMem(editBuffer: NativePointer, memId: string): void
  editBufferGetText(editBuffer: NativePointer): string
  editBufferInsertChar(editBuffer: NativePointer, char: number): void
  editBufferNewLine(editBuffer: NativePointer): void
  editBufferDeleteLine(editBuffer: NativePointer): void
  editBufferGotoLine(editBuffer: NativePointer, line: number): void
  editBufferGetCursorPosition(editBuffer: NativePointer): {
    row: number
    col: number
    offset: number
  }
  editBufferGetId(editBuffer: NativePointer): string
  editBufferDebugLogRope(editBuffer: NativePointer): void
  editBufferUndo(editBuffer: NativePointer): void
  editBufferRedo(editBuffer: NativePointer): void
  editBufferCanUndo(editBuffer: NativePointer): boolean
  editBufferCanRedo(editBuffer: NativePointer): boolean
  editBufferClearHistory(editBuffer: NativePointer): void
  editBufferClear(editBuffer: NativePointer): void

  // ── EditorView ──

  createEditorView(
    editBuffer: NativePointer,
    viewportWidth: number,
    viewportHeight: number,
  ): NativePointer
  destroyEditorView(view: NativePointer): void
  editorViewSetViewport(
    view: NativePointer,
    x: number,
    y: number,
    width: number,
    height: number,
    moveCursor: boolean,
  ): void
  editorViewClearViewport(view: NativePointer): void
  editorViewGetViewport(view: NativePointer): {
    x: number
    y: number
    width: number
    height: number
  }
  editorViewSetScrollMargin(view: NativePointer, margin: number): void
  editorViewGetVirtualLineCount(view: NativePointer): number
  editorViewGetTotalVirtualLineCount(view: NativePointer): number
  editorViewGetLineInfoDirect(view: NativePointer): object
  editorViewGetTextBufferView(view: NativePointer): NativePointer
  editorViewGetLogicalLineInfoDirect(view: NativePointer): object
  editorViewSetViewportSize(
    view: NativePointer,
    width: number,
    height: number,
  ): void
  editorViewSetWrapMode(view: NativePointer, mode: number): void
  editorViewSetSelection(
    view: NativePointer,
    start: number,
    end: number,
    bgR: number,
    bgG: number,
    bgB: number,
    bgA: number,
    fgR: number,
    fgG: number,
    fgB: number,
    fgA: number,
  ): void
  editorViewResetSelection(view: NativePointer): void
  editorViewGetSelection(
    view: NativePointer,
  ): { start: number; end: number } | undefined
  editorViewSetLocalSelection(
    view: NativePointer,
    anchorX: number,
    anchorY: number,
    focusX: number,
    focusY: number,
    bgR: number,
    bgG: number,
    bgB: number,
    bgA: number,
    fgR: number,
    fgG: number,
    fgB: number,
    fgA: number,
    updateCursor: boolean,
    followCursor: boolean,
  ): boolean
  editorViewUpdateSelection(
    view: NativePointer,
    end: number,
    bgR: number,
    bgG: number,
    bgB: number,
    bgA: number,
    fgR: number,
    fgG: number,
    fgB: number,
    fgA: number,
  ): void
  editorViewUpdateLocalSelection(
    view: NativePointer,
    anchorX: number,
    anchorY: number,
    focusX: number,
    focusY: number,
    bgR: number,
    bgG: number,
    bgB: number,
    bgA: number,
    fgR: number,
    fgG: number,
    fgB: number,
    fgA: number,
    updateCursor: boolean,
    followCursor: boolean,
  ): boolean
  editorViewResetLocalSelection(view: NativePointer): void
  editorViewGetSelectedTextBytes(view: NativePointer): ArrayBuffer
  editorViewGetCursor(view: NativePointer): { row: number; col: number }
  editorViewGetText(view: NativePointer): string
  editorViewGetVisualCursor(view: NativePointer): {
    visualRow: number
    visualCol: number
    logicalRow: number
    logicalCol: number
    offset: number
  }
  editorViewMoveUpVisual(view: NativePointer): void
  editorViewMoveDownVisual(view: NativePointer): void
  editorViewDeleteSelectedText(view: NativePointer): void
  editorViewSetCursorByOffset(view: NativePointer, offset: number): void
  editorViewGetNextWordBoundary(view: NativePointer): number
  editorViewGetPrevWordBoundary(view: NativePointer): number
  editorViewGetEOL(view: NativePointer): number
  editorViewGetVisualSOL(view: NativePointer): number
  editorViewGetVisualEOL(view: NativePointer): number
  editorViewSetPlaceholderStyledText(
    view: NativePointer,
    chunks: ArrayBuffer,
    chunkCount: number,
  ): void
  editorViewSetTabIndicator(view: NativePointer, indicator: number): void
  editorViewSetTabIndicatorColor(
    view: NativePointer,
    r: number,
    g: number,
    b: number,
    a: number,
  ): void

  // ── SyntaxStyle ──

  createSyntaxStyle(): NativePointer
  destroySyntaxStyle(style: NativePointer): void
  syntaxStyleRegister(
    style: NativePointer,
    name: string,
    fgR: number,
    fgG: number,
    fgB: number,
    fgA: number,
    bgR: number,
    bgG: number,
    bgB: number,
    bgA: number,
    attributes: number,
  ): number
  syntaxStyleResolveByName(style: NativePointer, name: string): number
  syntaxStyleGetStyleCount(style: NativePointer): number

  // ── Unicode ──

  encodeUnicode(text: string, widthMethod: number): ArrayBuffer
  freeUnicode(chars: ArrayBuffer, charsLen: number): void

  // ── NativeSpanFeed ──

  createNativeSpanFeed(options: ArrayBuffer): NativePointer
  destroyNativeSpanFeed(stream: NativePointer): void
  attachNativeSpanFeed(stream: NativePointer): number
  streamClose(stream: NativePointer): number
  streamWrite(stream: NativePointer, data: string): number
  streamCommit(stream: NativePointer): number
  streamReserve(
    stream: NativePointer,
    minLen: number,
  ): { ptr: ArrayBuffer; len: number } | number
  streamCommitReserved(stream: NativePointer, len: number): number
  streamSetOptions(stream: NativePointer, options: ArrayBuffer): number
  streamGetStats(stream: NativePointer): {
    totalBytesWritten: number
    totalSpansEmitted: number
    totalCommits: number
    chunksAllocated: number
    chunksInUse: number
    currentChunkUsed: number
    pendingSpanBytes: number
    attached: boolean
  }
  streamDrainSpans(
    stream: NativePointer,
    outPtr: ArrayBuffer,
    maxSpans: number,
  ): number
  streamSetCallback(
    stream: NativePointer,
    callback: (() => void) | undefined,
  ): void

  // ── Performance: batch/direct buffer access ──

  bufferDrawTextEncoded(
    buffer: NativePointer,
    data: Uint8Array,
    x: number,
    y: number,
    fgR: number,
    fgG: number,
    fgB: number,
    fgA: number,
    bgR: number,
    bgG: number,
    bgB: number,
    bgA: number,
    attributes: number,
  ): void
  bufferGetCharArrayBuffer(buffer: NativePointer): ArrayBuffer
  bufferGetFgArrayBuffer(buffer: NativePointer): ArrayBuffer
  bufferGetBgArrayBuffer(buffer: NativePointer): ArrayBuffer
  bufferGetAttributesArrayBuffer(buffer: NativePointer): ArrayBuffer
  editBufferGetCursorInto(editBuffer: NativePointer, out: Uint32Array): void
  editorViewGetCursorInto(view: NativePointer, out: Uint32Array): void
  getCursorStateInto(renderer: NativePointer, out: Int32Array): void

  // ── Performance: Float32Array color variants ──

  bufferDrawTextFA(
    buffer: NativePointer,
    text: string,
    x: number,
    y: number,
    fg: Float32Array,
    bg: Float32Array,
    attributes: number,
  ): void
  bufferSetCellFA(
    buffer: NativePointer,
    x: number,
    y: number,
    char: number,
    fg: Float32Array,
    bg: Float32Array,
  ): void
  bufferDrawCharFA(
    buffer: NativePointer,
    char: number,
    x: number,
    y: number,
    fg: Float32Array,
    bg: Float32Array,
    attributes: number,
  ): void
  bufferFillRectFA(
    buffer: NativePointer,
    x: number,
    y: number,
    width: number,
    height: number,
    bg: Float32Array,
  ): void

  // ── Performance: binary render paths ──

  bufferDrawPackedBufferBinary(
    buffer: NativePointer,
    data: Uint8Array,
    posX: number,
    posY: number,
    terminalWidthCells: number,
    terminalHeightCells: number,
  ): void
  writeOutBinary(renderer: NativePointer, data: Uint8Array): void

  // ── Performance: short-string optimized ──

  editBufferInsertTextFast(editBuffer: NativePointer, text: string): void
  textBufferAppendFast(textBuffer: NativePointer, data: string): void

  // ── Performance: right-sized output ──

  textBufferGetPlainTextSized(textBuffer: NativePointer): string
  editBufferGetTextSized(editBuffer: NativePointer): string
}

export type { NativePointer }

declare const bindings: OpenTUIBindings
export default bindings
