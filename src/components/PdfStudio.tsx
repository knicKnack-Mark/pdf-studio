
"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  FilePlus2,
  FileText,
  Highlighter,
  MousePointer2,
  Pen,
  RotateCw,
  Search,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  downloadPdf,
  exportEditedPdf,
  type Markup,
} from "@/lib/pdf-editor";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

type TextItem = {
  str: string;
  width: number;
  height: number;
  transform: number[];
};

type TextHit = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  page: number;
};

type Tool = "select" | "text" | "draw" | "highlight";

export default function PdfStudio() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<any>(null);
  const originalRef = useRef<ArrayBuffer | null>(null);
  const drawingRef = useRef(false);

  const [filename, setFilename] = useState("Untitled.pdf");
  const [pageCount, setPageCount] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [tool, setTool] = useState<Tool>("select");
  const [marks, setMarks] = useState<Markup[]>([]);
  const [deletedPages, setDeletedPages] = useState<number[]>([]);
  const [rotations, setRotations] = useState<Record<number, number>>({});
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [textItems, setTextItems] = useState<TextHit[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [color, setColor] = useState("#19d3f3");
  const [fontSize, setFontSize] = useState(18);
  const [message, setMessage] = useState("");
  const [documentVersion, setDocumentVersion] = useState(0);
  const pageMarks = marks.filter((mark) => mark.page === page - 1);

  const renderPage = useCallback(async () => {
    const pdf = pdfRef.current;
    const canvas = canvasRef.current;
    if (!pdf || !canvas) return;

    try {
      const pdfPage = await pdf.getPage(page);
      const viewport = pdfPage.getViewport({ scale: zoom / 100 });
      const context = canvas.getContext("2d");
      if (!context) return;

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      setPageSize({ width: viewport.width, height: viewport.height });

      await pdfPage.render({
        canvasContext: context,
        viewport,
        transform: dpr === 1 ? undefined : [dpr, 0, 0, dpr, 0, 0],
      }).promise;

      const content = await pdfPage.getTextContent();
      const hits: TextHit[] = [];

      for (const raw of content.items) {
        if (!("str" in raw) || !raw.str.trim()) continue;
        const item = raw as TextItem;
        const tx = pdfjsLib.Util.transform(
          viewport.transform,
          item.transform
        );

        hits.push({
          text: item.str,
          x: (tx[4] / viewport.width) * 100,
          y: ((tx[5] - item.height * (zoom / 100)) / viewport.height) * 100,
          width: (item.width * (zoom / 100) / viewport.width) * 100,
          height: Math.max(
            1.5,
            (item.height * (zoom / 100) / viewport.height) * 100
          ),
          page: page - 1,
        });
      }

      setTextItems(hits);
    } catch {
      setError("Unable to render this page. Try another PDF.");
    }
  }, [page, zoom]);

  useEffect(() => {
    if (documentVersion > 0) {
      void renderPage();
    }
  }, [renderPage, documentVersion]);

  const openFile = async (file?: File) => {
    if (!file) return;

    setError("");
    setMessage("");

    if (file.type !== "application/pdf" &&
        !file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please select a PDF file.");
      return;
    }

    try {
      setBusy(true);
      const buffer = await file.arrayBuffer();
      const loading = pdfjsLib.getDocument({
        data: new Uint8Array(buffer.slice(0)),
      });
      const pdf = await loading.promise;

      pdfRef.current = pdf;
      originalRef.current = buffer;
      setDocumentVersion((version) => version + 1);
      setFilename(file.name);
      setPageCount(pdf.numPages);
      setPage(1);
      setZoom(100);
      setMarks([]);
      setDeletedPages([]);
      setRotations({});
      setSearch("");
      setMessage("PDF loaded locally.");
    } catch {
      setError("This PDF could not be opened. It may be damaged or encrypted.");
    } finally {
      setBusy(false);
    }
  };

  const addText = (x: number, y: number) => {
    const value = window.prompt("Enter the text to add:");
    if (!value?.trim()) return;

    setMarks((previous) => [
      ...previous,
      {
        id: crypto.randomUUID(),
        type: "text",
        page: page - 1,
        x,
        y,
        text: value,
        color,
        fontSize,
      },
    ]);
  };

  const pointerPosition = (event: ReactPointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();

    return {
      x: Math.min(100, Math.max(0, ((event.clientX - bounds.left) / bounds.width) * 100)),
      y: Math.min(100, Math.max(0, ((event.clientY - bounds.top) / bounds.height) * 100)),
    };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (tool !== "draw" && tool !== "highlight") return;
    if (event.button !== 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    const point = pointerPosition(event);

    setMarks((previous) => [
      ...previous,
      {
        id: crypto.randomUUID(),
        type: tool,
        page: page - 1,
        points: [point],
        color,
      },
    ]);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drawingRef.current) return;
    const point = pointerPosition(event);

    setMarks((previous) => {
      const copy = [...previous];
      const last = copy[copy.length - 1];

      if (
        last &&
        (last.type === "draw" || last.type === "highlight") &&
        last.page === page - 1
      ) {
        copy[copy.length - 1] = {
          ...last,
          points: [...last.points, point],
        };
      }

      return copy;
    });
  };

  const onPointerUp = () => {
    drawingRef.current = false;
  };

  const handleStageClick = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (tool !== "text") return;
    const point = pointerPosition(event);
    addText(point.x, point.y);
    setTool("select");
  };

  const replaceText = (hit: TextHit) => {
    const replacement = window.prompt(
      `Replace this text overlay:\n\n${hit.text}`,
      hit.text
    );
    if (replacement === null || replacement === hit.text) return;

    setMarks((previous) => [
      ...previous,
      {
        id: crypto.randomUUID(),
        type: "cover",
        page: hit.page,
        x: hit.x,
        y: hit.y,
        width: Math.max(hit.width, 3),
        height: Math.max(hit.height, 2),
        replacement,
        color: "#111827",
        fontSize: Math.max(8, Math.min(fontSize, 14)),
      },
    ]);
    setMessage("Replacement added as an overlay. Review it before exporting.");
  };

  const rotatePage = () => {
    setRotations((previous) => ({
      ...previous,
      [page - 1]: ((previous[page - 1] ?? 0) + 90) % 360,
    }));
    setMessage("Page rotation queued for export.");
  };

  const deletePage = () => {
    if (pageCount - deletedPages.length <= 1) {
      setError("A PDF must retain at least one page.");
      return;
    }

    if (!window.confirm(`Delete page ${page}?`)) return;

    setDeletedPages((previous) => [...previous, page - 1]);
    setPageCount((previous) => previous - 1);
    setPage((previous) => Math.min(previous, pageCount - deletedPages.length - 1));
    setMessage("Page deletion queued for export.");
  };

  const undo = () => {
    setMarks((previous) => previous.slice(0, -1));
    setMessage("Last annotation removed.");
  };

  const exportFile = async () => {
    if (!originalRef.current) return;

    try {
      setBusy(true);
      setError("");
      const bytes = await exportEditedPdf(
        originalRef.current.slice(0),
        marks,
        deletedPages,
        rotations
      );
      downloadPdf(bytes, `edited-${filename}`);
      setMessage("Your edited PDF has been exported.");
    } catch {
      setError("Export failed. The PDF may use unsupported encryption.");
    } finally {
      setBusy(false);
    }
  };

  const filteredHits = textItems.filter((hit) =>
    hit.text.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <main className="studio">
      <header className="topbar">
        <button className="brand" onClick={() => fileInputRef.current?.click()}>
          <span className="brand-icon"><FileText size={20} /></span>
          <span>PDF<span className="brand-accent">STUDIO</span></span>
        </button>

        <div className="document-name">
          <span className="live-dot" />
          {filename}
        </div>

        <div className="top-actions">
          <button className="button secondary" onClick={() => fileInputRef.current?.click()}>
            <FilePlus2 size={16} /> Open PDF
          </button>
          <button className="button primary" onClick={() => void exportFile()} disabled={!pdfRef.current || busy}>
            <ArrowDownToLine size={16} /> {busy ? "Processing…" : "Export PDF"}
          </button>
        </div>

        <input
          ref={fileInputRef}
          hidden
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => {
            void openFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </header>

      <div className="toolbar">
        <div className="tool-group">
          <ToolButton label="Select" active={tool === "select"} onClick={() => setTool("select")}><MousePointer2 /></ToolButton>
          <ToolButton label="Add text" active={tool === "text"} onClick={() => setTool("text")}><Type /></ToolButton>
          <ToolButton label="Draw" active={tool === "draw"} onClick={() => setTool("draw")}><Pen /></ToolButton>
          <ToolButton label="Highlight" active={tool === "highlight"} onClick={() => setTool("highlight")}><Highlighter /></ToolButton>
        </div>

        <div className="toolbar-divider" />

        <label className="color-control" title="Annotation color">
          <span>Color</span>
          <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
        </label>

        <label className="size-control">
          <span>Size</span>
          <input
            type="number"
            min={8}
            max={72}
            value={fontSize}
            onChange={(event) => setFontSize(Math.max(8, Math.min(72, Number(event.target.value) || 18)))}
          />
        </label>

        <div className="toolbar-spacer" />

        <button className="icon-button" title="Undo annotation" onClick={undo} disabled={!marks.length}><Undo2 /></button>
        <button className="icon-button" title="Rotate page" onClick={rotatePage} disabled={!pdfRef.current}><RotateCw /></button>
        <button className="icon-button danger" title="Delete current page" onClick={deletePage} disabled={!pdfRef.current}><Trash2 /></button>
      </div>

      {(error || message) && (
        <div className={`notice ${error ? "error" : ""}`}>
          {error || message}
          <button onClick={() => { setError(""); setMessage(""); }}>Dismiss</button>
        </div>
      )}

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar-heading">
            <span>DOCUMENT</span>
            <span className="page-count">{pageCount} pages</span>
          </div>

          {!pdfRef.current ? (
            <button className="upload-card" onClick={() => fileInputRef.current?.click()}>
              <FilePlus2 size={30} />
              <strong>Open a PDF</strong>
              <span>Select a file from your device</span>
            </button>
          ) : (
            Array.from({ length: pageCount }, (_, index) => index + 1)
              .filter((number) => !deletedPages.includes(number - 1))
              .map((number) => (
                <button
                  key={number}
                  className={`page-thumb ${page === number ? "selected" : ""}`}
                  onClick={() => setPage(number)}
                >
                  <span className="thumb-paper">
                    <span className="fake-line wide" />
                    <span className="fake-line" />
                    <span className="fake-line short" />
                    <span className="fake-block" />
                    <span className="fake-line wide" />
                    <span className="fake-line" />
                  </span>
                  <span className="thumb-label">Page {number}</span>
                </button>
              ))
          )}

          <div className="privacy-note">
            <span className="privacy-dot" />
            Processed in your browser
          </div>
        </aside>

        <section className="canvas-area">
          <div className="canvas-toolbar">
            <span className="canvas-status">{pdfRef.current ? "DOCUMENT CANVAS" : "READY FOR DOCUMENT"}</span>
            <div className="zoom-controls">
              <button className="icon-button" onClick={() => setZoom((z) => Math.max(40, z - 10))}><ZoomOut /></button>
              <span>{zoom}%</span>
              <button className="icon-button" onClick={() => setZoom((z) => Math.min(200, z + 10))}><ZoomIn /></button>
            </div>
          </div>

          <div className="document-scroll">
            {!pdfRef.current ? (
              <button className="empty-state" onClick={() => fileInputRef.current?.click()}>
                <span className="empty-icon"><FilePlus2 size={36} /></span>
                <strong>Your workspace is ready</strong>
                <span>Drop a PDF here or browse your files to begin.</span>
                <span className="button primary">Choose PDF file</span>
              </button>
            ) : (
              <div
                ref={stageRef}
                className={`document-stage tool-${tool}`}
                style={{
                  width: pageSize.width || "auto",
                  height: pageSize.height || "auto",
                  transform: `rotate(${rotations[page - 1] ?? 0}deg)`,
                }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onClick={handleStageClick}
              >
                <canvas ref={canvasRef} className="pdf-canvas" />

                <svg className="drawing-layer" viewBox="0 0 100 100" preserveAspectRatio="none">
                  {pageMarks.map((mark) => {
                    if (mark.type !== "draw" && mark.type !== "highlight") return null;
                    if (mark.points.length === 1) {
                      const point = mark.points[0];
                      return <circle key={mark.id} cx={point.x} cy={point.y} r="0.2" fill={mark.color} />;
                    }

                    return (
                      <polyline
                        key={mark.id}
                        points={mark.points.map((point) => `${point.x},${point.y}`).join(" ")}
                        fill="none"
                        stroke={mark.color}
                        strokeWidth={mark.type === "highlight" ? 1.8 : 0.35}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={mark.type === "highlight" ? 0.4 : 1}
                        vectorEffect="non-scaling-stroke"
                      />
                    );
                  })}
                </svg>

                {pageMarks.map((mark) => {
                  if (mark.type === "text") {
                    return (
                      <div
                        key={mark.id}
                        className="text-mark"
                        style={{
                          left: `${mark.x}%`,
                          top: `${mark.y}%`,
                          color: mark.color,
                          fontSize: `${mark.fontSize * zoom / 100}px`,
                        }}
                      >
                        {mark.text}
                      </div>
                    );
                  }

                  if (mark.type === "cover") {
                    return (
                      <div
                        key={mark.id}
                        className="cover-mark"
                        style={{
                          left: `${mark.x}%`,
                          top: `${mark.y}%`,
                          width: `${mark.width}%`,
                          height: `${mark.height}%`,
                          color: mark.color,
                          fontSize: `${mark.fontSize * zoom / 100}px`,
                        }}
                      >
                        {mark.replacement}
                      </div>
                    );
                  }

                  return null;
                })}
              </div>
            )}
          </div>

          <footer className="page-footer">
            <span>{pdfRef.current ? "Page navigation" : "No document open"}</span>
            <div className="pagination">
              <button className="icon-button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}><ChevronLeft /></button>
              <span>{page} <span className="muted">/ {pageCount || 0}</span></span>
              <button className="icon-button" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={page >= pageCount}><ChevronRight /></button>
            </div>
          </footer>
        </section>

        <aside className="right-panel">
          <div className="panel-heading">
            <span>EDITING TOOLS</span>
          </div>

          <div className="panel-section">
            <h3>Text finder</h3>
            <p>Find selectable text on the current page.</p>
            <div className="search-input">
              <Search size={15} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search page text…" />
            </div>

            {search.trim() && (
              <div className="search-results">
                {filteredHits.length ? filteredHits.map((hit, index) => (
                  <button
                    key={`${hit.page}-${hit.x}-${index}`}
                    className="search-result"
                    onClick={() => {
                      setPage(hit.page + 1);
                      replaceText(hit);
                    }}
                  >
                    <span>{hit.text}</span>
                    <small>Replace overlay</small>
                  </button>
                )) : <p className="muted">No matching text on this page.</p>}
              </div>
            )}
          </div>

          <div className="panel-section">
            <h3>Quick actions</h3>
            <button className="action-row" onClick={() => { setTool("text"); setMessage("Click on the document to place text."); }}>
              <Type size={17} /><span>Add text</span><ChevronRight size={15} />
            </button>
            <button className="action-row" onClick={() => setTool("highlight")}>
              <Highlighter size={17} /><span>Highlight / mark</span><ChevronRight size={15} />
            </button>
            <button className="action-row" onClick={rotatePage}>
              <RotateCw size={17} /><span>Rotate page</span><ChevronRight size={15} />
            </button>
            <button className="action-row" onClick={undo} disabled={!marks.length}>
              <Undo2 size={17} /><span>Undo last annotation</span><ChevronRight size={15} />
            </button>
          </div>

          <div className="panel-section">
            <h3>Current document</h3>
            <div className="file-info">
              <FileText size={19} />
              <div>
                <strong>{filename}</strong>
                <span>{pageCount} pages · PDF document</span>
              </div>
            </div>
          </div>

          <div className="panel-tip">
            <strong>Note on text editing</strong>
            <p>Text replacement covers the original area with a white rectangle and places new text over it. It is not a true edit to the PDF's original text content.</p>
          </div>
        </aside>
      </div>
    </main>
  );
}

function ToolButton({
  children,
  label,
  active,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`tool-button ${active ? "active" : ""}`}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {children}
    </button>
  );
}
