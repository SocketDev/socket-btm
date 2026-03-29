/// Grouped node-api wrappers for OpenTUI C ABI exports.
/// Each function takes (napi_env, napi_callback_info) and returns napi_value.
///
/// The upstream lib.zig `export fn` symbols are linked at the shared library level.
/// We call them via extern declarations matching their C ABI signatures.
const napi = @import("napi.zig");
const c = napi.c;

// ── Opaque types for upstream pointers ──────────────────────────────

const CliRenderer = opaque {};
const OptimizedBuffer = opaque {};
const UnifiedTextBuffer = opaque {};
const UnifiedTextBufferView = opaque {};
const EditBuffer = opaque {};
const EditorView = opaque {};
const SyntaxStyle = opaque {};
const NativeSpanFeedStream = opaque {};

// ── External declarations for upstream OpenTUI C exports ──────────────
// Resolved at link time from upstream lib.zig / native-span-feed.zig.

// System
extern fn getArenaAllocatedBytes() usize;
extern fn getBuildOptions(out_ptr: *anyopaque) void;
extern fn getAllocatorStats(out_ptr: *anyopaque) void;

// Callbacks
extern fn setLogCallback(callback: ?*const anyopaque) void;
extern fn setEventCallback(callback: ?*const anyopaque) void;

// Renderer lifecycle
extern fn createRenderer(width: u32, height: u32, testing: bool, remote: bool) ?*CliRenderer;
extern fn destroyRenderer(rendererPtr: *CliRenderer) void;
extern fn render(rendererPtr: *CliRenderer, force: bool) void;
extern fn getNextBuffer(rendererPtr: *CliRenderer) *OptimizedBuffer;
extern fn getCurrentBuffer(rendererPtr: *CliRenderer) *OptimizedBuffer;
extern fn setBackgroundColor(rendererPtr: *CliRenderer, color: [*]const f32) void;
extern fn setRenderOffset(rendererPtr: *CliRenderer, offset: u32) void;
extern fn setUseThread(rendererPtr: *CliRenderer, useThread: bool) void;
extern fn setDebugOverlay(rendererPtr: *CliRenderer, enabled: bool, corner: u8) void;
extern fn clearTerminal(rendererPtr: *CliRenderer) void;
extern fn setCursorPosition(rendererPtr: *CliRenderer, x: i32, y: i32, visible: bool) void;
extern fn setTerminalEnvVar(rendererPtr: *CliRenderer, keyPtr: [*]const u8, keyLen: usize, valuePtr: [*]const u8, valueLen: usize) bool;
extern fn updateStats(rendererPtr: *CliRenderer, time: f64, fps: u32, frameCallbackTime: f64) void;
extern fn updateMemoryStats(rendererPtr: *CliRenderer, heapUsed: u32, heapTotal: u32, arrayBuffers: u32) void;
extern fn getLastOutputForTest(rendererPtr: *CliRenderer, outSlice: *anyopaque) void;
extern fn setHyperlinksCapability(rendererPtr: *CliRenderer, enabled: bool) void;
extern fn resizeRenderer(rendererPtr: *CliRenderer, width: u32, height: u32) void;
extern fn getTerminalCapabilities(rendererPtr: *CliRenderer, capsPtr: *anyopaque) void;
extern fn processCapabilityResponse(rendererPtr: *CliRenderer, responsePtr: [*]const u8, responseLen: usize) void;
extern fn setCursorColor(rendererPtr: *CliRenderer, color: [*]const f32) void;
extern fn setCursorStyleOptions(rendererPtr: *CliRenderer, options: *const anyopaque) void;
extern fn getCursorState(rendererPtr: *CliRenderer, outPtr: *anyopaque) void;
extern fn setTerminalTitle(rendererPtr: *CliRenderer, titlePtr: [*]const u8, titleLen: usize) void;
extern fn copyToClipboardOSC52(rendererPtr: *CliRenderer, target: u8, payloadPtr: [*]const u8, payloadLen: usize) bool;
extern fn clearClipboardOSC52(rendererPtr: *CliRenderer, target: u8) bool;
extern fn dumpBuffers(rendererPtr: *CliRenderer, timestamp: i64) void;
extern fn dumpStdoutBuffer(rendererPtr: *CliRenderer, timestamp: i64) void;
extern fn dumpHitGrid(rendererPtr: *CliRenderer) void;
extern fn restoreTerminalModes(rendererPtr: *CliRenderer) void;
extern fn enableMouse(rendererPtr: *CliRenderer, enableMovement: bool) void;
extern fn disableMouse(rendererPtr: *CliRenderer) void;
extern fn queryPixelResolution(rendererPtr: *CliRenderer) void;
extern fn enableKittyKeyboard(rendererPtr: *CliRenderer, flags: u8) void;
extern fn disableKittyKeyboard(rendererPtr: *CliRenderer) void;
extern fn setKittyKeyboardFlags(rendererPtr: *CliRenderer, flags: u8) void;
extern fn getKittyKeyboardFlags(rendererPtr: *CliRenderer) u8;
extern fn setupTerminal(rendererPtr: *CliRenderer, useAlternateScreen: bool) void;
extern fn suspendRenderer(rendererPtr: *CliRenderer) void;
extern fn resumeRenderer(rendererPtr: *CliRenderer) void;
extern fn writeOut(rendererPtr: *CliRenderer, dataPtr: [*]const u8, dataLen: usize) void;

// Buffer operations
extern fn createOptimizedBuffer(width: u32, height: u32, respectAlpha: bool, widthMethod: u8, idPtr: [*]const u8, idLen: usize) ?*OptimizedBuffer;
extern fn destroyOptimizedBuffer(bufferPtr: *OptimizedBuffer) void;
extern fn destroyFrameBuffer(frameBufferPtr: *OptimizedBuffer) void;
extern fn drawFrameBuffer(targetPtr: *OptimizedBuffer, destX: i32, destY: i32, frameBuffer: *OptimizedBuffer, sourceX: u32, sourceY: u32, sourceWidth: u32, sourceHeight: u32) void;
extern fn getBufferWidth(bufferPtr: *OptimizedBuffer) u32;
extern fn getBufferHeight(bufferPtr: *OptimizedBuffer) u32;
extern fn bufferClear(bufferPtr: *OptimizedBuffer, bg: [*]const f32) void;
extern fn bufferResize(bufferPtr: *OptimizedBuffer, width: u32, height: u32) void;
extern fn bufferFillRect(bufferPtr: *OptimizedBuffer, x: u32, y: u32, width: u32, height: u32, bg: [*]const f32) void;
extern fn bufferGetCharPtr(bufferPtr: *OptimizedBuffer) *anyopaque;
extern fn bufferGetFgPtr(bufferPtr: *OptimizedBuffer) *anyopaque;
extern fn bufferGetBgPtr(bufferPtr: *OptimizedBuffer) *anyopaque;
extern fn bufferGetAttributesPtr(bufferPtr: *OptimizedBuffer) *anyopaque;
extern fn bufferGetRespectAlpha(bufferPtr: *OptimizedBuffer) bool;
extern fn bufferSetRespectAlpha(bufferPtr: *OptimizedBuffer, respectAlpha: bool) void;
extern fn bufferGetId(bufferPtr: *OptimizedBuffer, outPtr: [*]u8, maxLen: usize) usize;
extern fn bufferGetRealCharSize(bufferPtr: *OptimizedBuffer) u32;
extern fn bufferWriteResolvedChars(bufferPtr: *OptimizedBuffer, outputPtr: [*]u8, outputLen: usize, addLineBreaks: bool) u32;
extern fn bufferDrawText(bufferPtr: *OptimizedBuffer, text: [*]const u8, textLen: usize, x: u32, y: u32, fg: [*]const f32, bg: ?[*]const f32, attributes: u32) void;
extern fn bufferSetCellWithAlphaBlending(bufferPtr: *OptimizedBuffer, x: u32, y: u32, char: u32, fg: [*]const f32, bg: [*]const f32, attributes: u32) void;
extern fn bufferSetCell(bufferPtr: *OptimizedBuffer, x: u32, y: u32, char: u32, fg: [*]const f32, bg: [*]const f32, attributes: u32) void;
extern fn bufferColorMatrix(bufferPtr: *OptimizedBuffer, matrixPtr: [*]const f32, cellMaskPtr: [*]const f32, cellMaskCount: usize, strength: f32, target: u8) void;
extern fn bufferColorMatrixUniform(bufferPtr: *OptimizedBuffer, matrixPtr: [*]const f32, strength: f32, target: u8) void;
extern fn bufferDrawPackedBuffer(bufferPtr: *OptimizedBuffer, data: [*]const u8, dataLen: usize, posX: u32, posY: u32, terminalWidthCells: u32, terminalHeightCells: u32) void;
extern fn bufferDrawGrayscaleBuffer(bufferPtr: *OptimizedBuffer, posX: i32, posY: i32, intensities: [*]const f32, srcWidth: u32, srcHeight: u32, fg: ?[*]const f32, bg: ?[*]const f32) void;
extern fn bufferDrawGrayscaleBufferSupersampled(bufferPtr: *OptimizedBuffer, posX: i32, posY: i32, intensities: [*]const f32, srcWidth: u32, srcHeight: u32, fg: ?[*]const f32, bg: ?[*]const f32) void;
extern fn bufferPushScissorRect(bufferPtr: *OptimizedBuffer, x: i32, y: i32, width: u32, height: u32) void;
extern fn bufferPopScissorRect(bufferPtr: *OptimizedBuffer) void;
extern fn bufferClearScissorRects(bufferPtr: *OptimizedBuffer) void;
extern fn bufferPushOpacity(bufferPtr: *OptimizedBuffer, opacity: f32) void;
extern fn bufferPopOpacity(bufferPtr: *OptimizedBuffer) void;
extern fn bufferGetCurrentOpacity(bufferPtr: *OptimizedBuffer) f32;
extern fn bufferClearOpacity(bufferPtr: *OptimizedBuffer) void;
extern fn bufferDrawSuperSampleBuffer(bufferPtr: *OptimizedBuffer, x: u32, y: u32, pixelData: [*]const u8, len: usize, format: u8, alignedBytesPerRow: u32) void;
extern fn bufferDrawGrid(bufferPtr: *OptimizedBuffer, borderChars: [*]const u32, borderFg: [*]const f32, borderBg: [*]const f32, columnOffsets: [*]const i32, columnCount: u32, rowOffsets: [*]const i32, rowCount: u32, options: *const anyopaque) void;
extern fn bufferDrawBox(bufferPtr: *OptimizedBuffer, x: i32, y: i32, width: u32, height: u32, borderChars: [*]const u32, packedOptions: u32, borderColor: [*]const f32, backgroundColor: [*]const f32, title: ?[*]const u8, titleLen: u32) void;
extern fn bufferDrawEditorView(bufferPtr: *OptimizedBuffer, viewPtr: *EditorView, x: i32, y: i32) void;
extern fn bufferDrawTextBufferView(bufferPtr: *OptimizedBuffer, viewPtr: *UnifiedTextBufferView, x: i32, y: i32) void;
extern fn bufferDrawChar(bufferPtr: *OptimizedBuffer, char: u32, x: u32, y: u32, fg: [*]const f32, bg: [*]const f32, attributes: u32) void;

// Link
extern fn clearGlobalLinkPool() void;
extern fn linkAlloc(urlPtr: [*]const u8, urlLen: usize) u32;
extern fn linkGetUrl(id: u32, outPtr: [*]u8, maxLen: usize) usize;
extern fn attributesWithLink(baseAttributes: u32, linkId: u32) u32;
extern fn attributesGetLinkId(attributes: u32) u32;

// HitGrid
extern fn addToHitGrid(rendererPtr: *CliRenderer, x: i32, y: i32, width: u32, height: u32, id: u32) void;
extern fn clearCurrentHitGrid(rendererPtr: *CliRenderer) void;
extern fn hitGridPushScissorRect(rendererPtr: *CliRenderer, x: i32, y: i32, width: u32, height: u32) void;
extern fn hitGridPopScissorRect(rendererPtr: *CliRenderer) void;
extern fn hitGridClearScissorRects(rendererPtr: *CliRenderer) void;
extern fn addToCurrentHitGridClipped(rendererPtr: *CliRenderer, x: i32, y: i32, width: u32, height: u32, id: u32) void;
extern fn checkHit(rendererPtr: *CliRenderer, x: u32, y: u32) u32;
extern fn getHitGridDirty(rendererPtr: *CliRenderer) bool;

// TextBuffer
extern fn createTextBuffer(widthMethod: u8) ?*UnifiedTextBuffer;
extern fn destroyTextBuffer(tb: *UnifiedTextBuffer) void;
extern fn textBufferGetLength(tb: *UnifiedTextBuffer) u32;
extern fn textBufferGetByteSize(tb: *UnifiedTextBuffer) u32;
extern fn textBufferReset(tb: *UnifiedTextBuffer) void;
extern fn textBufferClear(tb: *UnifiedTextBuffer) void;
extern fn textBufferSetDefaultFg(tb: *UnifiedTextBuffer, fg: ?[*]const f32) void;
extern fn textBufferSetDefaultBg(tb: *UnifiedTextBuffer, bg: ?[*]const f32) void;
extern fn textBufferSetDefaultAttributes(tb: *UnifiedTextBuffer, attr: ?[*]const u32) void;
extern fn textBufferResetDefaults(tb: *UnifiedTextBuffer) void;
extern fn textBufferGetTabWidth(tb: *UnifiedTextBuffer) u8;
extern fn textBufferSetTabWidth(tb: *UnifiedTextBuffer, width: u8) void;
extern fn textBufferRegisterMemBuffer(tb: *UnifiedTextBuffer, dataPtr: [*]const u8, dataLen: usize, owned: bool) u16;
extern fn textBufferReplaceMemBuffer(tb: *UnifiedTextBuffer, id: u8, dataPtr: [*]const u8, dataLen: usize, owned: bool) bool;
extern fn textBufferClearMemRegistry(tb: *UnifiedTextBuffer) void;
extern fn textBufferSetTextFromMem(tb: *UnifiedTextBuffer, id: u8) void;
extern fn textBufferAppend(tb: *UnifiedTextBuffer, dataPtr: [*]const u8, dataLen: usize) void;
extern fn textBufferAppendFromMemId(tb: *UnifiedTextBuffer, id: u8) void;
extern fn textBufferLoadFile(tb: *UnifiedTextBuffer, pathPtr: [*]const u8, pathLen: usize) bool;
extern fn textBufferSetStyledText(tb: *UnifiedTextBuffer, chunksPtr: *const anyopaque, chunkCount: usize) void;
extern fn textBufferGetLineCount(tb: *UnifiedTextBuffer) u32;
extern fn textBufferGetPlainText(tb: *UnifiedTextBuffer, outPtr: [*]u8, maxLen: usize) usize;
extern fn textBufferAddHighlight(tb: *UnifiedTextBuffer, line_idx: u32, hl_ptr: *const anyopaque) void;
extern fn textBufferAddHighlightByCharRange(tb: *UnifiedTextBuffer, hl_ptr: *const anyopaque) void;
extern fn textBufferRemoveHighlightsByRef(tb: *UnifiedTextBuffer, hl_ref: u16) void;
extern fn textBufferClearLineHighlights(tb: *UnifiedTextBuffer, line_idx: u32) void;
extern fn textBufferClearAllHighlights(tb: *UnifiedTextBuffer) void;
extern fn textBufferSetSyntaxStyle(tb: *UnifiedTextBuffer, style: ?*SyntaxStyle) void;
extern fn textBufferGetLineHighlightsPtr(tb: *UnifiedTextBuffer, line_idx: u32, out_count: *usize) ?*const anyopaque;
extern fn textBufferFreeLineHighlights(ptr: *const anyopaque, count: usize) void;
extern fn textBufferGetHighlightCount(tb: *UnifiedTextBuffer) u32;
extern fn textBufferGetTextRange(tb: *UnifiedTextBuffer, start_offset: u32, end_offset: u32, outPtr: [*]u8, maxLen: usize) usize;
extern fn textBufferGetTextRangeByCoords(tb: *UnifiedTextBuffer, start_row: u32, start_col: u32, end_row: u32, end_col: u32, outPtr: [*]u8, maxLen: usize) usize;

// TextBufferView
extern fn createTextBufferView(tb: *UnifiedTextBuffer) ?*UnifiedTextBufferView;
extern fn destroyTextBufferView(view: *UnifiedTextBufferView) void;
extern fn textBufferViewSetSelection(view: *UnifiedTextBufferView, start: u32, end: u32, bgColor: ?[*]const f32, fgColor: ?[*]const f32) void;
extern fn textBufferViewResetSelection(view: *UnifiedTextBufferView) void;
extern fn textBufferViewGetSelectionInfo(view: *UnifiedTextBufferView) u64;
extern fn textBufferViewSetLocalSelection(view: *UnifiedTextBufferView, anchorX: i32, anchorY: i32, focusX: i32, focusY: i32, bgColor: ?[*]const f32, fgColor: ?[*]const f32) bool;
extern fn textBufferViewUpdateSelection(view: *UnifiedTextBufferView, end: u32, bgColor: ?[*]const f32, fgColor: ?[*]const f32) void;
extern fn textBufferViewUpdateLocalSelection(view: *UnifiedTextBufferView, anchorX: i32, anchorY: i32, focusX: i32, focusY: i32, bgColor: ?[*]const f32, fgColor: ?[*]const f32) bool;
extern fn textBufferViewResetLocalSelection(view: *UnifiedTextBufferView) void;
extern fn textBufferViewSetWrapWidth(view: *UnifiedTextBufferView, width: u32) void;
extern fn textBufferViewSetWrapMode(view: *UnifiedTextBufferView, mode: u8) void;
extern fn textBufferViewSetViewportSize(view: *UnifiedTextBufferView, width: u32, height: u32) void;
extern fn textBufferViewSetViewport(view: *UnifiedTextBufferView, x: u32, y: u32, width: u32, height: u32) void;
extern fn textBufferViewGetVirtualLineCount(view: *UnifiedTextBufferView) u32;
extern fn textBufferViewGetLineInfoDirect(view: *UnifiedTextBufferView, outPtr: *anyopaque) void;
extern fn textBufferViewGetLogicalLineInfoDirect(view: *UnifiedTextBufferView, outPtr: *anyopaque) void;
extern fn textBufferViewGetSelectedText(view: *UnifiedTextBufferView, outPtr: [*]u8, maxLen: usize) usize;
extern fn textBufferViewGetPlainText(view: *UnifiedTextBufferView, outPtr: [*]u8, maxLen: usize) usize;
extern fn textBufferViewSetTabIndicator(view: *UnifiedTextBufferView, indicator: u32) void;
extern fn textBufferViewSetTabIndicatorColor(view: *UnifiedTextBufferView, color: [*]const f32) void;
extern fn textBufferViewSetTruncate(view: *UnifiedTextBufferView, truncate: bool) void;
extern fn textBufferViewMeasureForDimensions(view: *UnifiedTextBufferView, width: u32, height: u32, outPtr: *anyopaque) bool;

// EditBuffer
extern fn createEditBuffer(widthMethod: u8) ?*EditBuffer;
extern fn destroyEditBuffer(edit_buffer: *EditBuffer) void;
extern fn editBufferGetTextBuffer(edit_buffer: *EditBuffer) *UnifiedTextBuffer;
extern fn editBufferInsertText(edit_buffer: *EditBuffer, textPtr: [*]const u8, textLen: usize) void;
extern fn editBufferDeleteRange(edit_buffer: *EditBuffer, start_row: u32, start_col: u32, end_row: u32, end_col: u32) void;
extern fn editBufferDeleteCharBackward(edit_buffer: *EditBuffer) void;
extern fn editBufferDeleteChar(edit_buffer: *EditBuffer) void;
extern fn editBufferMoveCursorLeft(edit_buffer: *EditBuffer) void;
extern fn editBufferMoveCursorRight(edit_buffer: *EditBuffer) void;
extern fn editBufferMoveCursorUp(edit_buffer: *EditBuffer) void;
extern fn editBufferMoveCursorDown(edit_buffer: *EditBuffer) void;
extern fn editBufferGetCursor(edit_buffer: *EditBuffer, outRow: *u32, outCol: *u32) void;
extern fn editBufferSetCursor(edit_buffer: *EditBuffer, row: u32, col: u32) void;
extern fn editBufferSetCursorToLineCol(edit_buffer: *EditBuffer, row: u32, col: u32) void;
extern fn editBufferSetCursorByOffset(edit_buffer: *EditBuffer, offset: u32) void;
extern fn editBufferGetNextWordBoundary(edit_buffer: *EditBuffer, outPtr: *anyopaque) void;
extern fn editBufferGetPrevWordBoundary(edit_buffer: *EditBuffer, outPtr: *anyopaque) void;
extern fn editBufferGetEOL(edit_buffer: *EditBuffer, outPtr: *anyopaque) void;
extern fn editBufferOffsetToPosition(edit_buffer: *EditBuffer, offset: u32, outPtr: *anyopaque) bool;
extern fn editBufferPositionToOffset(edit_buffer: *EditBuffer, row: u32, col: u32) u32;
extern fn editBufferGetLineStartOffset(edit_buffer: *EditBuffer, row: u32) u32;
extern fn editBufferGetTextRange(edit_buffer: *EditBuffer, start_offset: u32, end_offset: u32, outPtr: [*]u8, maxLen: usize) usize;
extern fn editBufferGetTextRangeByCoords(edit_buffer: *EditBuffer, start_row: u32, start_col: u32, end_row: u32, end_col: u32, outPtr: [*]u8, maxLen: usize) usize;
extern fn editBufferSetText(edit_buffer: *EditBuffer, textPtr: [*]const u8, textLen: usize) void;
extern fn editBufferSetTextFromMem(edit_buffer: *EditBuffer, mem_id: u8) void;
extern fn editBufferReplaceText(edit_buffer: *EditBuffer, textPtr: [*]const u8, textLen: usize) void;
extern fn editBufferReplaceTextFromMem(edit_buffer: *EditBuffer, mem_id: u8) void;
extern fn editBufferGetText(edit_buffer: *EditBuffer, outPtr: [*]u8, maxLen: usize) usize;
extern fn editBufferInsertChar(edit_buffer: *EditBuffer, charPtr: [*]const u8, charLen: usize) void;
extern fn editBufferNewLine(edit_buffer: *EditBuffer) void;
extern fn editBufferDeleteLine(edit_buffer: *EditBuffer) void;
extern fn editBufferGotoLine(edit_buffer: *EditBuffer, line: u32) void;
extern fn editBufferGetCursorPosition(edit_buffer: *EditBuffer, outPtr: *anyopaque) void;
extern fn editBufferGetId(edit_buffer: *EditBuffer) u16;
extern fn editBufferDebugLogRope(edit_buffer: *EditBuffer) void;
extern fn editBufferUndo(edit_buffer: *EditBuffer, outPtr: [*]u8, maxLen: usize) usize;
extern fn editBufferRedo(edit_buffer: *EditBuffer, outPtr: [*]u8, maxLen: usize) usize;
extern fn editBufferCanUndo(edit_buffer: *EditBuffer) bool;
extern fn editBufferCanRedo(edit_buffer: *EditBuffer) bool;
extern fn editBufferClearHistory(edit_buffer: *EditBuffer) void;
extern fn editBufferClear(edit_buffer: *EditBuffer) void;

// EditorView
extern fn createEditorView(edit_buffer: *EditBuffer, viewport_width: u32, viewport_height: u32) ?*EditorView;
extern fn destroyEditorView(view: *EditorView) void;
extern fn editorViewSetViewport(view: *EditorView, x: u32, y: u32, width: u32, height: u32, moveCursor: bool) void;
extern fn editorViewClearViewport(view: *EditorView) void;
extern fn editorViewGetViewport(view: *EditorView, outX: *u32, outY: *u32, outWidth: *u32, outHeight: *u32) bool;
extern fn editorViewSetScrollMargin(view: *EditorView, margin: f32) void;
extern fn editorViewGetVirtualLineCount(view: *EditorView) u32;
extern fn editorViewGetTotalVirtualLineCount(view: *EditorView) u32;
extern fn editorViewGetLineInfoDirect(view: *EditorView, outPtr: *anyopaque) void;
extern fn editorViewGetTextBufferView(view: *EditorView) *UnifiedTextBufferView;
extern fn editorViewGetLogicalLineInfoDirect(view: *EditorView, outPtr: *anyopaque) void;
extern fn editorViewSetViewportSize(view: *EditorView, width: u32, height: u32) void;
extern fn editorViewSetWrapMode(view: *EditorView, mode: u8) void;
extern fn editorViewSetSelection(view: *EditorView, start: u32, end: u32, bgColor: ?[*]const f32, fgColor: ?[*]const f32) void;
extern fn editorViewResetSelection(view: *EditorView) void;
extern fn editorViewGetSelection(view: *EditorView) u64;
extern fn editorViewSetLocalSelection(view: *EditorView, anchorX: i32, anchorY: i32, focusX: i32, focusY: i32, bgColor: ?[*]const f32, fgColor: ?[*]const f32, updateCursor: bool, followCursor: bool) bool;
extern fn editorViewUpdateSelection(view: *EditorView, end: u32, bgColor: ?[*]const f32, fgColor: ?[*]const f32) void;
extern fn editorViewUpdateLocalSelection(view: *EditorView, anchorX: i32, anchorY: i32, focusX: i32, focusY: i32, bgColor: ?[*]const f32, fgColor: ?[*]const f32, updateCursor: bool, followCursor: bool) bool;
extern fn editorViewResetLocalSelection(view: *EditorView) void;
extern fn editorViewGetSelectedTextBytes(view: *EditorView, outPtr: [*]u8, maxLen: usize) usize;
extern fn editorViewGetCursor(view: *EditorView, outRow: *u32, outCol: *u32) void;
extern fn editorViewGetText(view: *EditorView, outPtr: [*]u8, maxLen: usize) usize;
extern fn editorViewGetVisualCursor(view: *EditorView, outPtr: *anyopaque) void;
extern fn editorViewMoveUpVisual(view: *EditorView) void;
extern fn editorViewMoveDownVisual(view: *EditorView) void;
extern fn editorViewDeleteSelectedText(view: *EditorView) void;
extern fn editorViewSetCursorByOffset(view: *EditorView, offset: u32) void;
extern fn editorViewGetNextWordBoundary(view: *EditorView, outPtr: *anyopaque) void;
extern fn editorViewGetPrevWordBoundary(view: *EditorView, outPtr: *anyopaque) void;
extern fn editorViewGetEOL(view: *EditorView, outPtr: *anyopaque) void;
extern fn editorViewGetVisualSOL(view: *EditorView, outPtr: *anyopaque) void;
extern fn editorViewGetVisualEOL(view: *EditorView, outPtr: *anyopaque) void;
extern fn editorViewSetPlaceholderStyledText(view: *EditorView, chunksPtr: *const anyopaque, chunkCount: usize) void;
extern fn editorViewSetTabIndicator(view: *EditorView, indicator: u32) void;
extern fn editorViewSetTabIndicatorColor(view: *EditorView, color: [*]const f32) void;

// SyntaxStyle
extern fn createSyntaxStyle() ?*SyntaxStyle;
extern fn destroySyntaxStyle(style: *SyntaxStyle) void;
extern fn syntaxStyleRegister(style: *SyntaxStyle, namePtr: [*]const u8, nameLen: usize, fg: ?[*]const f32, bg: ?[*]const f32, attributes: u32) u32;
extern fn syntaxStyleResolveByName(style: *SyntaxStyle, namePtr: [*]const u8, nameLen: usize) u32;
extern fn syntaxStyleGetStyleCount(style: *SyntaxStyle) usize;

// Unicode
extern fn encodeUnicode(textPtr: [*]const u8, textLen: usize, outPtr: *?*anyopaque, outLenPtr: *usize, widthMethod: u8) bool;
extern fn freeUnicode(charsPtr: *const anyopaque, charsLen: usize) void;

// NativeSpanFeed
extern fn createNativeSpanFeed(options_ptr: ?*const anyopaque) ?*NativeSpanFeedStream;
extern fn destroyNativeSpanFeed(stream: ?*NativeSpanFeedStream) void;
extern fn attachNativeSpanFeed(stream: ?*NativeSpanFeedStream) i32;
extern fn streamClose(stream: ?*NativeSpanFeedStream) i32;
extern fn streamWrite(stream: ?*NativeSpanFeedStream, src_ptr: ?*const u8, len: usize) i32;
extern fn streamCommit(stream: ?*NativeSpanFeedStream) i32;
extern fn streamReserve(stream: ?*NativeSpanFeedStream, min_len: u32, out_ptr: *anyopaque) i32;
extern fn streamCommitReserved(stream: ?*NativeSpanFeedStream, len: u32) i32;
extern fn streamSetOptions(stream: ?*NativeSpanFeedStream, options_ptr: *const anyopaque) i32;
extern fn streamGetStats(stream: ?*NativeSpanFeedStream, stats_ptr: *anyopaque) i32;
extern fn streamDrainSpans(stream: ?*NativeSpanFeedStream, out_ptr: *anyopaque, max_spans: u32) u32;
extern fn streamSetCallback(stream: ?*NativeSpanFeedStream, callback: ?*const anyopaque) void;

// ── Argument validation helper ──────────────────────────────────────

fn requireArgs(env: napi.napi_env, info: napi.napi_callback_info, args: []napi.napi_value, min: usize, name: [*:0]const u8) bool {
    const argc = napi.getArgs(env, info, args) orelse return false;
    if (argc < min) {
        napi.throwError(env, name);
        return false;
    }
    return true;
}

fn readColor(env: napi.napi_env, args: []napi.napi_value, offset: usize) ?[4]f32 {
    var color: [4]f32 = undefined;
    for (0..4) |i| {
        const val = napi.getF64(env, args[offset + i]) orelse return null;
        color[i] = @floatCast(val);
    }
    return color;
}

fn readOptColor(env: napi.napi_env, args: []napi.napi_value, offset: usize) ?[4]f32 {
    const first = napi.getF64(env, args[offset]) orelse return null;
    if (first < 0) return null;
    var color: [4]f32 = undefined;
    color[0] = @floatCast(first);
    for (1..4) |i| {
        const val = napi.getF64(env, args[offset + i]) orelse return null;
        color[i] = @floatCast(val);
    }
    return color;
}

// ── JS-facing wrappers ──────────────────────────────────────────────

// -- System --

pub fn jsGetArenaAllocatedBytes(env: napi.napi_env, _: napi.napi_callback_info) callconv(.c) napi.napi_value {
    return napi.createF64(env, @floatFromInt(getArenaAllocatedBytes()));
}

pub fn jsGetBuildOptions(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    _ = napi.getArgs(env, info, &args);
    const ExternalBuildOptions = extern struct { gpa_safe_stats: bool, gpa_memory_limit_tracking: bool };
    var opts: ExternalBuildOptions = undefined;
    getBuildOptions(@ptrCast(&opts));
    const obj = napi.createObject(env);
    _ = napi.setNamedProperty(env, obj, "gpaSafeStats", napi.createBool(env, opts.gpa_safe_stats));
    _ = napi.setNamedProperty(env, obj, "gpaMemoryLimitTracking", napi.createBool(env, opts.gpa_memory_limit_tracking));
    return obj;
}

pub fn jsGetAllocatorStats(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    _ = napi.getArgs(env, info, &args);
    const ExternalAllocatorStats = extern struct { total_requested_bytes: u64, active_allocations: u64, small_allocations: u64, large_allocations: u64, requested_bytes_valid: bool };
    var stats: ExternalAllocatorStats = undefined;
    getAllocatorStats(@ptrCast(&stats));
    const obj = napi.createObject(env);
    _ = napi.setNamedProperty(env, obj, "totalRequestedBytes", napi.createF64(env, @floatFromInt(stats.total_requested_bytes)));
    _ = napi.setNamedProperty(env, obj, "activeAllocations", napi.createF64(env, @floatFromInt(stats.active_allocations)));
    _ = napi.setNamedProperty(env, obj, "smallAllocations", napi.createF64(env, @floatFromInt(stats.small_allocations)));
    _ = napi.setNamedProperty(env, obj, "largeAllocations", napi.createF64(env, @floatFromInt(stats.large_allocations)));
    _ = napi.setNamedProperty(env, obj, "requestedBytesValid", napi.createBool(env, stats.requested_bytes_valid));
    return obj;
}

// -- Callback --

pub fn jsSetLogCallback(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "setLogCallback(callback)")) return null;
    // TODO: Implement napi_create_threadsafe_function for log callback
    // For now, clear any existing callback
    _ = args[0];
    setLogCallback(null);
    return napi.getUndefined(env);
}

pub fn jsSetEventCallback(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "setEventCallback(callback)")) return null;
    // TODO: Implement napi_create_threadsafe_function for event callback
    // For now, clear any existing callback
    _ = args[0];
    setEventCallback(null);
    return napi.getUndefined(env);
}

// -- Renderer --

pub fn jsCreateRenderer(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [4]napi.napi_value = .{ null, null, null, null };
    if (!requireArgs(env, info, &args, 4, "createRenderer(width, height, testing, remote)")) return null;
    const width = napi.getU32(env, args[0]) orelse return null;
    const height = napi.getU32(env, args[1]) orelse return null;
    const testing = napi.getBool(env, args[2]) orelse return null;
    const remote = napi.getBool(env, args[3]) orelse return null;
    const ptr = createRenderer(width, height, testing, remote);
    if (ptr) |p| return napi.wrapPointer(env, p);
    return napi.getNull(env);
}

pub fn jsDestroyRenderer(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "destroyRenderer(rendererPtr)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    destroyRenderer(rendererPtr);
    return napi.getUndefined(env);
}

pub fn jsRender(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "render(rendererPtr, force)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const force = napi.getBool(env, args[1]) orelse return null;
    render(rendererPtr, force);
    return napi.getUndefined(env);
}

pub fn jsGetNextBuffer(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "getNextBuffer(rendererPtr)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    return napi.wrapPointer(env, getNextBuffer(rendererPtr));
}

pub fn jsGetCurrentBuffer(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "getCurrentBuffer(rendererPtr)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    return napi.wrapPointer(env, getCurrentBuffer(rendererPtr));
}

pub fn jsSetBackgroundColor(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [5]napi.napi_value = .{ null, null, null, null, null };
    if (!requireArgs(env, info, &args, 5, "setBackgroundColor(rendererPtr, color_r, color_g, color_b, color_a)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const color = readColor(env, &args, 1) orelse return null;
    setBackgroundColor(rendererPtr, &color);
    return napi.getUndefined(env);
}

pub fn jsSetRenderOffset(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "setRenderOffset(rendererPtr, offset)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const offset = napi.getU32(env, args[1]) orelse return null;
    setRenderOffset(rendererPtr, offset);
    return napi.getUndefined(env);
}

pub fn jsSetUseThread(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "setUseThread(rendererPtr, useThread)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const useThread = napi.getBool(env, args[1]) orelse return null;
    setUseThread(rendererPtr, useThread);
    return napi.getUndefined(env);
}

pub fn jsSetDebugOverlay(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [3]napi.napi_value = .{ null, null, null };
    if (!requireArgs(env, info, &args, 3, "setDebugOverlay(rendererPtr, enabled, corner)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const enabled = napi.getBool(env, args[1]) orelse return null;
    const corner_u = napi.getU32(env, args[2]) orelse return null;
    setDebugOverlay(rendererPtr, enabled, @intCast(corner_u));
    return napi.getUndefined(env);
}

pub fn jsClearTerminal(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "clearTerminal(rendererPtr)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    clearTerminal(rendererPtr);
    return napi.getUndefined(env);
}

pub fn jsSetCursorPosition(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [4]napi.napi_value = .{ null, null, null, null };
    if (!requireArgs(env, info, &args, 4, "setCursorPosition(rendererPtr, x, y, visible)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const x = napi.getI32(env, args[1]) orelse return null;
    const y = napi.getI32(env, args[2]) orelse return null;
    const visible = napi.getBool(env, args[3]) orelse return null;
    setCursorPosition(rendererPtr, x, y, visible);
    return napi.getUndefined(env);
}

pub fn jsSetTerminalEnvVar(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [3]napi.napi_value = .{ null, null, null };
    if (!requireArgs(env, info, &args, 3, "setTerminalEnvVar(rendererPtr, key, value)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    var key_buf: [65536]u8 = undefined;
    const key = napi.getString(env, args[1], &key_buf) orelse return null;
    var value_buf: [65536]u8 = undefined;
    const value = napi.getString(env, args[2], &value_buf) orelse return null;
    return napi.createBool(env, setTerminalEnvVar(rendererPtr, key.ptr, key.len, value.ptr, value.len));
}

pub fn jsUpdateStats(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [4]napi.napi_value = .{ null, null, null, null };
    if (!requireArgs(env, info, &args, 4, "updateStats(rendererPtr, time, fps, frameCallbackTime)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const time = napi.getF64(env, args[1]) orelse return null;
    const fps = napi.getU32(env, args[2]) orelse return null;
    const frameCallbackTime = napi.getF64(env, args[3]) orelse return null;
    updateStats(rendererPtr, time, fps, frameCallbackTime);
    return napi.getUndefined(env);
}

pub fn jsUpdateMemoryStats(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [4]napi.napi_value = .{ null, null, null, null };
    if (!requireArgs(env, info, &args, 4, "updateMemoryStats(rendererPtr, heapUsed, heapTotal, arrayBuffers)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const heapUsed = napi.getU32(env, args[1]) orelse return null;
    const heapTotal = napi.getU32(env, args[2]) orelse return null;
    const arrayBuffers = napi.getU32(env, args[3]) orelse return null;
    updateMemoryStats(rendererPtr, heapUsed, heapTotal, arrayBuffers);
    return napi.getUndefined(env);
}

pub fn jsGetLastOutputForTest(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "getLastOutputForTest(renderer)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const OutputSlice = extern struct { ptr: [*]const u8, len: usize };
    var slice: OutputSlice = undefined;
    getLastOutputForTest(ptr, @ptrCast(&slice));
    if (slice.len == 0) return napi.createString(env, "");
    return napi.createString(env, slice.ptr[0..slice.len]);
}

pub fn jsSetHyperlinksCapability(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "setHyperlinksCapability(rendererPtr, enabled)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const enabled = napi.getBool(env, args[1]) orelse return null;
    setHyperlinksCapability(rendererPtr, enabled);
    return napi.getUndefined(env);
}

pub fn jsResizeRenderer(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [3]napi.napi_value = .{ null, null, null };
    if (!requireArgs(env, info, &args, 3, "resizeRenderer(rendererPtr, width, height)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const width = napi.getU32(env, args[1]) orelse return null;
    const height = napi.getU32(env, args[2]) orelse return null;
    resizeRenderer(rendererPtr, width, height);
    return napi.getUndefined(env);
}

pub fn jsGetTerminalCapabilities(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "getTerminalCapabilities(renderer)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const ExternalCapabilities = extern struct {
        kitty_keyboard: bool, kitty_graphics: bool, rgb: bool, unicode: u8,
        sgr_pixels: bool, color_scheme_updates: bool, explicit_width: bool, scaled_text: bool,
        sixel: bool, focus_tracking: bool, sync: bool, bracketed_paste: bool,
        hyperlinks: bool, osc52: bool, explicit_cursor_positioning: bool,
        term_name_ptr: [*]const u8, term_name_len: usize,
        term_version_ptr: [*]const u8, term_version_len: usize,
        term_from_xtversion: bool,
    };
    var caps: ExternalCapabilities = undefined;
    getTerminalCapabilities(ptr, @ptrCast(&caps));
    const obj = napi.createObject(env);
    _ = napi.setNamedProperty(env, obj, "kittyKeyboard", napi.createBool(env, caps.kitty_keyboard));
    _ = napi.setNamedProperty(env, obj, "kittyGraphics", napi.createBool(env, caps.kitty_graphics));
    _ = napi.setNamedProperty(env, obj, "rgb", napi.createBool(env, caps.rgb));
    _ = napi.setNamedProperty(env, obj, "sgrPixels", napi.createBool(env, caps.sgr_pixels));
    _ = napi.setNamedProperty(env, obj, "colorSchemeUpdates", napi.createBool(env, caps.color_scheme_updates));
    _ = napi.setNamedProperty(env, obj, "explicitWidth", napi.createBool(env, caps.explicit_width));
    _ = napi.setNamedProperty(env, obj, "scaledText", napi.createBool(env, caps.scaled_text));
    _ = napi.setNamedProperty(env, obj, "sixel", napi.createBool(env, caps.sixel));
    _ = napi.setNamedProperty(env, obj, "focusTracking", napi.createBool(env, caps.focus_tracking));
    _ = napi.setNamedProperty(env, obj, "sync", napi.createBool(env, caps.sync));
    _ = napi.setNamedProperty(env, obj, "bracketedPaste", napi.createBool(env, caps.bracketed_paste));
    _ = napi.setNamedProperty(env, obj, "hyperlinks", napi.createBool(env, caps.hyperlinks));
    _ = napi.setNamedProperty(env, obj, "osc52", napi.createBool(env, caps.osc52));
    _ = napi.setNamedProperty(env, obj, "explicitCursorPositioning", napi.createBool(env, caps.explicit_cursor_positioning));
    _ = napi.setNamedProperty(env, obj, "termFromXtversion", napi.createBool(env, caps.term_from_xtversion));
    _ = napi.setNamedProperty(env, obj, "unicode", napi.createU32(env, @intCast(caps.unicode)));
    _ = napi.setNamedProperty(env, obj, "termName", napi.createString(env, caps.term_name_ptr[0..caps.term_name_len]));
    _ = napi.setNamedProperty(env, obj, "termVersion", napi.createString(env, caps.term_version_ptr[0..caps.term_version_len]));
    return obj;
}

pub fn jsProcessCapabilityResponse(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "processCapabilityResponse(rendererPtr, response)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    var response_buf: [65536]u8 = undefined;
    const response = napi.getString(env, args[1], &response_buf) orelse return null;
    processCapabilityResponse(rendererPtr, response.ptr, response.len);
    return napi.getUndefined(env);
}

pub fn jsSetCursorColor(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [5]napi.napi_value = .{ null, null, null, null, null };
    if (!requireArgs(env, info, &args, 5, "setCursorColor(rendererPtr, color_r, color_g, color_b, color_a)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const color = readColor(env, &args, 1) orelse return null;
    setCursorColor(rendererPtr, &color);
    return napi.getUndefined(env);
}

pub fn jsSetCursorStyleOptions(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [8]napi.napi_value = .{ null, null, null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 8, "setCursorStyleOptions(renderer, style, blinking, cursor, r, g, b, a)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const style_u = napi.getU32(env, args[1]) orelse return null;
    const blink_u = napi.getU32(env, args[2]) orelse return null;
    const cursor_u = napi.getU32(env, args[3]) orelse return null;
    const color_c = readOptColor(env, &args, 4);
    const CursorStyleOptions = extern struct { style: u8, blinking: u8, color: ?[*]const f32, cursor: u8 };
    var opts = CursorStyleOptions{
        .style = @intCast(style_u),
        .blinking = @intCast(blink_u),
        .color = if (color_c) |*p| p else null,
        .cursor = @intCast(cursor_u),
    };
    setCursorStyleOptions(ptr, @ptrCast(&opts));
    return napi.getUndefined(env);
}

pub fn jsGetCursorState(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "getCursorState(renderer)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const ExternalCursorState = extern struct { x: u32, y: u32, visible: bool, style: u8, blinking: bool, r: f32, g: f32, b: f32, a: f32 };
    var state: ExternalCursorState = undefined;
    getCursorState(ptr, @ptrCast(&state));
    const obj = napi.createObject(env);
    _ = napi.setNamedProperty(env, obj, "x", napi.createU32(env, state.x));
    _ = napi.setNamedProperty(env, obj, "y", napi.createU32(env, state.y));
    _ = napi.setNamedProperty(env, obj, "visible", napi.createBool(env, state.visible));
    _ = napi.setNamedProperty(env, obj, "style", napi.createU32(env, @intCast(state.style)));
    _ = napi.setNamedProperty(env, obj, "blinking", napi.createBool(env, state.blinking));
    _ = napi.setNamedProperty(env, obj, "r", napi.createF64(env, @floatCast(state.r)));
    _ = napi.setNamedProperty(env, obj, "g", napi.createF64(env, @floatCast(state.g)));
    _ = napi.setNamedProperty(env, obj, "b", napi.createF64(env, @floatCast(state.b)));
    _ = napi.setNamedProperty(env, obj, "a", napi.createF64(env, @floatCast(state.a)));
    return obj;
}

pub fn jsSetTerminalTitle(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "setTerminalTitle(rendererPtr, title)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    var title_buf: [65536]u8 = undefined;
    const title = napi.getString(env, args[1], &title_buf) orelse return null;
    setTerminalTitle(rendererPtr, title.ptr, title.len);
    return napi.getUndefined(env);
}

pub fn jsCopyToClipboardOSC52(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [3]napi.napi_value = .{ null, null, null };
    if (!requireArgs(env, info, &args, 3, "copyToClipboardOSC52(rendererPtr, target, payload)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const target_u = napi.getU32(env, args[1]) orelse return null;
    var payload_buf: [65536]u8 = undefined;
    const payload = napi.getString(env, args[2], &payload_buf) orelse return null;
    return napi.createBool(env, copyToClipboardOSC52(rendererPtr, @intCast(target_u), payload.ptr, payload.len));
}

pub fn jsClearClipboardOSC52(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "clearClipboardOSC52(rendererPtr, target)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const target_u = napi.getU32(env, args[1]) orelse return null;
    return napi.createBool(env, clearClipboardOSC52(rendererPtr, @intCast(target_u)));
}

pub fn jsDumpBuffers(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "dumpBuffers(rendererPtr, timestamp)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const timestamp_f = napi.getF64(env, args[1]) orelse return null;
    const timestamp: i64 = @intFromFloat(timestamp_f);
    dumpBuffers(rendererPtr, timestamp);
    return napi.getUndefined(env);
}

pub fn jsDumpStdoutBuffer(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "dumpStdoutBuffer(rendererPtr, timestamp)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const timestamp_f = napi.getF64(env, args[1]) orelse return null;
    const timestamp: i64 = @intFromFloat(timestamp_f);
    dumpStdoutBuffer(rendererPtr, timestamp);
    return napi.getUndefined(env);
}

pub fn jsDumpHitGrid(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "dumpHitGrid(rendererPtr)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    dumpHitGrid(rendererPtr);
    return napi.getUndefined(env);
}

pub fn jsRestoreTerminalModes(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "restoreTerminalModes(rendererPtr)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    restoreTerminalModes(rendererPtr);
    return napi.getUndefined(env);
}

pub fn jsEnableMouse(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "enableMouse(rendererPtr, enableMovement)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const enableMovement = napi.getBool(env, args[1]) orelse return null;
    enableMouse(rendererPtr, enableMovement);
    return napi.getUndefined(env);
}

pub fn jsDisableMouse(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "disableMouse(rendererPtr)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    disableMouse(rendererPtr);
    return napi.getUndefined(env);
}

pub fn jsQueryPixelResolution(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "queryPixelResolution(rendererPtr)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    queryPixelResolution(rendererPtr);
    return napi.getUndefined(env);
}

pub fn jsEnableKittyKeyboard(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "enableKittyKeyboard(rendererPtr, flags)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const flags_u = napi.getU32(env, args[1]) orelse return null;
    enableKittyKeyboard(rendererPtr, @intCast(flags_u));
    return napi.getUndefined(env);
}

pub fn jsDisableKittyKeyboard(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "disableKittyKeyboard(rendererPtr)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    disableKittyKeyboard(rendererPtr);
    return napi.getUndefined(env);
}

pub fn jsSetKittyKeyboardFlags(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "setKittyKeyboardFlags(rendererPtr, flags)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const flags_u = napi.getU32(env, args[1]) orelse return null;
    setKittyKeyboardFlags(rendererPtr, @intCast(flags_u));
    return napi.getUndefined(env);
}

pub fn jsGetKittyKeyboardFlags(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "getKittyKeyboardFlags(rendererPtr)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    return napi.createU32(env, @intCast(getKittyKeyboardFlags(rendererPtr)));
}

pub fn jsSetupTerminal(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "setupTerminal(rendererPtr, useAlternateScreen)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const useAlternateScreen = napi.getBool(env, args[1]) orelse return null;
    setupTerminal(rendererPtr, useAlternateScreen);
    return napi.getUndefined(env);
}

pub fn jsSuspendRenderer(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "suspendRenderer(rendererPtr)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    suspendRenderer(rendererPtr);
    return napi.getUndefined(env);
}

pub fn jsResumeRenderer(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "resumeRenderer(rendererPtr)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    resumeRenderer(rendererPtr);
    return napi.getUndefined(env);
}

pub fn jsWriteOut(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "writeOut(rendererPtr, data)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    var data_buf: [65536]u8 = undefined;
    const data = napi.getString(env, args[1], &data_buf) orelse return null;
    writeOut(rendererPtr, data.ptr, data.len);
    return napi.getUndefined(env);
}

// -- Buffer --

pub fn jsCreateOptimizedBuffer(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [5]napi.napi_value = .{ null, null, null, null, null };
    if (!requireArgs(env, info, &args, 5, "createOptimizedBuffer(width, height, respectAlpha, widthMethod, id)")) return null;
    const width = napi.getU32(env, args[0]) orelse return null;
    const height = napi.getU32(env, args[1]) orelse return null;
    const respectAlpha = napi.getBool(env, args[2]) orelse return null;
    const widthMethod_u = napi.getU32(env, args[3]) orelse return null;
    var id_buf: [65536]u8 = undefined;
    const id = napi.getString(env, args[4], &id_buf) orelse return null;
    const ptr = createOptimizedBuffer(width, height, respectAlpha, @intCast(widthMethod_u), id.ptr, id.len);
    if (ptr) |p| return napi.wrapPointer(env, p);
    return napi.getNull(env);
}

pub fn jsDestroyOptimizedBuffer(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "destroyOptimizedBuffer(bufferPtr)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    destroyOptimizedBuffer(bufferPtr);
    return napi.getUndefined(env);
}

pub fn jsDestroyFrameBuffer(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "destroyFrameBuffer(frameBufferPtr)")) return null;
    const frameBufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    destroyFrameBuffer(frameBufferPtr);
    return napi.getUndefined(env);
}

pub fn jsDrawFrameBuffer(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [8]napi.napi_value = .{ null, null, null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 8, "drawFrameBuffer(targetPtr, destX, destY, frameBuffer, sourceX, sourceY, sourceWidth, sourceHeight)")) return null;
    const targetPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    const destX = napi.getI32(env, args[1]) orelse return null;
    const destY = napi.getI32(env, args[2]) orelse return null;
    const frameBuffer = napi.unwrapPointer(env, args[3], OptimizedBuffer) orelse return null;
    const sourceX = napi.getU32(env, args[4]) orelse return null;
    const sourceY = napi.getU32(env, args[5]) orelse return null;
    const sourceWidth = napi.getU32(env, args[6]) orelse return null;
    const sourceHeight = napi.getU32(env, args[7]) orelse return null;
    drawFrameBuffer(targetPtr, destX, destY, frameBuffer, sourceX, sourceY, sourceWidth, sourceHeight);
    return napi.getUndefined(env);
}

pub fn jsGetBufferWidth(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "getBufferWidth(bufferPtr)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    return napi.createU32(env, getBufferWidth(bufferPtr));
}

pub fn jsGetBufferHeight(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "getBufferHeight(bufferPtr)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    return napi.createU32(env, getBufferHeight(bufferPtr));
}

pub fn jsBufferClear(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [5]napi.napi_value = .{ null, null, null, null, null };
    if (!requireArgs(env, info, &args, 5, "bufferClear(bufferPtr, bg_r, bg_g, bg_b, bg_a)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    const bg = readColor(env, &args, 1) orelse return null;
    bufferClear(bufferPtr, &bg);
    return napi.getUndefined(env);
}

pub fn jsBufferResize(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [3]napi.napi_value = .{ null, null, null };
    if (!requireArgs(env, info, &args, 3, "bufferResize(bufferPtr, width, height)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    const width = napi.getU32(env, args[1]) orelse return null;
    const height = napi.getU32(env, args[2]) orelse return null;
    bufferResize(bufferPtr, width, height);
    return napi.getUndefined(env);
}

pub fn jsBufferFillRect(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [9]napi.napi_value = .{ null, null, null, null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 9, "bufferFillRect(bufferPtr, x, y, width, height, bg_r, bg_g, bg_b, bg_a)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    const x = napi.getU32(env, args[1]) orelse return null;
    const y = napi.getU32(env, args[2]) orelse return null;
    const width = napi.getU32(env, args[3]) orelse return null;
    const height = napi.getU32(env, args[4]) orelse return null;
    const bg = readColor(env, &args, 5) orelse return null;
    bufferFillRect(bufferPtr, x, y, width, height, &bg);
    return napi.getUndefined(env);
}

pub fn jsBufferGetCharPtr(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "bufferGetCharPtr(bufferPtr)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    return napi.wrapPointer(env, bufferGetCharPtr(bufferPtr));
}

pub fn jsBufferGetFgPtr(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "bufferGetFgPtr(bufferPtr)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    return napi.wrapPointer(env, bufferGetFgPtr(bufferPtr));
}

pub fn jsBufferGetBgPtr(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "bufferGetBgPtr(bufferPtr)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    return napi.wrapPointer(env, bufferGetBgPtr(bufferPtr));
}

pub fn jsBufferGetAttributesPtr(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "bufferGetAttributesPtr(bufferPtr)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    return napi.wrapPointer(env, bufferGetAttributesPtr(bufferPtr));
}

pub fn jsBufferGetRespectAlpha(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "bufferGetRespectAlpha(bufferPtr)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    return napi.createBool(env, bufferGetRespectAlpha(bufferPtr));
}

pub fn jsBufferSetRespectAlpha(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "bufferSetRespectAlpha(bufferPtr, respectAlpha)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    const respectAlpha = napi.getBool(env, args[1]) orelse return null;
    bufferSetRespectAlpha(bufferPtr, respectAlpha);
    return napi.getUndefined(env);
}

pub fn jsBufferGetId(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "bufferGetId(buffer)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    var buf: [256]u8 = undefined;
    const len = bufferGetId(ptr, &buf, buf.len);
    return napi.createString(env, buf[0..len]);
}

pub fn jsBufferGetRealCharSize(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "bufferGetRealCharSize(bufferPtr)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    return napi.createU32(env, bufferGetRealCharSize(bufferPtr));
}

pub fn jsBufferWriteResolvedChars(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "bufferWriteResolvedChars(buffer, addLineBreaks)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    const addLB = napi.getBool(env, args[1]) orelse return null;
    var buf: [65536]u8 = undefined;
    const len = bufferWriteResolvedChars(ptr, &buf, buf.len, addLB);
    return napi.createString(env, buf[0..len]);
}

pub fn jsBufferDrawText(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [13]napi.napi_value = .{ null, null, null, null, null, null, null, null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 13, "bufferDrawText(bufferPtr, text, x, y, fg_r, fg_g, fg_b, fg_a, bg_r, bg_g, bg_b, bg_a, attributes)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    var text_buf: [65536]u8 = undefined;
    const text = napi.getString(env, args[1], &text_buf) orelse return null;
    const x = napi.getU32(env, args[2]) orelse return null;
    const y = napi.getU32(env, args[3]) orelse return null;
    const fg = readColor(env, &args, 4) orelse return null;
    const bg_c = readOptColor(env, &args, 8);
    const attributes = napi.getU32(env, args[12]) orelse return null;
    bufferDrawText(bufferPtr, text.ptr, text.len, x, y, &fg, if (bg_c) |*p| p else null, attributes);
    return napi.getUndefined(env);
}

pub fn jsBufferSetCellWithAlphaBlending(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [13]napi.napi_value = .{ null, null, null, null, null, null, null, null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 13, "bufferSetCellWithAlphaBlending(bufferPtr, x, y, char, fg_r, fg_g, fg_b, fg_a, bg_r, bg_g, bg_b, bg_a, attributes)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    const x = napi.getU32(env, args[1]) orelse return null;
    const y = napi.getU32(env, args[2]) orelse return null;
    const char = napi.getU32(env, args[3]) orelse return null;
    const fg = readColor(env, &args, 4) orelse return null;
    const bg = readColor(env, &args, 8) orelse return null;
    const attributes = napi.getU32(env, args[12]) orelse return null;
    bufferSetCellWithAlphaBlending(bufferPtr, x, y, char, &fg, &bg, attributes);
    return napi.getUndefined(env);
}

pub fn jsBufferSetCell(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [13]napi.napi_value = .{ null, null, null, null, null, null, null, null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 13, "bufferSetCell(bufferPtr, x, y, char, fg_r, fg_g, fg_b, fg_a, bg_r, bg_g, bg_b, bg_a, attributes)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    const x = napi.getU32(env, args[1]) orelse return null;
    const y = napi.getU32(env, args[2]) orelse return null;
    const char = napi.getU32(env, args[3]) orelse return null;
    const fg = readColor(env, &args, 4) orelse return null;
    const bg = readColor(env, &args, 8) orelse return null;
    const attributes = napi.getU32(env, args[12]) orelse return null;
    bufferSetCell(bufferPtr, x, y, char, &fg, &bg, attributes);
    return napi.getUndefined(env);
}

pub fn jsBufferColorMatrix(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [4]napi.napi_value = .{ null, null, null, null };
    if (!requireArgs(env, info, &args, 4, "bufferColorMatrix(buffer, matrixExternal, cellMaskExternal, strength, target)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    // matrixPtr, cellMaskPtr passed as externals; strength and target as numbers
    // This function requires typed array access not available via simple napi helpers.
    // For now, this is a no-op stub that returns undefined.
    _ = ptr;
    return napi.getUndefined(env);
}

pub fn jsBufferColorMatrixUniform(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [4]napi.napi_value = .{ null, null, null, null };
    if (!requireArgs(env, info, &args, 4, "bufferColorMatrixUniform(buffer, matrixExternal, strength, target)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    // matrixPtr passed as external; requires typed array access.
    // For now, this is a no-op stub that returns undefined.
    _ = ptr;
    return napi.getUndefined(env);
}

pub fn jsBufferDrawPackedBuffer(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [6]napi.napi_value = .{ null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 6, "bufferDrawPackedBuffer(bufferPtr, data, posX, posY, terminalWidthCells, terminalHeightCells)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    var data_buf: [65536]u8 = undefined;
    const data = napi.getString(env, args[1], &data_buf) orelse return null;
    const posX = napi.getU32(env, args[2]) orelse return null;
    const posY = napi.getU32(env, args[3]) orelse return null;
    const terminalWidthCells = napi.getU32(env, args[4]) orelse return null;
    const terminalHeightCells = napi.getU32(env, args[5]) orelse return null;
    bufferDrawPackedBuffer(bufferPtr, data.ptr, data.len, posX, posY, terminalWidthCells, terminalHeightCells);
    return napi.getUndefined(env);
}

pub fn jsBufferDrawGrayscaleBuffer(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [12]napi.napi_value = .{ null, null, null, null, null, null, null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 12, "bufferDrawGrayscaleBuffer(buf, posX, posY, intensitiesExt, srcW, srcH, fgR, fgG, fgB, fgA, bgR, bgG, bgB, bgA)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    const posX = napi.getI32(env, args[1]) orelse return null;
    const posY = napi.getI32(env, args[2]) orelse return null;
    var intensities_raw: ?*anyopaque = null;
    if (!napi.check(env, c.napi_get_value_external(env, args[3], &intensities_raw))) return null;
    const srcWidth = napi.getU32(env, args[4]) orelse return null;
    const srcHeight = napi.getU32(env, args[5]) orelse return null;
    const fg_c = readOptColor(env, &args, 6);
    const bg_c = readOptColor(env, &args, 10);
    if (intensities_raw) |iptr| {
        bufferDrawGrayscaleBuffer(ptr, posX, posY, @ptrCast(@alignCast(iptr)), srcWidth, srcHeight, if (fg_c) |*p| p else null, if (bg_c) |*p| p else null);
    }
    return napi.getUndefined(env);
}

pub fn jsBufferDrawGrayscaleBufferSupersampled(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [12]napi.napi_value = .{ null, null, null, null, null, null, null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 12, "bufferDrawGrayscaleBufferSupersampled(buf, posX, posY, intensitiesExt, srcW, srcH, fg..., bg...)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    const posX = napi.getI32(env, args[1]) orelse return null;
    const posY = napi.getI32(env, args[2]) orelse return null;
    var intensities_raw: ?*anyopaque = null;
    if (!napi.check(env, c.napi_get_value_external(env, args[3], &intensities_raw))) return null;
    const srcWidth = napi.getU32(env, args[4]) orelse return null;
    const srcHeight = napi.getU32(env, args[5]) orelse return null;
    const fg_c = readOptColor(env, &args, 6);
    const bg_c = readOptColor(env, &args, 10);
    if (intensities_raw) |iptr| {
        bufferDrawGrayscaleBufferSupersampled(ptr, posX, posY, @ptrCast(@alignCast(iptr)), srcWidth, srcHeight, if (fg_c) |*p| p else null, if (bg_c) |*p| p else null);
    }
    return napi.getUndefined(env);
}

pub fn jsBufferPushScissorRect(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [5]napi.napi_value = .{ null, null, null, null, null };
    if (!requireArgs(env, info, &args, 5, "bufferPushScissorRect(bufferPtr, x, y, width, height)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    const x = napi.getI32(env, args[1]) orelse return null;
    const y = napi.getI32(env, args[2]) orelse return null;
    const width = napi.getU32(env, args[3]) orelse return null;
    const height = napi.getU32(env, args[4]) orelse return null;
    bufferPushScissorRect(bufferPtr, x, y, width, height);
    return napi.getUndefined(env);
}

pub fn jsBufferPopScissorRect(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "bufferPopScissorRect(bufferPtr)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    bufferPopScissorRect(bufferPtr);
    return napi.getUndefined(env);
}

pub fn jsBufferClearScissorRects(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "bufferClearScissorRects(bufferPtr)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    bufferClearScissorRects(bufferPtr);
    return napi.getUndefined(env);
}

pub fn jsBufferPushOpacity(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "bufferPushOpacity(bufferPtr, opacity)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    const opacity_f = napi.getF64(env, args[1]) orelse return null;
    bufferPushOpacity(bufferPtr, @floatCast(opacity_f));
    return napi.getUndefined(env);
}

pub fn jsBufferPopOpacity(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "bufferPopOpacity(bufferPtr)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    bufferPopOpacity(bufferPtr);
    return napi.getUndefined(env);
}

pub fn jsBufferGetCurrentOpacity(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "bufferGetCurrentOpacity(bufferPtr)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    return napi.createF64(env, @floatCast(bufferGetCurrentOpacity(bufferPtr)));
}

pub fn jsBufferClearOpacity(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "bufferClearOpacity(bufferPtr)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    bufferClearOpacity(bufferPtr);
    return napi.getUndefined(env);
}

pub fn jsBufferDrawSuperSampleBuffer(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [6]napi.napi_value = .{ null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 6, "bufferDrawSuperSampleBuffer(bufferPtr, x, y, pixelData, format, alignedBytesPerRow)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    const x = napi.getU32(env, args[1]) orelse return null;
    const y = napi.getU32(env, args[2]) orelse return null;
    var pixelData_buf: [65536]u8 = undefined;
    const pixelData = napi.getString(env, args[3], &pixelData_buf) orelse return null;
    const format_u = napi.getU32(env, args[4]) orelse return null;
    const alignedBytesPerRow = napi.getU32(env, args[5]) orelse return null;
    bufferDrawSuperSampleBuffer(bufferPtr, x, y, pixelData.ptr, pixelData.len, @intCast(format_u), alignedBytesPerRow);
    return napi.getUndefined(env);
}

pub fn jsBufferDrawGrid(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [7]napi.napi_value = .{ null, null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 7, "bufferDrawGrid(buf, borderCharsExt, borderFg, borderBg, colOffsetsExt, rowOffsetsExt, optionsExt)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    // Complex function requiring typed array/external access for multiple pointer args.
    // Stub: returns undefined. Implement when typed array helpers are added.
    _ = ptr;
    return napi.getUndefined(env);
}

pub fn jsBufferDrawBox(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [15]napi.napi_value = .{ null, null, null, null, null, null, null, null, null, null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 15, "bufferDrawBox(buf, x, y, w, h, borderCharsExt, packedOpts, borderR, borderG, borderB, borderA, bgR, bgG, bgB, bgA)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    const x = napi.getI32(env, args[1]) orelse return null;
    const y = napi.getI32(env, args[2]) orelse return null;
    const w = napi.getU32(env, args[3]) orelse return null;
    const h = napi.getU32(env, args[4]) orelse return null;
    var chars_raw: ?*anyopaque = null;
    if (!napi.check(env, c.napi_get_value_external(env, args[5], &chars_raw))) return null;
    const packed_flags = napi.getU32(env, args[6]) orelse return null;
    const border_c = readColor(env, &args, 7) orelse return null;
    const bg_c = readColor(env, &args, 11) orelse return null;
    if (chars_raw) |cp| {
        bufferDrawBox(ptr, x, y, w, h, @ptrCast(@alignCast(cp)), packed_flags, &border_c, &bg_c, null, 0);
    }
    return napi.getUndefined(env);
}

pub fn jsBufferDrawEditorView(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [4]napi.napi_value = .{ null, null, null, null };
    if (!requireArgs(env, info, &args, 4, "bufferDrawEditorView(bufferPtr, viewPtr, x, y)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    const viewPtr = napi.unwrapPointer(env, args[1], EditorView) orelse return null;
    const x = napi.getI32(env, args[2]) orelse return null;
    const y = napi.getI32(env, args[3]) orelse return null;
    bufferDrawEditorView(bufferPtr, viewPtr, x, y);
    return napi.getUndefined(env);
}

pub fn jsBufferDrawTextBufferView(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [4]napi.napi_value = .{ null, null, null, null };
    if (!requireArgs(env, info, &args, 4, "bufferDrawTextBufferView(bufferPtr, viewPtr, x, y)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    const viewPtr = napi.unwrapPointer(env, args[1], UnifiedTextBufferView) orelse return null;
    const x = napi.getI32(env, args[2]) orelse return null;
    const y = napi.getI32(env, args[3]) orelse return null;
    bufferDrawTextBufferView(bufferPtr, viewPtr, x, y);
    return napi.getUndefined(env);
}

pub fn jsBufferDrawChar(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [13]napi.napi_value = .{ null, null, null, null, null, null, null, null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 13, "bufferDrawChar(bufferPtr, char, x, y, fg_r, fg_g, fg_b, fg_a, bg_r, bg_g, bg_b, bg_a, attributes)")) return null;
    const bufferPtr = napi.unwrapPointer(env, args[0], OptimizedBuffer) orelse return null;
    const char = napi.getU32(env, args[1]) orelse return null;
    const x = napi.getU32(env, args[2]) orelse return null;
    const y = napi.getU32(env, args[3]) orelse return null;
    const fg = readColor(env, &args, 4) orelse return null;
    const bg = readColor(env, &args, 8) orelse return null;
    const attributes = napi.getU32(env, args[12]) orelse return null;
    bufferDrawChar(bufferPtr, char, x, y, &fg, &bg, attributes);
    return napi.getUndefined(env);
}

// -- Link --

pub fn jsClearGlobalLinkPool(env: napi.napi_env, _: napi.napi_callback_info) callconv(.c) napi.napi_value {
    clearGlobalLinkPool();
    return napi.getUndefined(env);
}

pub fn jsLinkAlloc(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "linkAlloc(url)")) return null;
    var url_buf: [65536]u8 = undefined;
    const url = napi.getString(env, args[0], &url_buf) orelse return null;
    return napi.createU32(env, linkAlloc(url.ptr, url.len));
}

pub fn jsLinkGetUrl(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "linkGetUrl(id)")) return null;
    const id = napi.getU32(env, args[0]) orelse return null;
    var buf: [4096]u8 = undefined;
    const len = linkGetUrl(id, &buf, buf.len);
    return napi.createString(env, buf[0..len]);
}

pub fn jsAttributesWithLink(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "attributesWithLink(baseAttributes, linkId)")) return null;
    const baseAttributes = napi.getU32(env, args[0]) orelse return null;
    const linkId = napi.getU32(env, args[1]) orelse return null;
    return napi.createU32(env, attributesWithLink(baseAttributes, linkId));
}

pub fn jsAttributesGetLinkId(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "attributesGetLinkId(attributes)")) return null;
    const attributes = napi.getU32(env, args[0]) orelse return null;
    return napi.createU32(env, attributesGetLinkId(attributes));
}

// -- HitGrid --

pub fn jsAddToHitGrid(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [6]napi.napi_value = .{ null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 6, "addToHitGrid(rendererPtr, x, y, width, height, id)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const x = napi.getI32(env, args[1]) orelse return null;
    const y = napi.getI32(env, args[2]) orelse return null;
    const width = napi.getU32(env, args[3]) orelse return null;
    const height = napi.getU32(env, args[4]) orelse return null;
    const id = napi.getU32(env, args[5]) orelse return null;
    addToHitGrid(rendererPtr, x, y, width, height, id);
    return napi.getUndefined(env);
}

pub fn jsClearCurrentHitGrid(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "clearCurrentHitGrid(rendererPtr)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    clearCurrentHitGrid(rendererPtr);
    return napi.getUndefined(env);
}

pub fn jsHitGridPushScissorRect(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [5]napi.napi_value = .{ null, null, null, null, null };
    if (!requireArgs(env, info, &args, 5, "hitGridPushScissorRect(rendererPtr, x, y, width, height)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const x = napi.getI32(env, args[1]) orelse return null;
    const y = napi.getI32(env, args[2]) orelse return null;
    const width = napi.getU32(env, args[3]) orelse return null;
    const height = napi.getU32(env, args[4]) orelse return null;
    hitGridPushScissorRect(rendererPtr, x, y, width, height);
    return napi.getUndefined(env);
}

pub fn jsHitGridPopScissorRect(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "hitGridPopScissorRect(rendererPtr)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    hitGridPopScissorRect(rendererPtr);
    return napi.getUndefined(env);
}

pub fn jsHitGridClearScissorRects(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "hitGridClearScissorRects(rendererPtr)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    hitGridClearScissorRects(rendererPtr);
    return napi.getUndefined(env);
}

pub fn jsAddToCurrentHitGridClipped(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [6]napi.napi_value = .{ null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 6, "addToCurrentHitGridClipped(rendererPtr, x, y, width, height, id)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const x = napi.getI32(env, args[1]) orelse return null;
    const y = napi.getI32(env, args[2]) orelse return null;
    const width = napi.getU32(env, args[3]) orelse return null;
    const height = napi.getU32(env, args[4]) orelse return null;
    const id = napi.getU32(env, args[5]) orelse return null;
    addToCurrentHitGridClipped(rendererPtr, x, y, width, height, id);
    return napi.getUndefined(env);
}

pub fn jsCheckHit(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [3]napi.napi_value = .{ null, null, null };
    if (!requireArgs(env, info, &args, 3, "checkHit(rendererPtr, x, y)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    const x = napi.getU32(env, args[1]) orelse return null;
    const y = napi.getU32(env, args[2]) orelse return null;
    return napi.createU32(env, checkHit(rendererPtr, x, y));
}

pub fn jsGetHitGridDirty(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "getHitGridDirty(rendererPtr)")) return null;
    const rendererPtr = napi.unwrapPointer(env, args[0], CliRenderer) orelse return null;
    return napi.createBool(env, getHitGridDirty(rendererPtr));
}

// -- TextBuffer --

pub fn jsCreateTextBuffer(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "createTextBuffer(widthMethod)")) return null;
    const widthMethod_u = napi.getU32(env, args[0]) orelse return null;
    const ptr = createTextBuffer(@intCast(widthMethod_u));
    if (ptr) |p| return napi.wrapPointer(env, p);
    return napi.getNull(env);
}

pub fn jsDestroyTextBuffer(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "destroyTextBuffer(tb)")) return null;
    const tb = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    destroyTextBuffer(tb);
    return napi.getUndefined(env);
}

pub fn jsTextBufferGetLength(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "textBufferGetLength(tb)")) return null;
    const tb = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    return napi.createU32(env, textBufferGetLength(tb));
}

pub fn jsTextBufferGetByteSize(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "textBufferGetByteSize(tb)")) return null;
    const tb = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    return napi.createU32(env, textBufferGetByteSize(tb));
}

pub fn jsTextBufferReset(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "textBufferReset(tb)")) return null;
    const tb = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    textBufferReset(tb);
    return napi.getUndefined(env);
}

pub fn jsTextBufferClear(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "textBufferClear(tb)")) return null;
    const tb = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    textBufferClear(tb);
    return napi.getUndefined(env);
}

pub fn jsTextBufferSetDefaultFg(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [5]napi.napi_value = .{ null, null, null, null, null };
    if (!requireArgs(env, info, &args, 5, "textBufferSetDefaultFg(tb, fg_r, fg_g, fg_b, fg_a)")) return null;
    const tb = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    const fg_c = readOptColor(env, &args, 1);
    textBufferSetDefaultFg(tb, if (fg_c) |*p| p else null);
    return napi.getUndefined(env);
}

pub fn jsTextBufferSetDefaultBg(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [5]napi.napi_value = .{ null, null, null, null, null };
    if (!requireArgs(env, info, &args, 5, "textBufferSetDefaultBg(tb, bg_r, bg_g, bg_b, bg_a)")) return null;
    const tb = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    const bg_c = readOptColor(env, &args, 1);
    textBufferSetDefaultBg(tb, if (bg_c) |*p| p else null);
    return napi.getUndefined(env);
}

pub fn jsTextBufferSetDefaultAttributes(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "textBufferSetDefaultAttributes(tb, attr)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    const attr_u = napi.getU32(env, args[1]);
    if (attr_u) |v| {
        var attr_arr = [_]u32{v};
        textBufferSetDefaultAttributes(ptr, &attr_arr);
    } else {
        textBufferSetDefaultAttributes(ptr, null);
    }
    return napi.getUndefined(env);
}

pub fn jsTextBufferResetDefaults(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "textBufferResetDefaults(tb)")) return null;
    const tb = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    textBufferResetDefaults(tb);
    return napi.getUndefined(env);
}

pub fn jsTextBufferGetTabWidth(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "textBufferGetTabWidth(tb)")) return null;
    const tb = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    return napi.createU32(env, @intCast(textBufferGetTabWidth(tb)));
}

pub fn jsTextBufferSetTabWidth(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "textBufferSetTabWidth(tb, width)")) return null;
    const tb = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    const width_u = napi.getU32(env, args[1]) orelse return null;
    textBufferSetTabWidth(tb, @intCast(width_u));
    return napi.getUndefined(env);
}

pub fn jsTextBufferRegisterMemBuffer(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [3]napi.napi_value = .{ null, null, null };
    if (!requireArgs(env, info, &args, 3, "textBufferRegisterMemBuffer(tb, data, owned)")) return null;
    const tb = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    var data_buf: [65536]u8 = undefined;
    const data = napi.getString(env, args[1], &data_buf) orelse return null;
    const owned = napi.getBool(env, args[2]) orelse return null;
    return napi.createU32(env, @intCast(textBufferRegisterMemBuffer(tb, data.ptr, data.len, owned)));
}

pub fn jsTextBufferReplaceMemBuffer(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [4]napi.napi_value = .{ null, null, null, null };
    if (!requireArgs(env, info, &args, 4, "textBufferReplaceMemBuffer(tb, id, data, owned)")) return null;
    const tb = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    const id_u = napi.getU32(env, args[1]) orelse return null;
    var data_buf: [65536]u8 = undefined;
    const data = napi.getString(env, args[2], &data_buf) orelse return null;
    const owned = napi.getBool(env, args[3]) orelse return null;
    return napi.createBool(env, textBufferReplaceMemBuffer(tb, @intCast(id_u), data.ptr, data.len, owned));
}

pub fn jsTextBufferClearMemRegistry(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "textBufferClearMemRegistry(tb)")) return null;
    const tb = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    textBufferClearMemRegistry(tb);
    return napi.getUndefined(env);
}

pub fn jsTextBufferSetTextFromMem(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "textBufferSetTextFromMem(tb, id)")) return null;
    const tb = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    const id_u = napi.getU32(env, args[1]) orelse return null;
    textBufferSetTextFromMem(tb, @intCast(id_u));
    return napi.getUndefined(env);
}

pub fn jsTextBufferAppend(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "textBufferAppend(tb, data)")) return null;
    const tb = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    var data_buf: [65536]u8 = undefined;
    const data = napi.getString(env, args[1], &data_buf) orelse return null;
    textBufferAppend(tb, data.ptr, data.len);
    return napi.getUndefined(env);
}

pub fn jsTextBufferAppendFromMemId(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "textBufferAppendFromMemId(tb, id)")) return null;
    const tb = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    const id_u = napi.getU32(env, args[1]) orelse return null;
    textBufferAppendFromMemId(tb, @intCast(id_u));
    return napi.getUndefined(env);
}

pub fn jsTextBufferLoadFile(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "textBufferLoadFile(tb, path)")) return null;
    const tb = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    var path_buf: [65536]u8 = undefined;
    const path = napi.getString(env, args[1], &path_buf) orelse return null;
    return napi.createBool(env, textBufferLoadFile(tb, path.ptr, path.len));
}

pub fn jsTextBufferSetStyledText(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [3]napi.napi_value = .{ null, null, null };
    if (!requireArgs(env, info, &args, 3, "textBufferSetStyledText(tb, chunksPtr, chunkCount)")) return null;
    const tb = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    var chunksPtr_raw: ?*anyopaque = null;
    if (!napi.check(env, c.napi_get_value_external(env, args[1], &chunksPtr_raw))) return null;
    const chunkCount_f = napi.getF64(env, args[2]) orelse return null;
    const chunkCount: usize = @intFromFloat(chunkCount_f);
    textBufferSetStyledText(tb, @ptrCast(@alignCast(chunksPtr_raw)), chunkCount);
    return napi.getUndefined(env);
}

pub fn jsTextBufferGetLineCount(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "textBufferGetLineCount(tb)")) return null;
    const tb = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    return napi.createU32(env, textBufferGetLineCount(tb));
}

pub fn jsTextBufferGetPlainText(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "textBufferGetPlainText(tb)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    var buf: [65536]u8 = undefined;
    const len = textBufferGetPlainText(ptr, &buf, buf.len);
    return napi.createString(env, buf[0..len]);
}

pub fn jsTextBufferAddHighlight(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [7]napi.napi_value = .{ null, null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 7, "textBufferAddHighlight(tb, lineIdx, start, end, styleId, priority, hlRef)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    const line_idx = napi.getU32(env, args[1]) orelse return null;
    const start = napi.getU32(env, args[2]) orelse return null;
    const end_val = napi.getU32(env, args[3]) orelse return null;
    const style_id = napi.getU32(env, args[4]) orelse return null;
    const priority_u = napi.getU32(env, args[5]) orelse return null;
    const hl_ref_u = napi.getU32(env, args[6]) orelse return null;
    const ExternalHighlight = extern struct { start: u32, end: u32, style_id: u32, priority: u8, hl_ref: u16 };
    var hl = ExternalHighlight{ .start = start, .end = end_val, .style_id = style_id, .priority = @intCast(priority_u), .hl_ref = @intCast(hl_ref_u) };
    textBufferAddHighlight(ptr, line_idx, @ptrCast(&hl));
    return napi.getUndefined(env);
}

pub fn jsTextBufferAddHighlightByCharRange(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [6]napi.napi_value = .{ null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 6, "textBufferAddHighlightByCharRange(tb, start, end, styleId, priority, hlRef)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    const start = napi.getU32(env, args[1]) orelse return null;
    const end_val = napi.getU32(env, args[2]) orelse return null;
    const style_id = napi.getU32(env, args[3]) orelse return null;
    const priority_u = napi.getU32(env, args[4]) orelse return null;
    const hl_ref_u = napi.getU32(env, args[5]) orelse return null;
    const ExternalHighlight = extern struct { start: u32, end: u32, style_id: u32, priority: u8, hl_ref: u16 };
    var hl = ExternalHighlight{ .start = start, .end = end_val, .style_id = style_id, .priority = @intCast(priority_u), .hl_ref = @intCast(hl_ref_u) };
    textBufferAddHighlightByCharRange(ptr, @ptrCast(&hl));
    return napi.getUndefined(env);
}

pub fn jsTextBufferRemoveHighlightsByRef(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "textBufferRemoveHighlightsByRef(tb, hl_ref)")) return null;
    const tb = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    const hl_ref_u = napi.getU32(env, args[1]) orelse return null;
    textBufferRemoveHighlightsByRef(tb, @intCast(hl_ref_u));
    return napi.getUndefined(env);
}

pub fn jsTextBufferClearLineHighlights(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "textBufferClearLineHighlights(tb, line_idx)")) return null;
    const tb = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    const line_idx = napi.getU32(env, args[1]) orelse return null;
    textBufferClearLineHighlights(tb, line_idx);
    return napi.getUndefined(env);
}

pub fn jsTextBufferClearAllHighlights(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "textBufferClearAllHighlights(tb)")) return null;
    const tb = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    textBufferClearAllHighlights(tb);
    return napi.getUndefined(env);
}

pub fn jsTextBufferSetSyntaxStyle(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "textBufferSetSyntaxStyle(tb, style)")) return null;
    const tb = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    const style_ptr = napi.unwrapPointer(env, args[1], SyntaxStyle);
    textBufferSetSyntaxStyle(tb, style_ptr);
    return napi.getUndefined(env);
}

pub fn jsTextBufferGetLineHighlightsPtr(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "textBufferGetLineHighlightsPtr(tb, lineIdx)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    const line_idx = napi.getU32(env, args[1]) orelse return null;
    var count: usize = 0;
    const hl_ptr = textBufferGetLineHighlightsPtr(ptr, line_idx, &count);
    if (hl_ptr == null or count == 0) return napi.getNull(env);
    // Return as external; JS side must call textBufferFreeLineHighlights when done
    return napi.wrapPointer(env, @constCast(@ptrCast(hl_ptr.?)));
}

pub fn jsTextBufferFreeLineHighlights(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "textBufferFreeLineHighlights(ptr, count)")) return null;
    var ptr_raw: ?*anyopaque = null;
    if (!napi.check(env, c.napi_get_value_external(env, args[0], &ptr_raw))) return null;
    const count_f = napi.getF64(env, args[1]) orelse return null;
    const count: usize = @intFromFloat(count_f);
    textBufferFreeLineHighlights(@ptrCast(@alignCast(ptr_raw)), count);
    return napi.getUndefined(env);
}

pub fn jsTextBufferGetHighlightCount(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "textBufferGetHighlightCount(tb)")) return null;
    const tb = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    return napi.createU32(env, textBufferGetHighlightCount(tb));
}

pub fn jsTextBufferGetTextRange(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [3]napi.napi_value = .{ null, null, null };
    if (!requireArgs(env, info, &args, 3, "textBufferGetTextRange(tb, startOffset, endOffset)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    const start_offset = napi.getU32(env, args[1]) orelse return null;
    const end_offset = napi.getU32(env, args[2]) orelse return null;
    var buf: [65536]u8 = undefined;
    const len = textBufferGetTextRange(ptr, start_offset, end_offset, &buf, buf.len);
    return napi.createString(env, buf[0..len]);
}

pub fn jsTextBufferGetTextRangeByCoords(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [5]napi.napi_value = .{ null, null, null, null, null };
    if (!requireArgs(env, info, &args, 5, "textBufferGetTextRangeByCoords(tb, startRow, startCol, endRow, endCol)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    const sr = napi.getU32(env, args[1]) orelse return null;
    const sc = napi.getU32(env, args[2]) orelse return null;
    const er = napi.getU32(env, args[3]) orelse return null;
    const ec = napi.getU32(env, args[4]) orelse return null;
    var buf: [65536]u8 = undefined;
    const len = textBufferGetTextRangeByCoords(ptr, sr, sc, er, ec, &buf, buf.len);
    return napi.createString(env, buf[0..len]);
}

// -- TextBufferView --

pub fn jsCreateTextBufferView(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "createTextBufferView(tb)")) return null;
    const tb = napi.unwrapPointer(env, args[0], UnifiedTextBuffer) orelse return null;
    const ptr = createTextBufferView(tb);
    if (ptr) |p| return napi.wrapPointer(env, p);
    return napi.getNull(env);
}

pub fn jsDestroyTextBufferView(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "destroyTextBufferView(view)")) return null;
    const view = napi.unwrapPointer(env, args[0], UnifiedTextBufferView) orelse return null;
    destroyTextBufferView(view);
    return napi.getUndefined(env);
}

pub fn jsTextBufferViewSetSelection(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [11]napi.napi_value = .{ null, null, null, null, null, null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 11, "textBufferViewSetSelection(view, start, end, bgColor_r, bgColor_g, bgColor_b, bgColor_a, fgColor_r, fgColor_g, fgColor_b, fgColor_a)")) return null;
    const view = napi.unwrapPointer(env, args[0], UnifiedTextBufferView) orelse return null;
    const start = napi.getU32(env, args[1]) orelse return null;
    const end = napi.getU32(env, args[2]) orelse return null;
    const bgColor_c = readOptColor(env, &args, 3);
    const fgColor_c = readOptColor(env, &args, 7);
    textBufferViewSetSelection(view, start, end, if (bgColor_c) |*p| p else null, if (fgColor_c) |*p| p else null);
    return napi.getUndefined(env);
}

pub fn jsTextBufferViewResetSelection(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "textBufferViewResetSelection(view)")) return null;
    const view = napi.unwrapPointer(env, args[0], UnifiedTextBufferView) orelse return null;
    textBufferViewResetSelection(view);
    return napi.getUndefined(env);
}

pub fn jsTextBufferViewGetSelectionInfo(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "textBufferViewGetSelectionInfo(view)")) return null;
    const view = napi.unwrapPointer(env, args[0], UnifiedTextBufferView) orelse return null;
    return napi.createF64(env, @floatFromInt(textBufferViewGetSelectionInfo(view)));
}

pub fn jsTextBufferViewSetLocalSelection(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [13]napi.napi_value = .{ null, null, null, null, null, null, null, null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 13, "textBufferViewSetLocalSelection(view, anchorX, anchorY, focusX, focusY, bgColor_r, bgColor_g, bgColor_b, bgColor_a, fgColor_r, fgColor_g, fgColor_b, fgColor_a)")) return null;
    const view = napi.unwrapPointer(env, args[0], UnifiedTextBufferView) orelse return null;
    const anchorX = napi.getI32(env, args[1]) orelse return null;
    const anchorY = napi.getI32(env, args[2]) orelse return null;
    const focusX = napi.getI32(env, args[3]) orelse return null;
    const focusY = napi.getI32(env, args[4]) orelse return null;
    const bgColor_c = readOptColor(env, &args, 5);
    const fgColor_c = readOptColor(env, &args, 9);
    return napi.createBool(env, textBufferViewSetLocalSelection(view, anchorX, anchorY, focusX, focusY, if (bgColor_c) |*p| p else null, if (fgColor_c) |*p| p else null));
}

pub fn jsTextBufferViewUpdateSelection(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [10]napi.napi_value = .{ null, null, null, null, null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 10, "textBufferViewUpdateSelection(view, end, bgColor_r, bgColor_g, bgColor_b, bgColor_a, fgColor_r, fgColor_g, fgColor_b, fgColor_a)")) return null;
    const view = napi.unwrapPointer(env, args[0], UnifiedTextBufferView) orelse return null;
    const end = napi.getU32(env, args[1]) orelse return null;
    const bgColor_c = readOptColor(env, &args, 2);
    const fgColor_c = readOptColor(env, &args, 6);
    textBufferViewUpdateSelection(view, end, if (bgColor_c) |*p| p else null, if (fgColor_c) |*p| p else null);
    return napi.getUndefined(env);
}

pub fn jsTextBufferViewUpdateLocalSelection(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [13]napi.napi_value = .{ null, null, null, null, null, null, null, null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 13, "textBufferViewUpdateLocalSelection(view, anchorX, anchorY, focusX, focusY, bgColor_r, bgColor_g, bgColor_b, bgColor_a, fgColor_r, fgColor_g, fgColor_b, fgColor_a)")) return null;
    const view = napi.unwrapPointer(env, args[0], UnifiedTextBufferView) orelse return null;
    const anchorX = napi.getI32(env, args[1]) orelse return null;
    const anchorY = napi.getI32(env, args[2]) orelse return null;
    const focusX = napi.getI32(env, args[3]) orelse return null;
    const focusY = napi.getI32(env, args[4]) orelse return null;
    const bgColor_c = readOptColor(env, &args, 5);
    const fgColor_c = readOptColor(env, &args, 9);
    return napi.createBool(env, textBufferViewUpdateLocalSelection(view, anchorX, anchorY, focusX, focusY, if (bgColor_c) |*p| p else null, if (fgColor_c) |*p| p else null));
}

pub fn jsTextBufferViewResetLocalSelection(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "textBufferViewResetLocalSelection(view)")) return null;
    const view = napi.unwrapPointer(env, args[0], UnifiedTextBufferView) orelse return null;
    textBufferViewResetLocalSelection(view);
    return napi.getUndefined(env);
}

pub fn jsTextBufferViewSetWrapWidth(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "textBufferViewSetWrapWidth(view, width)")) return null;
    const view = napi.unwrapPointer(env, args[0], UnifiedTextBufferView) orelse return null;
    const width = napi.getU32(env, args[1]) orelse return null;
    textBufferViewSetWrapWidth(view, width);
    return napi.getUndefined(env);
}

pub fn jsTextBufferViewSetWrapMode(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "textBufferViewSetWrapMode(view, mode)")) return null;
    const view = napi.unwrapPointer(env, args[0], UnifiedTextBufferView) orelse return null;
    const mode_u = napi.getU32(env, args[1]) orelse return null;
    textBufferViewSetWrapMode(view, @intCast(mode_u));
    return napi.getUndefined(env);
}

pub fn jsTextBufferViewSetViewportSize(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [3]napi.napi_value = .{ null, null, null };
    if (!requireArgs(env, info, &args, 3, "textBufferViewSetViewportSize(view, width, height)")) return null;
    const view = napi.unwrapPointer(env, args[0], UnifiedTextBufferView) orelse return null;
    const width = napi.getU32(env, args[1]) orelse return null;
    const height = napi.getU32(env, args[2]) orelse return null;
    textBufferViewSetViewportSize(view, width, height);
    return napi.getUndefined(env);
}

pub fn jsTextBufferViewSetViewport(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [5]napi.napi_value = .{ null, null, null, null, null };
    if (!requireArgs(env, info, &args, 5, "textBufferViewSetViewport(view, x, y, width, height)")) return null;
    const view = napi.unwrapPointer(env, args[0], UnifiedTextBufferView) orelse return null;
    const x = napi.getU32(env, args[1]) orelse return null;
    const y = napi.getU32(env, args[2]) orelse return null;
    const width = napi.getU32(env, args[3]) orelse return null;
    const height = napi.getU32(env, args[4]) orelse return null;
    textBufferViewSetViewport(view, x, y, width, height);
    return napi.getUndefined(env);
}

pub fn jsTextBufferViewGetVirtualLineCount(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "textBufferViewGetVirtualLineCount(view)")) return null;
    const view = napi.unwrapPointer(env, args[0], UnifiedTextBufferView) orelse return null;
    return napi.createU32(env, textBufferViewGetVirtualLineCount(view));
}

pub fn jsTextBufferViewGetLineInfoDirect(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "textBufferViewGetLineInfoDirect(view)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], UnifiedTextBufferView) orelse return null;
    const ExternalLineInfo = extern struct { start_cols_ptr: *const anyopaque, start_cols_len: u32, width_cols_ptr: *const anyopaque, width_cols_len: u32, sources_ptr: *const anyopaque, sources_len: u32, wraps_ptr: *const anyopaque, wraps_len: u32, width_cols_max: u32 };
    var li: ExternalLineInfo = undefined;
    textBufferViewGetLineInfoDirect(ptr, @ptrCast(&li));
    const obj = napi.createObject(env);
    _ = napi.setNamedProperty(env, obj, "startColsLen", napi.createU32(env, li.start_cols_len));
    _ = napi.setNamedProperty(env, obj, "widthColsLen", napi.createU32(env, li.width_cols_len));
    _ = napi.setNamedProperty(env, obj, "sourcesLen", napi.createU32(env, li.sources_len));
    _ = napi.setNamedProperty(env, obj, "wrapsLen", napi.createU32(env, li.wraps_len));
    _ = napi.setNamedProperty(env, obj, "widthColsMax", napi.createU32(env, li.width_cols_max));
    return obj;
}

pub fn jsTextBufferViewGetLogicalLineInfoDirect(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "textBufferViewGetLogicalLineInfoDirect(view)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], UnifiedTextBufferView) orelse return null;
    const ExternalLineInfo = extern struct { start_cols_ptr: *const anyopaque, start_cols_len: u32, width_cols_ptr: *const anyopaque, width_cols_len: u32, sources_ptr: *const anyopaque, sources_len: u32, wraps_ptr: *const anyopaque, wraps_len: u32, width_cols_max: u32 };
    var li: ExternalLineInfo = undefined;
    textBufferViewGetLogicalLineInfoDirect(ptr, @ptrCast(&li));
    const obj = napi.createObject(env);
    _ = napi.setNamedProperty(env, obj, "startColsLen", napi.createU32(env, li.start_cols_len));
    _ = napi.setNamedProperty(env, obj, "widthColsLen", napi.createU32(env, li.width_cols_len));
    _ = napi.setNamedProperty(env, obj, "sourcesLen", napi.createU32(env, li.sources_len));
    _ = napi.setNamedProperty(env, obj, "wrapsLen", napi.createU32(env, li.wraps_len));
    _ = napi.setNamedProperty(env, obj, "widthColsMax", napi.createU32(env, li.width_cols_max));
    return obj;
}

pub fn jsTextBufferViewGetSelectedText(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "textBufferViewGetSelectedText(view)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], UnifiedTextBufferView) orelse return null;
    var buf: [65536]u8 = undefined;
    const len = textBufferViewGetSelectedText(ptr, &buf, buf.len);
    return napi.createString(env, buf[0..len]);
}

pub fn jsTextBufferViewGetPlainText(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "textBufferViewGetPlainText(view)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], UnifiedTextBufferView) orelse return null;
    var buf: [65536]u8 = undefined;
    const len = textBufferViewGetPlainText(ptr, &buf, buf.len);
    return napi.createString(env, buf[0..len]);
}

pub fn jsTextBufferViewSetTabIndicator(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "textBufferViewSetTabIndicator(view, indicator)")) return null;
    const view = napi.unwrapPointer(env, args[0], UnifiedTextBufferView) orelse return null;
    const indicator = napi.getU32(env, args[1]) orelse return null;
    textBufferViewSetTabIndicator(view, indicator);
    return napi.getUndefined(env);
}

pub fn jsTextBufferViewSetTabIndicatorColor(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [5]napi.napi_value = .{ null, null, null, null, null };
    if (!requireArgs(env, info, &args, 5, "textBufferViewSetTabIndicatorColor(view, color_r, color_g, color_b, color_a)")) return null;
    const view = napi.unwrapPointer(env, args[0], UnifiedTextBufferView) orelse return null;
    const color = readColor(env, &args, 1) orelse return null;
    textBufferViewSetTabIndicatorColor(view, &color);
    return napi.getUndefined(env);
}

pub fn jsTextBufferViewSetTruncate(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "textBufferViewSetTruncate(view, truncate)")) return null;
    const view = napi.unwrapPointer(env, args[0], UnifiedTextBufferView) orelse return null;
    const truncate = napi.getBool(env, args[1]) orelse return null;
    textBufferViewSetTruncate(view, truncate);
    return napi.getUndefined(env);
}

pub fn jsTextBufferViewMeasureForDimensions(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [3]napi.napi_value = .{ null, null, null };
    if (!requireArgs(env, info, &args, 3, "textBufferViewMeasureForDimensions(view, width, height)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], UnifiedTextBufferView) orelse return null;
    const w = napi.getU32(env, args[1]) orelse return null;
    const h = napi.getU32(env, args[2]) orelse return null;
    const ExternalMeasureResult = extern struct { line_count: u32, width_cols_max: u32 };
    var result: ExternalMeasureResult = undefined;
    const ok = textBufferViewMeasureForDimensions(ptr, w, h, @ptrCast(&result));
    if (!ok) return napi.getNull(env);
    const obj = napi.createObject(env);
    _ = napi.setNamedProperty(env, obj, "lineCount", napi.createU32(env, result.line_count));
    _ = napi.setNamedProperty(env, obj, "widthColsMax", napi.createU32(env, result.width_cols_max));
    return obj;
}

// -- EditBuffer --

pub fn jsCreateEditBuffer(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "createEditBuffer(widthMethod)")) return null;
    const widthMethod_u = napi.getU32(env, args[0]) orelse return null;
    const ptr = createEditBuffer(@intCast(widthMethod_u));
    if (ptr) |p| return napi.wrapPointer(env, p);
    return napi.getNull(env);
}

pub fn jsDestroyEditBuffer(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "destroyEditBuffer(edit_buffer)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    destroyEditBuffer(edit_buffer);
    return napi.getUndefined(env);
}

pub fn jsEditBufferGetTextBuffer(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "editBufferGetTextBuffer(edit_buffer)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    return napi.wrapPointer(env, editBufferGetTextBuffer(edit_buffer));
}

pub fn jsEditBufferInsertText(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "editBufferInsertText(edit_buffer, text)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    var text_buf: [65536]u8 = undefined;
    const text = napi.getString(env, args[1], &text_buf) orelse return null;
    editBufferInsertText(edit_buffer, text.ptr, text.len);
    return napi.getUndefined(env);
}

pub fn jsEditBufferDeleteRange(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [5]napi.napi_value = .{ null, null, null, null, null };
    if (!requireArgs(env, info, &args, 5, "editBufferDeleteRange(edit_buffer, start_row, start_col, end_row, end_col)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    const start_row = napi.getU32(env, args[1]) orelse return null;
    const start_col = napi.getU32(env, args[2]) orelse return null;
    const end_row = napi.getU32(env, args[3]) orelse return null;
    const end_col = napi.getU32(env, args[4]) orelse return null;
    editBufferDeleteRange(edit_buffer, start_row, start_col, end_row, end_col);
    return napi.getUndefined(env);
}

pub fn jsEditBufferDeleteCharBackward(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "editBufferDeleteCharBackward(edit_buffer)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    editBufferDeleteCharBackward(edit_buffer);
    return napi.getUndefined(env);
}

pub fn jsEditBufferDeleteChar(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "editBufferDeleteChar(edit_buffer)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    editBufferDeleteChar(edit_buffer);
    return napi.getUndefined(env);
}

pub fn jsEditBufferMoveCursorLeft(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "editBufferMoveCursorLeft(edit_buffer)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    editBufferMoveCursorLeft(edit_buffer);
    return napi.getUndefined(env);
}

pub fn jsEditBufferMoveCursorRight(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "editBufferMoveCursorRight(edit_buffer)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    editBufferMoveCursorRight(edit_buffer);
    return napi.getUndefined(env);
}

pub fn jsEditBufferMoveCursorUp(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "editBufferMoveCursorUp(edit_buffer)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    editBufferMoveCursorUp(edit_buffer);
    return napi.getUndefined(env);
}

pub fn jsEditBufferMoveCursorDown(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "editBufferMoveCursorDown(edit_buffer)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    editBufferMoveCursorDown(edit_buffer);
    return napi.getUndefined(env);
}

pub fn jsEditBufferGetCursor(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "editBufferGetCursor(editBuffer)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    var row: u32 = 0;
    var col: u32 = 0;
    editBufferGetCursor(ptr, &row, &col);
    const obj = napi.createObject(env);
    _ = napi.setNamedProperty(env, obj, "row", napi.createU32(env, row));
    _ = napi.setNamedProperty(env, obj, "col", napi.createU32(env, col));
    return obj;
}

pub fn jsEditBufferSetCursor(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [3]napi.napi_value = .{ null, null, null };
    if (!requireArgs(env, info, &args, 3, "editBufferSetCursor(edit_buffer, row, col)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    const row = napi.getU32(env, args[1]) orelse return null;
    const col = napi.getU32(env, args[2]) orelse return null;
    editBufferSetCursor(edit_buffer, row, col);
    return napi.getUndefined(env);
}

pub fn jsEditBufferSetCursorToLineCol(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [3]napi.napi_value = .{ null, null, null };
    if (!requireArgs(env, info, &args, 3, "editBufferSetCursorToLineCol(edit_buffer, row, col)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    const row = napi.getU32(env, args[1]) orelse return null;
    const col = napi.getU32(env, args[2]) orelse return null;
    editBufferSetCursorToLineCol(edit_buffer, row, col);
    return napi.getUndefined(env);
}

pub fn jsEditBufferSetCursorByOffset(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "editBufferSetCursorByOffset(edit_buffer, offset)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    const offset = napi.getU32(env, args[1]) orelse return null;
    editBufferSetCursorByOffset(edit_buffer, offset);
    return napi.getUndefined(env);
}

pub fn jsEditBufferGetNextWordBoundary(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "editBufferGetNextWordBoundary(editBuffer)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    const ExternalLogicalCursor = extern struct { row: u32, col: u32, offset: u32 };
    var cursor: ExternalLogicalCursor = undefined;
    editBufferGetNextWordBoundary(ptr, @ptrCast(&cursor));
    const obj = napi.createObject(env);
    _ = napi.setNamedProperty(env, obj, "row", napi.createU32(env, cursor.row));
    _ = napi.setNamedProperty(env, obj, "col", napi.createU32(env, cursor.col));
    _ = napi.setNamedProperty(env, obj, "offset", napi.createU32(env, cursor.offset));
    return obj;
}

pub fn jsEditBufferGetPrevWordBoundary(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "editBufferGetPrevWordBoundary(editBuffer)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    const ExternalLogicalCursor = extern struct { row: u32, col: u32, offset: u32 };
    var cursor: ExternalLogicalCursor = undefined;
    editBufferGetPrevWordBoundary(ptr, @ptrCast(&cursor));
    const obj = napi.createObject(env);
    _ = napi.setNamedProperty(env, obj, "row", napi.createU32(env, cursor.row));
    _ = napi.setNamedProperty(env, obj, "col", napi.createU32(env, cursor.col));
    _ = napi.setNamedProperty(env, obj, "offset", napi.createU32(env, cursor.offset));
    return obj;
}

pub fn jsEditBufferGetEOL(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "editBufferGetEOL(editBuffer)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    const ExternalLogicalCursor = extern struct { row: u32, col: u32, offset: u32 };
    var cursor: ExternalLogicalCursor = undefined;
    editBufferGetEOL(ptr, @ptrCast(&cursor));
    const obj = napi.createObject(env);
    _ = napi.setNamedProperty(env, obj, "row", napi.createU32(env, cursor.row));
    _ = napi.setNamedProperty(env, obj, "col", napi.createU32(env, cursor.col));
    _ = napi.setNamedProperty(env, obj, "offset", napi.createU32(env, cursor.offset));
    return obj;
}

pub fn jsEditBufferOffsetToPosition(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "editBufferOffsetToPosition(editBuffer, offset)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    const offset = napi.getU32(env, args[1]) orelse return null;
    const ExternalLogicalCursor = extern struct { row: u32, col: u32, offset: u32 };
    var cursor: ExternalLogicalCursor = undefined;
    const ok = editBufferOffsetToPosition(ptr, offset, @ptrCast(&cursor));
    if (!ok) return napi.getNull(env);
    const obj = napi.createObject(env);
    _ = napi.setNamedProperty(env, obj, "row", napi.createU32(env, cursor.row));
    _ = napi.setNamedProperty(env, obj, "col", napi.createU32(env, cursor.col));
    _ = napi.setNamedProperty(env, obj, "offset", napi.createU32(env, cursor.offset));
    return obj;
}

pub fn jsEditBufferPositionToOffset(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [3]napi.napi_value = .{ null, null, null };
    if (!requireArgs(env, info, &args, 3, "editBufferPositionToOffset(edit_buffer, row, col)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    const row = napi.getU32(env, args[1]) orelse return null;
    const col = napi.getU32(env, args[2]) orelse return null;
    return napi.createU32(env, editBufferPositionToOffset(edit_buffer, row, col));
}

pub fn jsEditBufferGetLineStartOffset(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "editBufferGetLineStartOffset(edit_buffer, row)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    const row = napi.getU32(env, args[1]) orelse return null;
    return napi.createU32(env, editBufferGetLineStartOffset(edit_buffer, row));
}

pub fn jsEditBufferGetTextRange(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [3]napi.napi_value = .{ null, null, null };
    if (!requireArgs(env, info, &args, 3, "editBufferGetTextRange(editBuffer, startOffset, endOffset)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    const so = napi.getU32(env, args[1]) orelse return null;
    const eo = napi.getU32(env, args[2]) orelse return null;
    var buf: [65536]u8 = undefined;
    const len = editBufferGetTextRange(ptr, so, eo, &buf, buf.len);
    return napi.createString(env, buf[0..len]);
}

pub fn jsEditBufferGetTextRangeByCoords(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [5]napi.napi_value = .{ null, null, null, null, null };
    if (!requireArgs(env, info, &args, 5, "editBufferGetTextRangeByCoords(editBuffer, startRow, startCol, endRow, endCol)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    const sr = napi.getU32(env, args[1]) orelse return null;
    const sc = napi.getU32(env, args[2]) orelse return null;
    const er = napi.getU32(env, args[3]) orelse return null;
    const ec = napi.getU32(env, args[4]) orelse return null;
    var buf: [65536]u8 = undefined;
    const len = editBufferGetTextRangeByCoords(ptr, sr, sc, er, ec, &buf, buf.len);
    return napi.createString(env, buf[0..len]);
}

pub fn jsEditBufferSetText(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "editBufferSetText(edit_buffer, text)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    var text_buf: [65536]u8 = undefined;
    const text = napi.getString(env, args[1], &text_buf) orelse return null;
    editBufferSetText(edit_buffer, text.ptr, text.len);
    return napi.getUndefined(env);
}

pub fn jsEditBufferSetTextFromMem(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "editBufferSetTextFromMem(edit_buffer, mem_id)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    const mem_id_u = napi.getU32(env, args[1]) orelse return null;
    editBufferSetTextFromMem(edit_buffer, @intCast(mem_id_u));
    return napi.getUndefined(env);
}

pub fn jsEditBufferReplaceText(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "editBufferReplaceText(edit_buffer, text)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    var text_buf: [65536]u8 = undefined;
    const text = napi.getString(env, args[1], &text_buf) orelse return null;
    editBufferReplaceText(edit_buffer, text.ptr, text.len);
    return napi.getUndefined(env);
}

pub fn jsEditBufferReplaceTextFromMem(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "editBufferReplaceTextFromMem(edit_buffer, mem_id)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    const mem_id_u = napi.getU32(env, args[1]) orelse return null;
    editBufferReplaceTextFromMem(edit_buffer, @intCast(mem_id_u));
    return napi.getUndefined(env);
}

pub fn jsEditBufferGetText(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "editBufferGetText(editBuffer)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    var buf: [65536]u8 = undefined;
    const len = editBufferGetText(ptr, &buf, buf.len);
    return napi.createString(env, buf[0..len]);
}

pub fn jsEditBufferInsertChar(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "editBufferInsertChar(edit_buffer, char)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    var char_buf: [65536]u8 = undefined;
    const char = napi.getString(env, args[1], &char_buf) orelse return null;
    editBufferInsertChar(edit_buffer, char.ptr, char.len);
    return napi.getUndefined(env);
}

pub fn jsEditBufferNewLine(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "editBufferNewLine(edit_buffer)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    editBufferNewLine(edit_buffer);
    return napi.getUndefined(env);
}

pub fn jsEditBufferDeleteLine(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "editBufferDeleteLine(edit_buffer)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    editBufferDeleteLine(edit_buffer);
    return napi.getUndefined(env);
}

pub fn jsEditBufferGotoLine(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "editBufferGotoLine(edit_buffer, line)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    const line = napi.getU32(env, args[1]) orelse return null;
    editBufferGotoLine(edit_buffer, line);
    return napi.getUndefined(env);
}

pub fn jsEditBufferGetCursorPosition(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "editBufferGetCursorPosition(editBuffer)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    const ExternalLogicalCursor = extern struct { row: u32, col: u32, offset: u32 };
    var cursor: ExternalLogicalCursor = undefined;
    editBufferGetCursorPosition(ptr, @ptrCast(&cursor));
    const obj = napi.createObject(env);
    _ = napi.setNamedProperty(env, obj, "row", napi.createU32(env, cursor.row));
    _ = napi.setNamedProperty(env, obj, "col", napi.createU32(env, cursor.col));
    _ = napi.setNamedProperty(env, obj, "offset", napi.createU32(env, cursor.offset));
    return obj;
}

pub fn jsEditBufferGetId(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "editBufferGetId(edit_buffer)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    return napi.createU32(env, @intCast(editBufferGetId(edit_buffer)));
}

pub fn jsEditBufferDebugLogRope(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "editBufferDebugLogRope(edit_buffer)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    editBufferDebugLogRope(edit_buffer);
    return napi.getUndefined(env);
}

pub fn jsEditBufferUndo(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "editBufferUndo(editBuffer)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    var buf: [65536]u8 = undefined;
    const len = editBufferUndo(ptr, &buf, buf.len);
    if (len == 0) return napi.createString(env, "");
    return napi.createString(env, buf[0..len]);
}

pub fn jsEditBufferRedo(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "editBufferRedo(editBuffer)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    var buf: [65536]u8 = undefined;
    const len = editBufferRedo(ptr, &buf, buf.len);
    if (len == 0) return napi.createString(env, "");
    return napi.createString(env, buf[0..len]);
}

pub fn jsEditBufferCanUndo(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "editBufferCanUndo(edit_buffer)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    return napi.createBool(env, editBufferCanUndo(edit_buffer));
}

pub fn jsEditBufferCanRedo(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "editBufferCanRedo(edit_buffer)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    return napi.createBool(env, editBufferCanRedo(edit_buffer));
}

pub fn jsEditBufferClearHistory(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "editBufferClearHistory(edit_buffer)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    editBufferClearHistory(edit_buffer);
    return napi.getUndefined(env);
}

pub fn jsEditBufferClear(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "editBufferClear(edit_buffer)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    editBufferClear(edit_buffer);
    return napi.getUndefined(env);
}

// -- EditorView --

pub fn jsCreateEditorView(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [3]napi.napi_value = .{ null, null, null };
    if (!requireArgs(env, info, &args, 3, "createEditorView(edit_buffer, viewport_width, viewport_height)")) return null;
    const edit_buffer = napi.unwrapPointer(env, args[0], EditBuffer) orelse return null;
    const viewport_width = napi.getU32(env, args[1]) orelse return null;
    const viewport_height = napi.getU32(env, args[2]) orelse return null;
    const ptr = createEditorView(edit_buffer, viewport_width, viewport_height);
    if (ptr) |p| return napi.wrapPointer(env, p);
    return napi.getNull(env);
}

pub fn jsDestroyEditorView(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "destroyEditorView(view)")) return null;
    const view = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    destroyEditorView(view);
    return napi.getUndefined(env);
}

pub fn jsEditorViewSetViewport(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [6]napi.napi_value = .{ null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 6, "editorViewSetViewport(view, x, y, width, height, moveCursor)")) return null;
    const view = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    const x = napi.getU32(env, args[1]) orelse return null;
    const y = napi.getU32(env, args[2]) orelse return null;
    const width = napi.getU32(env, args[3]) orelse return null;
    const height = napi.getU32(env, args[4]) orelse return null;
    const moveCursor = napi.getBool(env, args[5]) orelse return null;
    editorViewSetViewport(view, x, y, width, height, moveCursor);
    return napi.getUndefined(env);
}

pub fn jsEditorViewClearViewport(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "editorViewClearViewport(view)")) return null;
    const view = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    editorViewClearViewport(view);
    return napi.getUndefined(env);
}

pub fn jsEditorViewGetViewport(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "editorViewGetViewport(view)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    var x: u32 = 0;
    var y: u32 = 0;
    var w: u32 = 0;
    var h: u32 = 0;
    const ok = editorViewGetViewport(ptr, &x, &y, &w, &h);
    if (!ok) return napi.getNull(env);
    const obj = napi.createObject(env);
    _ = napi.setNamedProperty(env, obj, "x", napi.createU32(env, x));
    _ = napi.setNamedProperty(env, obj, "y", napi.createU32(env, y));
    _ = napi.setNamedProperty(env, obj, "width", napi.createU32(env, w));
    _ = napi.setNamedProperty(env, obj, "height", napi.createU32(env, h));
    return obj;
}

pub fn jsEditorViewSetScrollMargin(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "editorViewSetScrollMargin(view, margin)")) return null;
    const view = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    const margin_f = napi.getF64(env, args[1]) orelse return null;
    editorViewSetScrollMargin(view, @floatCast(margin_f));
    return napi.getUndefined(env);
}

pub fn jsEditorViewGetVirtualLineCount(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "editorViewGetVirtualLineCount(view)")) return null;
    const view = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    return napi.createU32(env, editorViewGetVirtualLineCount(view));
}

pub fn jsEditorViewGetTotalVirtualLineCount(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "editorViewGetTotalVirtualLineCount(view)")) return null;
    const view = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    return napi.createU32(env, editorViewGetTotalVirtualLineCount(view));
}

pub fn jsEditorViewGetLineInfoDirect(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "editorViewGetLineInfoDirect(view)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    const ExternalLineInfo = extern struct { start_cols_ptr: *const anyopaque, start_cols_len: u32, width_cols_ptr: *const anyopaque, width_cols_len: u32, sources_ptr: *const anyopaque, sources_len: u32, wraps_ptr: *const anyopaque, wraps_len: u32, width_cols_max: u32 };
    var li: ExternalLineInfo = undefined;
    editorViewGetLineInfoDirect(ptr, @ptrCast(&li));
    const obj = napi.createObject(env);
    _ = napi.setNamedProperty(env, obj, "startColsLen", napi.createU32(env, li.start_cols_len));
    _ = napi.setNamedProperty(env, obj, "widthColsLen", napi.createU32(env, li.width_cols_len));
    _ = napi.setNamedProperty(env, obj, "sourcesLen", napi.createU32(env, li.sources_len));
    _ = napi.setNamedProperty(env, obj, "wrapsLen", napi.createU32(env, li.wraps_len));
    _ = napi.setNamedProperty(env, obj, "widthColsMax", napi.createU32(env, li.width_cols_max));
    return obj;
}

pub fn jsEditorViewGetTextBufferView(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "editorViewGetTextBufferView(view)")) return null;
    const view = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    return napi.wrapPointer(env, editorViewGetTextBufferView(view));
}

pub fn jsEditorViewGetLogicalLineInfoDirect(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "editorViewGetLogicalLineInfoDirect(view)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    const ExternalLineInfo = extern struct { start_cols_ptr: *const anyopaque, start_cols_len: u32, width_cols_ptr: *const anyopaque, width_cols_len: u32, sources_ptr: *const anyopaque, sources_len: u32, wraps_ptr: *const anyopaque, wraps_len: u32, width_cols_max: u32 };
    var li: ExternalLineInfo = undefined;
    editorViewGetLogicalLineInfoDirect(ptr, @ptrCast(&li));
    const obj = napi.createObject(env);
    _ = napi.setNamedProperty(env, obj, "startColsLen", napi.createU32(env, li.start_cols_len));
    _ = napi.setNamedProperty(env, obj, "widthColsLen", napi.createU32(env, li.width_cols_len));
    _ = napi.setNamedProperty(env, obj, "sourcesLen", napi.createU32(env, li.sources_len));
    _ = napi.setNamedProperty(env, obj, "wrapsLen", napi.createU32(env, li.wraps_len));
    _ = napi.setNamedProperty(env, obj, "widthColsMax", napi.createU32(env, li.width_cols_max));
    return obj;
}

pub fn jsEditorViewSetViewportSize(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [3]napi.napi_value = .{ null, null, null };
    if (!requireArgs(env, info, &args, 3, "editorViewSetViewportSize(view, width, height)")) return null;
    const view = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    const width = napi.getU32(env, args[1]) orelse return null;
    const height = napi.getU32(env, args[2]) orelse return null;
    editorViewSetViewportSize(view, width, height);
    return napi.getUndefined(env);
}

pub fn jsEditorViewSetWrapMode(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "editorViewSetWrapMode(view, mode)")) return null;
    const view = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    const mode_u = napi.getU32(env, args[1]) orelse return null;
    editorViewSetWrapMode(view, @intCast(mode_u));
    return napi.getUndefined(env);
}

pub fn jsEditorViewSetSelection(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [11]napi.napi_value = .{ null, null, null, null, null, null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 11, "editorViewSetSelection(view, start, end, bgColor_r, bgColor_g, bgColor_b, bgColor_a, fgColor_r, fgColor_g, fgColor_b, fgColor_a)")) return null;
    const view = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    const start = napi.getU32(env, args[1]) orelse return null;
    const end = napi.getU32(env, args[2]) orelse return null;
    const bgColor_c = readOptColor(env, &args, 3);
    const fgColor_c = readOptColor(env, &args, 7);
    editorViewSetSelection(view, start, end, if (bgColor_c) |*p| p else null, if (fgColor_c) |*p| p else null);
    return napi.getUndefined(env);
}

pub fn jsEditorViewResetSelection(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "editorViewResetSelection(view)")) return null;
    const view = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    editorViewResetSelection(view);
    return napi.getUndefined(env);
}

pub fn jsEditorViewGetSelection(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "editorViewGetSelection(view)")) return null;
    const view = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    return napi.createF64(env, @floatFromInt(editorViewGetSelection(view)));
}

pub fn jsEditorViewSetLocalSelection(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [15]napi.napi_value = .{ null, null, null, null, null, null, null, null, null, null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 15, "editorViewSetLocalSelection(view, anchorX, anchorY, focusX, focusY, bgColor_r, bgColor_g, bgColor_b, bgColor_a, fgColor_r, fgColor_g, fgColor_b, fgColor_a, updateCursor, followCursor)")) return null;
    const view = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    const anchorX = napi.getI32(env, args[1]) orelse return null;
    const anchorY = napi.getI32(env, args[2]) orelse return null;
    const focusX = napi.getI32(env, args[3]) orelse return null;
    const focusY = napi.getI32(env, args[4]) orelse return null;
    const bgColor_c = readOptColor(env, &args, 5);
    const fgColor_c = readOptColor(env, &args, 9);
    const updateCursor = napi.getBool(env, args[13]) orelse return null;
    const followCursor = napi.getBool(env, args[14]) orelse return null;
    return napi.createBool(env, editorViewSetLocalSelection(view, anchorX, anchorY, focusX, focusY, if (bgColor_c) |*p| p else null, if (fgColor_c) |*p| p else null, updateCursor, followCursor));
}

pub fn jsEditorViewUpdateSelection(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [10]napi.napi_value = .{ null, null, null, null, null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 10, "editorViewUpdateSelection(view, end, bgColor_r, bgColor_g, bgColor_b, bgColor_a, fgColor_r, fgColor_g, fgColor_b, fgColor_a)")) return null;
    const view = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    const end = napi.getU32(env, args[1]) orelse return null;
    const bgColor_c = readOptColor(env, &args, 2);
    const fgColor_c = readOptColor(env, &args, 6);
    editorViewUpdateSelection(view, end, if (bgColor_c) |*p| p else null, if (fgColor_c) |*p| p else null);
    return napi.getUndefined(env);
}

pub fn jsEditorViewUpdateLocalSelection(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [15]napi.napi_value = .{ null, null, null, null, null, null, null, null, null, null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 15, "editorViewUpdateLocalSelection(view, anchorX, anchorY, focusX, focusY, bgColor_r, bgColor_g, bgColor_b, bgColor_a, fgColor_r, fgColor_g, fgColor_b, fgColor_a, updateCursor, followCursor)")) return null;
    const view = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    const anchorX = napi.getI32(env, args[1]) orelse return null;
    const anchorY = napi.getI32(env, args[2]) orelse return null;
    const focusX = napi.getI32(env, args[3]) orelse return null;
    const focusY = napi.getI32(env, args[4]) orelse return null;
    const bgColor_c = readOptColor(env, &args, 5);
    const fgColor_c = readOptColor(env, &args, 9);
    const updateCursor = napi.getBool(env, args[13]) orelse return null;
    const followCursor = napi.getBool(env, args[14]) orelse return null;
    return napi.createBool(env, editorViewUpdateLocalSelection(view, anchorX, anchorY, focusX, focusY, if (bgColor_c) |*p| p else null, if (fgColor_c) |*p| p else null, updateCursor, followCursor));
}

pub fn jsEditorViewResetLocalSelection(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "editorViewResetLocalSelection(view)")) return null;
    const view = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    editorViewResetLocalSelection(view);
    return napi.getUndefined(env);
}

pub fn jsEditorViewGetSelectedTextBytes(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "editorViewGetSelectedTextBytes(view)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    var buf: [65536]u8 = undefined;
    const len = editorViewGetSelectedTextBytes(ptr, &buf, buf.len);
    return napi.createString(env, buf[0..len]);
}

pub fn jsEditorViewGetCursor(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "editorViewGetCursor(view)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    var row: u32 = 0;
    var col: u32 = 0;
    editorViewGetCursor(ptr, &row, &col);
    const obj = napi.createObject(env);
    _ = napi.setNamedProperty(env, obj, "row", napi.createU32(env, row));
    _ = napi.setNamedProperty(env, obj, "col", napi.createU32(env, col));
    return obj;
}

pub fn jsEditorViewGetText(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "editorViewGetText(view)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    var buf: [65536]u8 = undefined;
    const len = editorViewGetText(ptr, &buf, buf.len);
    return napi.createString(env, buf[0..len]);
}

pub fn jsEditorViewGetVisualCursor(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "editorViewGetVisualCursor(view)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    const ExternalVisualCursor = extern struct { visual_row: u32, visual_col: u32, logical_row: u32, logical_col: u32, offset: u32 };
    var cursor: ExternalVisualCursor = undefined;
    editorViewGetVisualCursor(ptr, @ptrCast(&cursor));
    const obj = napi.createObject(env);
    _ = napi.setNamedProperty(env, obj, "visualRow", napi.createU32(env, cursor.visual_row));
    _ = napi.setNamedProperty(env, obj, "visualCol", napi.createU32(env, cursor.visual_col));
    _ = napi.setNamedProperty(env, obj, "logicalRow", napi.createU32(env, cursor.logical_row));
    _ = napi.setNamedProperty(env, obj, "logicalCol", napi.createU32(env, cursor.logical_col));
    _ = napi.setNamedProperty(env, obj, "offset", napi.createU32(env, cursor.offset));
    return obj;
}

pub fn jsEditorViewMoveUpVisual(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "editorViewMoveUpVisual(view)")) return null;
    const view = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    editorViewMoveUpVisual(view);
    return napi.getUndefined(env);
}

pub fn jsEditorViewMoveDownVisual(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "editorViewMoveDownVisual(view)")) return null;
    const view = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    editorViewMoveDownVisual(view);
    return napi.getUndefined(env);
}

pub fn jsEditorViewDeleteSelectedText(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "editorViewDeleteSelectedText(view)")) return null;
    const view = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    editorViewDeleteSelectedText(view);
    return napi.getUndefined(env);
}

pub fn jsEditorViewSetCursorByOffset(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "editorViewSetCursorByOffset(view, offset)")) return null;
    const view = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    const offset = napi.getU32(env, args[1]) orelse return null;
    editorViewSetCursorByOffset(view, offset);
    return napi.getUndefined(env);
}

pub fn jsEditorViewGetNextWordBoundary(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "editorViewGetNextWordBoundary(view)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    const ExternalVisualCursor = extern struct { visual_row: u32, visual_col: u32, logical_row: u32, logical_col: u32, offset: u32 };
    var cursor: ExternalVisualCursor = undefined;
    editorViewGetNextWordBoundary(ptr, @ptrCast(&cursor));
    const obj = napi.createObject(env);
    _ = napi.setNamedProperty(env, obj, "visualRow", napi.createU32(env, cursor.visual_row));
    _ = napi.setNamedProperty(env, obj, "visualCol", napi.createU32(env, cursor.visual_col));
    _ = napi.setNamedProperty(env, obj, "logicalRow", napi.createU32(env, cursor.logical_row));
    _ = napi.setNamedProperty(env, obj, "logicalCol", napi.createU32(env, cursor.logical_col));
    _ = napi.setNamedProperty(env, obj, "offset", napi.createU32(env, cursor.offset));
    return obj;
}

pub fn jsEditorViewGetPrevWordBoundary(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "editorViewGetPrevWordBoundary(view)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    const ExternalVisualCursor = extern struct { visual_row: u32, visual_col: u32, logical_row: u32, logical_col: u32, offset: u32 };
    var cursor: ExternalVisualCursor = undefined;
    editorViewGetPrevWordBoundary(ptr, @ptrCast(&cursor));
    const obj = napi.createObject(env);
    _ = napi.setNamedProperty(env, obj, "visualRow", napi.createU32(env, cursor.visual_row));
    _ = napi.setNamedProperty(env, obj, "visualCol", napi.createU32(env, cursor.visual_col));
    _ = napi.setNamedProperty(env, obj, "logicalRow", napi.createU32(env, cursor.logical_row));
    _ = napi.setNamedProperty(env, obj, "logicalCol", napi.createU32(env, cursor.logical_col));
    _ = napi.setNamedProperty(env, obj, "offset", napi.createU32(env, cursor.offset));
    return obj;
}

pub fn jsEditorViewGetEOL(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "editorViewGetEOL(view)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    const ExternalVisualCursor = extern struct { visual_row: u32, visual_col: u32, logical_row: u32, logical_col: u32, offset: u32 };
    var cursor: ExternalVisualCursor = undefined;
    editorViewGetEOL(ptr, @ptrCast(&cursor));
    const obj = napi.createObject(env);
    _ = napi.setNamedProperty(env, obj, "visualRow", napi.createU32(env, cursor.visual_row));
    _ = napi.setNamedProperty(env, obj, "visualCol", napi.createU32(env, cursor.visual_col));
    _ = napi.setNamedProperty(env, obj, "logicalRow", napi.createU32(env, cursor.logical_row));
    _ = napi.setNamedProperty(env, obj, "logicalCol", napi.createU32(env, cursor.logical_col));
    _ = napi.setNamedProperty(env, obj, "offset", napi.createU32(env, cursor.offset));
    return obj;
}

pub fn jsEditorViewGetVisualSOL(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "editorViewGetVisualSOL(view)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    const ExternalVisualCursor = extern struct { visual_row: u32, visual_col: u32, logical_row: u32, logical_col: u32, offset: u32 };
    var cursor: ExternalVisualCursor = undefined;
    editorViewGetVisualSOL(ptr, @ptrCast(&cursor));
    const obj = napi.createObject(env);
    _ = napi.setNamedProperty(env, obj, "visualRow", napi.createU32(env, cursor.visual_row));
    _ = napi.setNamedProperty(env, obj, "visualCol", napi.createU32(env, cursor.visual_col));
    _ = napi.setNamedProperty(env, obj, "logicalRow", napi.createU32(env, cursor.logical_row));
    _ = napi.setNamedProperty(env, obj, "logicalCol", napi.createU32(env, cursor.logical_col));
    _ = napi.setNamedProperty(env, obj, "offset", napi.createU32(env, cursor.offset));
    return obj;
}

pub fn jsEditorViewGetVisualEOL(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "editorViewGetVisualEOL(view)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    const ExternalVisualCursor = extern struct { visual_row: u32, visual_col: u32, logical_row: u32, logical_col: u32, offset: u32 };
    var cursor: ExternalVisualCursor = undefined;
    editorViewGetVisualEOL(ptr, @ptrCast(&cursor));
    const obj = napi.createObject(env);
    _ = napi.setNamedProperty(env, obj, "visualRow", napi.createU32(env, cursor.visual_row));
    _ = napi.setNamedProperty(env, obj, "visualCol", napi.createU32(env, cursor.visual_col));
    _ = napi.setNamedProperty(env, obj, "logicalRow", napi.createU32(env, cursor.logical_row));
    _ = napi.setNamedProperty(env, obj, "logicalCol", napi.createU32(env, cursor.logical_col));
    _ = napi.setNamedProperty(env, obj, "offset", napi.createU32(env, cursor.offset));
    return obj;
}

pub fn jsEditorViewSetPlaceholderStyledText(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [3]napi.napi_value = .{ null, null, null };
    if (!requireArgs(env, info, &args, 3, "editorViewSetPlaceholderStyledText(view, chunksPtr, chunkCount)")) return null;
    const view = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    var chunksPtr_raw: ?*anyopaque = null;
    if (!napi.check(env, c.napi_get_value_external(env, args[1], &chunksPtr_raw))) return null;
    const chunkCount_f = napi.getF64(env, args[2]) orelse return null;
    const chunkCount: usize = @intFromFloat(chunkCount_f);
    editorViewSetPlaceholderStyledText(view, @ptrCast(@alignCast(chunksPtr_raw)), chunkCount);
    return napi.getUndefined(env);
}

pub fn jsEditorViewSetTabIndicator(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "editorViewSetTabIndicator(view, indicator)")) return null;
    const view = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    const indicator = napi.getU32(env, args[1]) orelse return null;
    editorViewSetTabIndicator(view, indicator);
    return napi.getUndefined(env);
}

pub fn jsEditorViewSetTabIndicatorColor(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [5]napi.napi_value = .{ null, null, null, null, null };
    if (!requireArgs(env, info, &args, 5, "editorViewSetTabIndicatorColor(view, color_r, color_g, color_b, color_a)")) return null;
    const view = napi.unwrapPointer(env, args[0], EditorView) orelse return null;
    const color = readColor(env, &args, 1) orelse return null;
    editorViewSetTabIndicatorColor(view, &color);
    return napi.getUndefined(env);
}

// -- SyntaxStyle --

pub fn jsCreateSyntaxStyle(env: napi.napi_env, _: napi.napi_callback_info) callconv(.c) napi.napi_value {
    const ptr = createSyntaxStyle();
    if (ptr) |p| return napi.wrapPointer(env, p);
    return napi.getNull(env);
}

pub fn jsDestroySyntaxStyle(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "destroySyntaxStyle(style)")) return null;
    const style = napi.unwrapPointer(env, args[0], SyntaxStyle) orelse return null;
    destroySyntaxStyle(style);
    return napi.getUndefined(env);
}

pub fn jsSyntaxStyleRegister(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [11]napi.napi_value = .{ null, null, null, null, null, null, null, null, null, null, null };
    if (!requireArgs(env, info, &args, 11, "syntaxStyleRegister(style, name, fg_r, fg_g, fg_b, fg_a, bg_r, bg_g, bg_b, bg_a, attributes)")) return null;
    const style = napi.unwrapPointer(env, args[0], SyntaxStyle) orelse return null;
    var name_buf: [65536]u8 = undefined;
    const name = napi.getString(env, args[1], &name_buf) orelse return null;
    const fg_c = readOptColor(env, &args, 2);
    const bg_c = readOptColor(env, &args, 6);
    const attributes = napi.getU32(env, args[10]) orelse return null;
    return napi.createU32(env, syntaxStyleRegister(style, name.ptr, name.len, if (fg_c) |*p| p else null, if (bg_c) |*p| p else null, attributes));
}

pub fn jsSyntaxStyleResolveByName(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "syntaxStyleResolveByName(style, name)")) return null;
    const style = napi.unwrapPointer(env, args[0], SyntaxStyle) orelse return null;
    var name_buf: [65536]u8 = undefined;
    const name = napi.getString(env, args[1], &name_buf) orelse return null;
    return napi.createU32(env, syntaxStyleResolveByName(style, name.ptr, name.len));
}

pub fn jsSyntaxStyleGetStyleCount(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "syntaxStyleGetStyleCount(style)")) return null;
    const style = napi.unwrapPointer(env, args[0], SyntaxStyle) orelse return null;
    return napi.createF64(env, @floatFromInt(syntaxStyleGetStyleCount(style)));
}

// -- Unicode --

pub fn jsEncodeUnicode(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "encodeUnicode(text, widthMethod)")) return null;
    var text_buf: [65536]u8 = undefined;
    const text = napi.getString(env, args[0], &text_buf) orelse return null;
    const wm_u = napi.getU32(env, args[1]) orelse return null;
    var out_ptr: ?*anyopaque = null;
    var out_len: usize = 0;
    const ok = encodeUnicode(text.ptr, text.len, @ptrCast(&out_ptr), &out_len, @intCast(wm_u));
    if (!ok) return napi.getNull(env);
    if (out_ptr) |p| return napi.wrapPointer(env, p);
    return napi.getNull(env);
}

pub fn jsFreeUnicode(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "freeUnicode(charsPtr, charsLen)")) return null;
    var charsPtr_raw: ?*anyopaque = null;
    if (!napi.check(env, c.napi_get_value_external(env, args[0], &charsPtr_raw))) return null;
    const charsLen_f = napi.getF64(env, args[1]) orelse return null;
    const charsLen: usize = @intFromFloat(charsLen_f);
    freeUnicode(@ptrCast(@alignCast(charsPtr_raw)), charsLen);
    return napi.getUndefined(env);
}

// -- NativeSpanFeed --

pub fn jsCreateNativeSpanFeed(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "createNativeSpanFeed(options_ptr)")) return null;
    var options_ptr_raw: ?*anyopaque = null;
    _ = c.napi_get_value_external(env, args[0], &options_ptr_raw);
    const ptr = createNativeSpanFeed(@ptrCast(@alignCast(options_ptr_raw)));
    if (ptr) |p| return napi.wrapPointer(env, p);
    return napi.getNull(env);
}

pub fn jsDestroyNativeSpanFeed(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "destroyNativeSpanFeed(stream)")) return null;
    const stream_ptr = napi.unwrapPointer(env, args[0], NativeSpanFeedStream);
    destroyNativeSpanFeed(stream_ptr);
    return napi.getUndefined(env);
}

pub fn jsAttachNativeSpanFeed(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "attachNativeSpanFeed(stream)")) return null;
    const stream_ptr = napi.unwrapPointer(env, args[0], NativeSpanFeedStream);
    return napi.createI32(env, attachNativeSpanFeed(stream_ptr));
}

pub fn jsStreamClose(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "streamClose(stream)")) return null;
    const stream_ptr = napi.unwrapPointer(env, args[0], NativeSpanFeedStream);
    return napi.createI32(env, streamClose(stream_ptr));
}

pub fn jsStreamWrite(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "streamWrite(stream, data)")) return null;
    const stream_ptr = napi.unwrapPointer(env, args[0], NativeSpanFeedStream);
    var data_buf: [65536]u8 = undefined;
    const data = napi.getString(env, args[1], &data_buf) orelse return null;
    return napi.createI32(env, streamWrite(stream_ptr, @ptrCast(data.ptr), data.len));
}

pub fn jsStreamCommit(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{ null };
    if (!requireArgs(env, info, &args, 1, "streamCommit(stream)")) return null;
    const stream_ptr = napi.unwrapPointer(env, args[0], NativeSpanFeedStream);
    return napi.createI32(env, streamCommit(stream_ptr));
}

pub fn jsStreamReserve(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "streamReserve(stream, minLen)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], NativeSpanFeedStream);
    const min_len = napi.getU32(env, args[1]) orelse return null;
    const ReserveInfo = extern struct { ptr: ?*anyopaque, len: u32 };
    var ri: ReserveInfo = undefined;
    const status = streamReserve(ptr, min_len, @ptrCast(&ri));
    if (status != 0) return napi.createI32(env, status);
    const obj = napi.createObject(env);
    if (ri.ptr) |p| { _ = napi.setNamedProperty(env, obj, "ptr", napi.wrapPointer(env, p)); }
    _ = napi.setNamedProperty(env, obj, "len", napi.createU32(env, ri.len));
    return obj;
}

pub fn jsStreamCommitReserved(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "streamCommitReserved(stream, len)")) return null;
    const stream_ptr = napi.unwrapPointer(env, args[0], NativeSpanFeedStream);
    const len = napi.getU32(env, args[1]) orelse return null;
    return napi.createI32(env, streamCommitReserved(stream_ptr, len));
}

pub fn jsStreamSetOptions(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "streamSetOptions(stream, options_ptr)")) return null;
    const stream_ptr = napi.unwrapPointer(env, args[0], NativeSpanFeedStream);
    var options_ptr_raw: ?*anyopaque = null;
    if (!napi.check(env, c.napi_get_value_external(env, args[1], &options_ptr_raw))) return null;
    return napi.createI32(env, streamSetOptions(stream_ptr, @ptrCast(@alignCast(options_ptr_raw))));
}

pub fn jsStreamGetStats(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [1]napi.napi_value = .{null};
    if (!requireArgs(env, info, &args, 1, "streamGetStats(stream)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], NativeSpanFeedStream);
    const Stats = extern struct { total_bytes_written: u64, total_spans_emitted: u64, total_commits: u64, chunks_allocated: u32, chunks_in_use: u32, current_chunk_used: u32, pending_span_bytes: u32, attached: bool };
    var stats: Stats = undefined;
    const status = streamGetStats(ptr, @ptrCast(&stats));
    if (status != 0) return napi.getNull(env);
    const obj = napi.createObject(env);
    _ = napi.setNamedProperty(env, obj, "totalBytesWritten", napi.createF64(env, @floatFromInt(stats.total_bytes_written)));
    _ = napi.setNamedProperty(env, obj, "totalSpansEmitted", napi.createF64(env, @floatFromInt(stats.total_spans_emitted)));
    _ = napi.setNamedProperty(env, obj, "totalCommits", napi.createF64(env, @floatFromInt(stats.total_commits)));
    _ = napi.setNamedProperty(env, obj, "chunksAllocated", napi.createU32(env, stats.chunks_allocated));
    _ = napi.setNamedProperty(env, obj, "chunksInUse", napi.createU32(env, stats.chunks_in_use));
    _ = napi.setNamedProperty(env, obj, "currentChunkUsed", napi.createU32(env, stats.current_chunk_used));
    _ = napi.setNamedProperty(env, obj, "pendingSpanBytes", napi.createU32(env, stats.pending_span_bytes));
    _ = napi.setNamedProperty(env, obj, "attached", napi.createBool(env, stats.attached));
    return obj;
}

pub fn jsStreamDrainSpans(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [3]napi.napi_value = .{ null, null, null };
    if (!requireArgs(env, info, &args, 3, "streamDrainSpans(stream, out_ptr, max_spans)")) return null;
    const stream_ptr = napi.unwrapPointer(env, args[0], NativeSpanFeedStream);
    var out_ptr_raw: ?*anyopaque = null;
    if (!napi.check(env, c.napi_get_value_external(env, args[1], &out_ptr_raw))) return null;
    const max_spans = napi.getU32(env, args[2]) orelse return null;
    return napi.createU32(env, streamDrainSpans(stream_ptr, @ptrCast(@alignCast(out_ptr_raw)), max_spans));
}

pub fn jsStreamSetCallback(env: napi.napi_env, info: napi.napi_callback_info) callconv(.c) napi.napi_value {
    var args: [2]napi.napi_value = .{ null, null };
    if (!requireArgs(env, info, &args, 2, "streamSetCallback(stream, callback)")) return null;
    const ptr = napi.unwrapPointer(env, args[0], NativeSpanFeedStream);
    // TODO: Implement napi_create_threadsafe_function for stream callback
    _ = args[1];
    streamSetCallback(ptr, null);
    return napi.getUndefined(env);
}

// ── Property descriptor table ──────────────────────────────────────

pub const properties = [_]napi.napi_property_descriptor{
    // System
    napi.method("getArenaAllocatedBytes", jsGetArenaAllocatedBytes),
    napi.method("getBuildOptions", jsGetBuildOptions),
    napi.method("getAllocatorStats", jsGetAllocatorStats),
    // Callback
    napi.method("setLogCallback", jsSetLogCallback),
    napi.method("setEventCallback", jsSetEventCallback),
    // Renderer
    napi.method("createRenderer", jsCreateRenderer),
    napi.method("destroyRenderer", jsDestroyRenderer),
    napi.method("render", jsRender),
    napi.method("getNextBuffer", jsGetNextBuffer),
    napi.method("getCurrentBuffer", jsGetCurrentBuffer),
    napi.method("setBackgroundColor", jsSetBackgroundColor),
    napi.method("setRenderOffset", jsSetRenderOffset),
    napi.method("setUseThread", jsSetUseThread),
    napi.method("setDebugOverlay", jsSetDebugOverlay),
    napi.method("clearTerminal", jsClearTerminal),
    napi.method("setCursorPosition", jsSetCursorPosition),
    napi.method("setTerminalEnvVar", jsSetTerminalEnvVar),
    napi.method("updateStats", jsUpdateStats),
    napi.method("updateMemoryStats", jsUpdateMemoryStats),
    napi.method("getLastOutputForTest", jsGetLastOutputForTest),
    napi.method("setHyperlinksCapability", jsSetHyperlinksCapability),
    napi.method("resizeRenderer", jsResizeRenderer),
    napi.method("getTerminalCapabilities", jsGetTerminalCapabilities),
    napi.method("processCapabilityResponse", jsProcessCapabilityResponse),
    napi.method("setCursorColor", jsSetCursorColor),
    napi.method("setCursorStyleOptions", jsSetCursorStyleOptions),
    napi.method("getCursorState", jsGetCursorState),
    napi.method("setTerminalTitle", jsSetTerminalTitle),
    napi.method("copyToClipboardOSC52", jsCopyToClipboardOSC52),
    napi.method("clearClipboardOSC52", jsClearClipboardOSC52),
    napi.method("dumpBuffers", jsDumpBuffers),
    napi.method("dumpStdoutBuffer", jsDumpStdoutBuffer),
    napi.method("dumpHitGrid", jsDumpHitGrid),
    napi.method("restoreTerminalModes", jsRestoreTerminalModes),
    napi.method("enableMouse", jsEnableMouse),
    napi.method("disableMouse", jsDisableMouse),
    napi.method("queryPixelResolution", jsQueryPixelResolution),
    napi.method("enableKittyKeyboard", jsEnableKittyKeyboard),
    napi.method("disableKittyKeyboard", jsDisableKittyKeyboard),
    napi.method("setKittyKeyboardFlags", jsSetKittyKeyboardFlags),
    napi.method("getKittyKeyboardFlags", jsGetKittyKeyboardFlags),
    napi.method("setupTerminal", jsSetupTerminal),
    napi.method("suspendRenderer", jsSuspendRenderer),
    napi.method("resumeRenderer", jsResumeRenderer),
    napi.method("writeOut", jsWriteOut),
    // Buffer
    napi.method("createOptimizedBuffer", jsCreateOptimizedBuffer),
    napi.method("destroyOptimizedBuffer", jsDestroyOptimizedBuffer),
    napi.method("destroyFrameBuffer", jsDestroyFrameBuffer),
    napi.method("drawFrameBuffer", jsDrawFrameBuffer),
    napi.method("getBufferWidth", jsGetBufferWidth),
    napi.method("getBufferHeight", jsGetBufferHeight),
    napi.method("bufferClear", jsBufferClear),
    napi.method("bufferResize", jsBufferResize),
    napi.method("bufferFillRect", jsBufferFillRect),
    napi.method("bufferGetCharPtr", jsBufferGetCharPtr),
    napi.method("bufferGetFgPtr", jsBufferGetFgPtr),
    napi.method("bufferGetBgPtr", jsBufferGetBgPtr),
    napi.method("bufferGetAttributesPtr", jsBufferGetAttributesPtr),
    napi.method("bufferGetRespectAlpha", jsBufferGetRespectAlpha),
    napi.method("bufferSetRespectAlpha", jsBufferSetRespectAlpha),
    napi.method("bufferGetId", jsBufferGetId),
    napi.method("bufferGetRealCharSize", jsBufferGetRealCharSize),
    napi.method("bufferWriteResolvedChars", jsBufferWriteResolvedChars),
    napi.method("bufferDrawText", jsBufferDrawText),
    napi.method("bufferSetCellWithAlphaBlending", jsBufferSetCellWithAlphaBlending),
    napi.method("bufferSetCell", jsBufferSetCell),
    napi.method("bufferColorMatrix", jsBufferColorMatrix),
    napi.method("bufferColorMatrixUniform", jsBufferColorMatrixUniform),
    napi.method("bufferDrawPackedBuffer", jsBufferDrawPackedBuffer),
    napi.method("bufferDrawGrayscaleBuffer", jsBufferDrawGrayscaleBuffer),
    napi.method("bufferDrawGrayscaleBufferSupersampled", jsBufferDrawGrayscaleBufferSupersampled),
    napi.method("bufferPushScissorRect", jsBufferPushScissorRect),
    napi.method("bufferPopScissorRect", jsBufferPopScissorRect),
    napi.method("bufferClearScissorRects", jsBufferClearScissorRects),
    napi.method("bufferPushOpacity", jsBufferPushOpacity),
    napi.method("bufferPopOpacity", jsBufferPopOpacity),
    napi.method("bufferGetCurrentOpacity", jsBufferGetCurrentOpacity),
    napi.method("bufferClearOpacity", jsBufferClearOpacity),
    napi.method("bufferDrawSuperSampleBuffer", jsBufferDrawSuperSampleBuffer),
    napi.method("bufferDrawGrid", jsBufferDrawGrid),
    napi.method("bufferDrawBox", jsBufferDrawBox),
    napi.method("bufferDrawEditorView", jsBufferDrawEditorView),
    napi.method("bufferDrawTextBufferView", jsBufferDrawTextBufferView),
    napi.method("bufferDrawChar", jsBufferDrawChar),
    // Link
    napi.method("clearGlobalLinkPool", jsClearGlobalLinkPool),
    napi.method("linkAlloc", jsLinkAlloc),
    napi.method("linkGetUrl", jsLinkGetUrl),
    napi.method("attributesWithLink", jsAttributesWithLink),
    napi.method("attributesGetLinkId", jsAttributesGetLinkId),
    // HitGrid
    napi.method("addToHitGrid", jsAddToHitGrid),
    napi.method("clearCurrentHitGrid", jsClearCurrentHitGrid),
    napi.method("hitGridPushScissorRect", jsHitGridPushScissorRect),
    napi.method("hitGridPopScissorRect", jsHitGridPopScissorRect),
    napi.method("hitGridClearScissorRects", jsHitGridClearScissorRects),
    napi.method("addToCurrentHitGridClipped", jsAddToCurrentHitGridClipped),
    napi.method("checkHit", jsCheckHit),
    napi.method("getHitGridDirty", jsGetHitGridDirty),
    // TextBuffer
    napi.method("createTextBuffer", jsCreateTextBuffer),
    napi.method("destroyTextBuffer", jsDestroyTextBuffer),
    napi.method("textBufferGetLength", jsTextBufferGetLength),
    napi.method("textBufferGetByteSize", jsTextBufferGetByteSize),
    napi.method("textBufferReset", jsTextBufferReset),
    napi.method("textBufferClear", jsTextBufferClear),
    napi.method("textBufferSetDefaultFg", jsTextBufferSetDefaultFg),
    napi.method("textBufferSetDefaultBg", jsTextBufferSetDefaultBg),
    napi.method("textBufferSetDefaultAttributes", jsTextBufferSetDefaultAttributes),
    napi.method("textBufferResetDefaults", jsTextBufferResetDefaults),
    napi.method("textBufferGetTabWidth", jsTextBufferGetTabWidth),
    napi.method("textBufferSetTabWidth", jsTextBufferSetTabWidth),
    napi.method("textBufferRegisterMemBuffer", jsTextBufferRegisterMemBuffer),
    napi.method("textBufferReplaceMemBuffer", jsTextBufferReplaceMemBuffer),
    napi.method("textBufferClearMemRegistry", jsTextBufferClearMemRegistry),
    napi.method("textBufferSetTextFromMem", jsTextBufferSetTextFromMem),
    napi.method("textBufferAppend", jsTextBufferAppend),
    napi.method("textBufferAppendFromMemId", jsTextBufferAppendFromMemId),
    napi.method("textBufferLoadFile", jsTextBufferLoadFile),
    napi.method("textBufferSetStyledText", jsTextBufferSetStyledText),
    napi.method("textBufferGetLineCount", jsTextBufferGetLineCount),
    napi.method("textBufferGetPlainText", jsTextBufferGetPlainText),
    napi.method("textBufferAddHighlight", jsTextBufferAddHighlight),
    napi.method("textBufferAddHighlightByCharRange", jsTextBufferAddHighlightByCharRange),
    napi.method("textBufferRemoveHighlightsByRef", jsTextBufferRemoveHighlightsByRef),
    napi.method("textBufferClearLineHighlights", jsTextBufferClearLineHighlights),
    napi.method("textBufferClearAllHighlights", jsTextBufferClearAllHighlights),
    napi.method("textBufferSetSyntaxStyle", jsTextBufferSetSyntaxStyle),
    napi.method("textBufferGetLineHighlightsPtr", jsTextBufferGetLineHighlightsPtr),
    napi.method("textBufferFreeLineHighlights", jsTextBufferFreeLineHighlights),
    napi.method("textBufferGetHighlightCount", jsTextBufferGetHighlightCount),
    napi.method("textBufferGetTextRange", jsTextBufferGetTextRange),
    napi.method("textBufferGetTextRangeByCoords", jsTextBufferGetTextRangeByCoords),
    // TextBufferView
    napi.method("createTextBufferView", jsCreateTextBufferView),
    napi.method("destroyTextBufferView", jsDestroyTextBufferView),
    napi.method("textBufferViewSetSelection", jsTextBufferViewSetSelection),
    napi.method("textBufferViewResetSelection", jsTextBufferViewResetSelection),
    napi.method("textBufferViewGetSelectionInfo", jsTextBufferViewGetSelectionInfo),
    napi.method("textBufferViewSetLocalSelection", jsTextBufferViewSetLocalSelection),
    napi.method("textBufferViewUpdateSelection", jsTextBufferViewUpdateSelection),
    napi.method("textBufferViewUpdateLocalSelection", jsTextBufferViewUpdateLocalSelection),
    napi.method("textBufferViewResetLocalSelection", jsTextBufferViewResetLocalSelection),
    napi.method("textBufferViewSetWrapWidth", jsTextBufferViewSetWrapWidth),
    napi.method("textBufferViewSetWrapMode", jsTextBufferViewSetWrapMode),
    napi.method("textBufferViewSetViewportSize", jsTextBufferViewSetViewportSize),
    napi.method("textBufferViewSetViewport", jsTextBufferViewSetViewport),
    napi.method("textBufferViewGetVirtualLineCount", jsTextBufferViewGetVirtualLineCount),
    napi.method("textBufferViewGetLineInfoDirect", jsTextBufferViewGetLineInfoDirect),
    napi.method("textBufferViewGetLogicalLineInfoDirect", jsTextBufferViewGetLogicalLineInfoDirect),
    napi.method("textBufferViewGetSelectedText", jsTextBufferViewGetSelectedText),
    napi.method("textBufferViewGetPlainText", jsTextBufferViewGetPlainText),
    napi.method("textBufferViewSetTabIndicator", jsTextBufferViewSetTabIndicator),
    napi.method("textBufferViewSetTabIndicatorColor", jsTextBufferViewSetTabIndicatorColor),
    napi.method("textBufferViewSetTruncate", jsTextBufferViewSetTruncate),
    napi.method("textBufferViewMeasureForDimensions", jsTextBufferViewMeasureForDimensions),
    // EditBuffer
    napi.method("createEditBuffer", jsCreateEditBuffer),
    napi.method("destroyEditBuffer", jsDestroyEditBuffer),
    napi.method("editBufferGetTextBuffer", jsEditBufferGetTextBuffer),
    napi.method("editBufferInsertText", jsEditBufferInsertText),
    napi.method("editBufferDeleteRange", jsEditBufferDeleteRange),
    napi.method("editBufferDeleteCharBackward", jsEditBufferDeleteCharBackward),
    napi.method("editBufferDeleteChar", jsEditBufferDeleteChar),
    napi.method("editBufferMoveCursorLeft", jsEditBufferMoveCursorLeft),
    napi.method("editBufferMoveCursorRight", jsEditBufferMoveCursorRight),
    napi.method("editBufferMoveCursorUp", jsEditBufferMoveCursorUp),
    napi.method("editBufferMoveCursorDown", jsEditBufferMoveCursorDown),
    napi.method("editBufferGetCursor", jsEditBufferGetCursor),
    napi.method("editBufferSetCursor", jsEditBufferSetCursor),
    napi.method("editBufferSetCursorToLineCol", jsEditBufferSetCursorToLineCol),
    napi.method("editBufferSetCursorByOffset", jsEditBufferSetCursorByOffset),
    napi.method("editBufferGetNextWordBoundary", jsEditBufferGetNextWordBoundary),
    napi.method("editBufferGetPrevWordBoundary", jsEditBufferGetPrevWordBoundary),
    napi.method("editBufferGetEOL", jsEditBufferGetEOL),
    napi.method("editBufferOffsetToPosition", jsEditBufferOffsetToPosition),
    napi.method("editBufferPositionToOffset", jsEditBufferPositionToOffset),
    napi.method("editBufferGetLineStartOffset", jsEditBufferGetLineStartOffset),
    napi.method("editBufferGetTextRange", jsEditBufferGetTextRange),
    napi.method("editBufferGetTextRangeByCoords", jsEditBufferGetTextRangeByCoords),
    napi.method("editBufferSetText", jsEditBufferSetText),
    napi.method("editBufferSetTextFromMem", jsEditBufferSetTextFromMem),
    napi.method("editBufferReplaceText", jsEditBufferReplaceText),
    napi.method("editBufferReplaceTextFromMem", jsEditBufferReplaceTextFromMem),
    napi.method("editBufferGetText", jsEditBufferGetText),
    napi.method("editBufferInsertChar", jsEditBufferInsertChar),
    napi.method("editBufferNewLine", jsEditBufferNewLine),
    napi.method("editBufferDeleteLine", jsEditBufferDeleteLine),
    napi.method("editBufferGotoLine", jsEditBufferGotoLine),
    napi.method("editBufferGetCursorPosition", jsEditBufferGetCursorPosition),
    napi.method("editBufferGetId", jsEditBufferGetId),
    napi.method("editBufferDebugLogRope", jsEditBufferDebugLogRope),
    napi.method("editBufferUndo", jsEditBufferUndo),
    napi.method("editBufferRedo", jsEditBufferRedo),
    napi.method("editBufferCanUndo", jsEditBufferCanUndo),
    napi.method("editBufferCanRedo", jsEditBufferCanRedo),
    napi.method("editBufferClearHistory", jsEditBufferClearHistory),
    napi.method("editBufferClear", jsEditBufferClear),
    // EditorView
    napi.method("createEditorView", jsCreateEditorView),
    napi.method("destroyEditorView", jsDestroyEditorView),
    napi.method("editorViewSetViewport", jsEditorViewSetViewport),
    napi.method("editorViewClearViewport", jsEditorViewClearViewport),
    napi.method("editorViewGetViewport", jsEditorViewGetViewport),
    napi.method("editorViewSetScrollMargin", jsEditorViewSetScrollMargin),
    napi.method("editorViewGetVirtualLineCount", jsEditorViewGetVirtualLineCount),
    napi.method("editorViewGetTotalVirtualLineCount", jsEditorViewGetTotalVirtualLineCount),
    napi.method("editorViewGetLineInfoDirect", jsEditorViewGetLineInfoDirect),
    napi.method("editorViewGetTextBufferView", jsEditorViewGetTextBufferView),
    napi.method("editorViewGetLogicalLineInfoDirect", jsEditorViewGetLogicalLineInfoDirect),
    napi.method("editorViewSetViewportSize", jsEditorViewSetViewportSize),
    napi.method("editorViewSetWrapMode", jsEditorViewSetWrapMode),
    napi.method("editorViewSetSelection", jsEditorViewSetSelection),
    napi.method("editorViewResetSelection", jsEditorViewResetSelection),
    napi.method("editorViewGetSelection", jsEditorViewGetSelection),
    napi.method("editorViewSetLocalSelection", jsEditorViewSetLocalSelection),
    napi.method("editorViewUpdateSelection", jsEditorViewUpdateSelection),
    napi.method("editorViewUpdateLocalSelection", jsEditorViewUpdateLocalSelection),
    napi.method("editorViewResetLocalSelection", jsEditorViewResetLocalSelection),
    napi.method("editorViewGetSelectedTextBytes", jsEditorViewGetSelectedTextBytes),
    napi.method("editorViewGetCursor", jsEditorViewGetCursor),
    napi.method("editorViewGetText", jsEditorViewGetText),
    napi.method("editorViewGetVisualCursor", jsEditorViewGetVisualCursor),
    napi.method("editorViewMoveUpVisual", jsEditorViewMoveUpVisual),
    napi.method("editorViewMoveDownVisual", jsEditorViewMoveDownVisual),
    napi.method("editorViewDeleteSelectedText", jsEditorViewDeleteSelectedText),
    napi.method("editorViewSetCursorByOffset", jsEditorViewSetCursorByOffset),
    napi.method("editorViewGetNextWordBoundary", jsEditorViewGetNextWordBoundary),
    napi.method("editorViewGetPrevWordBoundary", jsEditorViewGetPrevWordBoundary),
    napi.method("editorViewGetEOL", jsEditorViewGetEOL),
    napi.method("editorViewGetVisualSOL", jsEditorViewGetVisualSOL),
    napi.method("editorViewGetVisualEOL", jsEditorViewGetVisualEOL),
    napi.method("editorViewSetPlaceholderStyledText", jsEditorViewSetPlaceholderStyledText),
    napi.method("editorViewSetTabIndicator", jsEditorViewSetTabIndicator),
    napi.method("editorViewSetTabIndicatorColor", jsEditorViewSetTabIndicatorColor),
    // SyntaxStyle
    napi.method("createSyntaxStyle", jsCreateSyntaxStyle),
    napi.method("destroySyntaxStyle", jsDestroySyntaxStyle),
    napi.method("syntaxStyleRegister", jsSyntaxStyleRegister),
    napi.method("syntaxStyleResolveByName", jsSyntaxStyleResolveByName),
    napi.method("syntaxStyleGetStyleCount", jsSyntaxStyleGetStyleCount),
    // Unicode
    napi.method("encodeUnicode", jsEncodeUnicode),
    napi.method("freeUnicode", jsFreeUnicode),
    // NativeSpanFeed
    napi.method("createNativeSpanFeed", jsCreateNativeSpanFeed),
    napi.method("destroyNativeSpanFeed", jsDestroyNativeSpanFeed),
    napi.method("attachNativeSpanFeed", jsAttachNativeSpanFeed),
    napi.method("streamClose", jsStreamClose),
    napi.method("streamWrite", jsStreamWrite),
    napi.method("streamCommit", jsStreamCommit),
    napi.method("streamReserve", jsStreamReserve),
    napi.method("streamCommitReserved", jsStreamCommitReserved),
    napi.method("streamSetOptions", jsStreamSetOptions),
    napi.method("streamGetStats", jsStreamGetStats),
    napi.method("streamDrainSpans", jsStreamDrainSpans),
    napi.method("streamSetCallback", jsStreamSetCallback),
};
