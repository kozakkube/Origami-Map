import React, { useRef, useState, useEffect } from "react";

// TriangulatorApp — improved and bug-fixed single-file React component.
// Fixes: defensive checks in polygon clipping (avoid destructuring null/undefined),
// safer image handling, clear refs for maskPoly/canvas, and small UX helpers.

const CANVAS_FRACTION = 0.8;
const CANVAS_SIZE = Math.max(400, Math.floor(Math.min(window.innerWidth, window.innerHeight) * CANVAS_FRACTION));
const GRID_CELL = Math.floor(CANVAS_SIZE / 8);
const EXPORT_SIZE = 150;
const MIN_MASK_COVERAGE = 0.8;
const ORIGINAL_MASK_REF = 800;

const MASKS_ORIG = {
  1: [[100,300],[300,100],[500,100],[700,300],[500,500],[300,500]],
  2: [[200,200],[400,200],[500,300],[500,500],[400,600],[200,600]],
  3: [[200,400],[300,300],[600,300],[600,400],[400,600]],
  4: [[200,200],[400,200],[600,400],[400,600],[200,600]],
  5: [[200,200],[400,200],[500,300],[500,500],[400,600],[200,400]],
  6: [[200,200],[400,200],[600,400],[600,500],[300,500],[200,400]],
  7: [[200,400],[400,200],[500,300],[500,500],[300,500]],
  8: [[100,300],[300,100],[600,100],[600,400],[500,500],[300,500]],
};

const MASK_SEQUENCE_MAPPING = {
  1: [1], 2: [1,4], 3: [1,4,6], 4: [1,4,6,3], 5: [1,4,6,3,8], 6: [1,4,6,3,8,2], 7: [1,4,6,3,8,2,5], 8: [1,4,6,3,8,2,5,7]
};

function scaleMask(points, original = ORIGINAL_MASK_REF, newSize = CANVAS_SIZE) {
  const s = newSize / original;
  return points.map(([x,y]) => [Math.round(x * s), Math.round(y * s)]);
}

const MASKS = {};
for (const k of Object.keys(MASKS_ORIG)) MASKS[k] = scaleMask(MASKS_ORIG[k]);

// ---------------- geometry helpers (defensive) -----------------
function polygonArea(poly) {
  if (!Array.isArray(poly) || poly.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1 = 0, y1 = 0] = poly[i] || [];
    const [x2 = 0, y2 = 0] = poly[(i+1) % poly.length] || [];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) * 0.5;
}

// Defensive version of Sutherland–Hodgman clipping
function clipPolygon(subject, clip) {
  // Validate inputs
  if (!Array.isArray(subject) || subject.length === 0) return [];
  if (!Array.isArray(clip) || clip.length === 0) return [];

  // helper inside with checks
  const inside = (p, cp1, cp2) => {
    if (!Array.isArray(p) || p.length < 2) return false;
    if (!Array.isArray(cp1) || cp1.length < 2) return false;
    if (!Array.isArray(cp2) || cp2.length < 2) return false;
    const [x, y] = p;
    const [x1, y1] = cp1;
    const [x2, y2] = cp2;
    return (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1) >= -1e-9;
  };

  const intersect = (p1, p2, cp1, cp2) => {
    // If any point is invalid, return p2 as fallback
    if (!Array.isArray(p1) || p1.length < 2) return p2;
    if (!Array.isArray(p2) || p2.length < 2) return p2;
    if (!Array.isArray(cp1) || cp1.length < 2) return p2;
    if (!Array.isArray(cp2) || cp2.length < 2) return p2;
    const [x1, y1] = p1; const [x2, y2] = p2;
    const [x3, y3] = cp1; const [x4, y4] = cp2;
    const denom = (x1 - x2)*(y3 - y4) - (y1 - y2)*(x3 - x4);
    if (Math.abs(denom) < 1e-9) return p2;
    const px = ((x1*y2 - y1*x2)*(x3 - x4) - (x1 - x2)*(x3*y4 - y3*x4)) / denom;
    const py = ((x1*y2 - y1*x2)*(y3 - y4) - (y1 - y2)*(x3*y4 - y3*x4)) / denom;
    return [px, py];
  };

  let output = subject.slice();
  for (let i = 0; i < clip.length; i++) {
    const cp1 = clip[i];
    const cp2 = clip[(i + 1) % clip.length];
    const input = output.slice();
    output = [];
    if (!input.length) break;
    let s = input[input.length - 1];
    for (const e of input) {
      const eInside = inside(e, cp1, cp2);
      const sInside = inside(s, cp1, cp2);
      if (eInside) {
        if (!sInside) {
          output.push(intersect(s, e, cp1, cp2));
        }
        output.push(e);
      } else if (sInside) {
        output.push(intersect(s, e, cp1, cp2));
      }
      s = e;
    }
  }
  return output;
}

function triangleCoverage(tri, maskPoly) {
  const inter = clipPolygon(tri, maskPoly);
  if (!inter || inter.length === 0) return 0;
  const aTri = polygonArea(tri);
  if (aTri <= 0) return 0;
  const aInter = polygonArea(inter);
  return aInter / aTri;
}

function cwToPillowCCW(angleCW) {
  const m = ((angleCW % 360) + 360) % 360;
  if (m === 270) return 90;
  if (m === 90) return 270;
  return m;
}
function getRotationCW(r, c, triIndex) {
  if (r % 2 === 0) {
    if (c % 2 === 0) return [90, 270][triIndex];
    else return [0, 180][triIndex];
  } else {
    if (c % 2 === 0) return [0, 180][triIndex];
    else return [90, 270][triIndex];
  }
}

// Minimal mappings (user can paste full ones from their Python script)
const TRIANGLE_MAPPING_RED = [     [0, 0, "A", "816.png"], [0, 0, "B", "815.png"],
    [0, 1, "A", "807.png"], [0, 1, "B", "806.png"],
    [0, 2, "A", "414.png"], [0, 2, "B", "413.png"],
    [0, 3, "A", "415.png"],
    [0, 4, "B", "409.png"],
    [0, 5, "A", "407.png"], [0, 5, "B", "406.png"],
    [0, 6, "A", "702.png"], [0, 6, "B", "831.png"],
    [0, 7, "A", "825.png"], [0, 7, "B", "824.png"],
    [1, 0, "A", "216.png"],
    [1, 2, "A", "420.png"], [1, 2, "B", "217.png"],
    [1, 3, "A", "222.png"],
    [1, 4, "B", "106.png"],
    [1, 5, "A", "114.png"], [1, 5, "B", "402.png"],
    [1, 6, "A", "706.png"],
    [2, 0, "A", "422.png"], [2, 0, "B", "423.png"],
    [2, 1, "A", "421.png"],
    [2, 4, "A", "220.png"], [2, 4, "B", "221.png"],
    [2, 5, "A", "219.png"], [2, 5, "B", "218.png"],
    [2, 6, "A", "115.png"], [2, 6, "B", "401.png"],
    [2, 7, "A", "403.png"], [2, 7, "B", "404.png"],
    [3, 0, "A", "416.png"], [3, 0, "B", "709.png"],
    [3, 1, "A", "708.png"],
    [3, 2, "B", "302.png"],
    [3, 4, "A", "215.png"], [3, 4, "B", "214.png"],
    [3, 5, "A", "212.png"], [3, 5, "B", "213.png"],
    [3, 6, "A", "116.png"], [3, 6, "B", "707.png"],
    [3, 7, "B", "408.png"],
    [4,0,"A","813.png"], [4,0,"B","117.png"],
    [4,1,"A","118.png"], [4,1,"B","119.png"],
    [4,2,"A","121.png"], [4,2,"B","120.png"],
    [4,3,"A","122.png"], [4,3,"B","814.png"],
    [4,4,"A","822.png"], [4,4,"B","209.png"],
    [4,5,"A","207.png"], [4,5,"B","206.png"],
    [4,6,"A","712.png"], [4,6,"B","711.png"],
    [4,7,"B","823.png"],
    [5,0,"A","805.png"], [5,0,"B","804.png"],
    [5,1,"A","802.png"], [5,1,"B","127.png"],
    [5,2,"A","128.png"], [5,2,"B","803.png"],
    [5,3,"A","811.png"], [5,3,"B","812.png"],
    [5,4,"A","820.png"], [5,4,"B","821.png"],
    [5,5,"A","827.png"], [5,5,"B","202.png"],
    [5,6,"B","828.png"],
    [5,7,"A","830.png"], [5,7,"B","829.png"],
    [6,0,"B","518.png"],
    [6,1,"A","516.png"],
    [6,2,"A","129.png"], [6,2,"B","801.png"],
    [6,3,"A","809.png"], [6,3,"B","810.png"],
    [6,4,"A","818.png"], [6,4,"B","819.png"],
    [6,5,"A","826.png"], [6,5,"B","201.png"],
    [6,6,"B","510.png"],
    [6,7,"A","505.png"],
    [7,1,"A","515.png"],
    [7,2,"A","131.png"], [7,2,"B","130.png"],
    [7,3,"A","123.png"], [7,3,"B","808.png"],
    [7,4,"A","817.png"], [7,4,"B","208.png"],
    [7,5,"A","204.png"], [7,5,"B","203.png"],
    [7,6,"B","511.png"] ];
const TRIANGLE_MAPPING_GREEN = [     [0,0,"B","509.png"],
    [0,1,"A","507.png"], [0,1,"B","506.png"],
    [0,3,"B","303.png"],
    [0,4,"A","608.png"],
    [0,5,"B","512.png"],
    [0,6,"A","104.png"], [0,6,"B","105.png"],
    [0,7,"A","112.png"], [0,7,"B","113.png"],
    [1,1,"B","502.png"],
    [1,3,"B","301.png"],
    [1,4,"A","604.png"], [1,4,"B","603.png"],
    [1,5,"A","601.png"], [1,5,"B","513.png"],
    [1,6,"A","102.png"], [1,6,"B","103.png"],
    [1,7,"A","110.png"], [1,7,"B","111.png"],
    [2,1,"B","501.png"],
    [2,2,"A","611.png"], [2,2,"B","610.png"],
    [2,3,"A","605.png"], [2,3,"B","308.png"],
    [2,4,"B","701.png"],
    [2,5,"A","704.png"], [2,5,"B","514.png"],
    [2,6,"A","602.png"], [2,6,"B","101.png"],
    [2,7,"A","108.png"], [2,7,"B","109.png"],
    [3,0,"B","508.png"],
    [3,1,"A","504.png"], [3,1,"B","503.png"],
    [3,2,"A","612.png"], [3,2,"B","314.png"],
    [3,3,"A","310.png"], [3,3,"B","309.png"],
    [3,5,"B","517.png"],
    [3,6,"A","606.png"], [3,6,"B","607.png"],
    [3,7,"A","609.png"], [3,7,"B","107.png"],
    [4,5,"A","211.png"], [4,5,"B","613.png"],
    [4,6,"B","424.png"],
    [4,7,"A","418.png"], [4,7,"B","705.png"],
    [5,2,"A","619.png"], [5,2,"B","618.png"],
    [5,3,"A","616.png"], [5,3,"B","617.png"],
    [5,4,"A","615.png"], [5,4,"B","205.png"],
    [5,5,"A","210.png"], [5,5,"B","614.png"],
    [5,7,"B","703.png"],
    [6,0,"A","126.png"],
    [6,2,"A","312.png"], [6,2,"B","311.png"],
    [6,3,"A","313.png"], [6,3,"B","132.png"],
    [6,5,"A","306.png"], [6,5,"B","307.png"],
    [6,7,"B","412.png"],
    [7,0,"A","124.png"],
    [7,2,"A","315.png"], [7,2,"B","419.png"],
    [7,3,"A","417.png"], [7,3,"B","125.png"],
    [7,5,"A","304.png"], [7,5,"B","305.png"],
    [7,6,"A","710.png"], [7,6,"B","405.png"],
    [7,7,"A","410.png"], [7,7,"B","411.png"] ];
const OVERLAY_RED = [ 
    ["C", 2, 2],
    ["N", 52, 5],
    ["N", 55, 2],
    ["D", 98, 2],
    ["L", 5, 23],
    ["Z", 73, 20],
    ["E", 95, 23],
    ["W", 30, 27],
    ["ComR", 50, 50],
    ["Z", 73, 30],
    ["K", 5, 48],
    ["K", 5, 52],
    ["M", 95, 48],
    ["M", 95, 52],
    ["M", 98, 55],
    ["R", 80, 73],
    ["T", 27, 80],
    ["B", 2, 98],
    ["J", 23, 95],
    ["O", 48, 95],
    ["O", 52, 95],
    ["A", 98, 98] ];
const OVERLAY_GREEN = [ 
    ["D", 2, 2],
    ["N", 52, 5],
    ["C", 98, 2],
    ["Z", 20, 27],
    ["W", 70, 23],
    ["W", 77, 20],
    ["M", 5, 52],
    ["K", 98, 55],
    ["R", 30, 73],
    ["R", 30, 77],
    ["ComG", 50, 50],
    ["R", 23, 80],
    ["S", 55, 73],
    ["T", 70, 77],
    ["T", 73, 70],
    ["A", 2, 98],
    ["O", 52, 95],
    ["J", 77, 95],
    ["J", 80, 98],
    ["B", 98, 98] ];


// ---------------- React component -----------------
export default function TriangulatorApp() {
  const canvasRef = useRef(null);
  const maskPolyRef = useRef(MASKS[1]);
  const imgRef = useRef(null);
  const piecesRef = useRef({});

  const [maskSequence, setMaskSequence] = useState([1]);
  const [currentMaskIndex, setCurrentMaskIndex] = useState(0);
  const [maskId, setMaskId] = useState(1);
  const [offset, setOffset] = useState({x:0,y:0});
  const [scale, setScale] = useState(1.0);
  const [rotation, setRotation] = useState(0);
  const [dragStart, setDragStart] = useState(null);

  useEffect(() => {
    // ask user once for number of photos (simple prompt for prototype)
    const n = parseInt(prompt('How many photos? Type how many photos to be used (1–8):', '2') || '2');
    const seq = MASK_SEQUENCE_MAPPING[n] || MASK_SEQUENCE_MAPPING[1];
    setMaskSequence(seq);
    setCurrentMaskIndex(0);
    setMaskId(seq[0]);
    maskPolyRef.current = MASKS[seq[0]];
  }, []);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, scale, rotation]);

  function handleFile(e) {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => { imgRef.current = img; draw(); };
    img.onerror = () => { alert('Could not load image'); };
    img.src = url;
  }

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width,canvas.height);

    // draw base image transformed
    if (imgRef.current) {
      const img = imgRef.current;
      const w = img.width * scale;
      const h = img.height * scale;
      ctx.save();
      ctx.translate(canvas.width/2 + offset.x, canvas.height/2 + offset.y);
      ctx.rotate(-rotation * Math.PI/180);
      ctx.drawImage(img, -w/2, -h/2, w, h);
      ctx.restore();
    }

    // darken outside mask
    const maskPoly = maskPolyRef.current || [];
    if (maskPoly.length) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.beginPath();
      ctx.rect(0,0,canvas.width,canvas.height);
      ctx.moveTo(maskPoly[0][0], maskPoly[0][1]);
      for (let i=1;i<maskPoly.length;i++) ctx.lineTo(maskPoly[i][0], maskPoly[i][1]);
      ctx.closePath();
      // use evenodd rule to cut out mask area
      ctx.fill('evenodd');
      ctx.restore();

      // outline
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(maskPoly[0][0], maskPoly[0][1]);
      for (let i=1;i<maskPoly.length;i++) ctx.lineTo(maskPoly[i][0], maskPoly[i][1]);
      ctx.closePath(); ctx.stroke(); ctx.restore();
    }
  }

  function onMouseDown(e){ setDragStart({x:e.clientX, y:e.clientY}); }
  function onMouseMove(e){ if (!dragStart) return; const dx = e.clientX - dragStart.x; const dy = e.clientY - dragStart.y; setOffset(prev => ({x: prev.x + dx, y: prev.y + dy})); setDragStart({x: e.clientX, y: e.clientY}); }
  function onMouseUp(){ setDragStart(null); }
  function onWheel(e){ e.preventDefault(); const factor = 1 + e.deltaY * -0.001; setScale(prev => Math.max(0.1, Math.min(5.0, prev * factor))); }

  // cutting logic (uses defensive clipPolygon above)
  async function cutImageIntoTrianglesFromCanvas(baseCanvas, maskPoly, gridCell = GRID_CELL, exportSize = EXPORT_SIZE) {
    if (!baseCanvas) return [];
    const W = baseCanvas.width; const H = baseCanvas.height;
    const cols = Math.ceil(W / gridCell);
    const rows = Math.ceil(H / gridCell);
    const ctx = baseCanvas.getContext('2d');
    const outPieces = [];

    for (let r=0;r<rows;r++){
      for (let c=0;c<cols;c++){
        const x0 = c * gridCell; const y0 = r * gridCell;
        const x1 = Math.min((c+1)*gridCell, W); const y1 = Math.min((r+1)*gridCell, H);
        const x1_adj = x1 - 1; const y1_adj = y1 - 1;
        const flip = (r + c) % 2 === 1;
        const triA = !flip ? [[x0,y0],[x1_adj,y0],[x1_adj,y1_adj]] : [[x0,y0],[x1_adj-1,y0],[x0,y1_adj-1]];
        const triB = !flip ? [[x0,y0],[x1_adj,y1_adj],[x0,y1_adj]] : [[x1_adj-1,y0],[x1_adj,y1_adj],[x0,y1_adj-1]];
        const tris = [[0,triA],[1,triB]];
        for (const [triIndex, tri] of tris){
          const coverage = triangleCoverage(tri, maskPoly);
          if (coverage < MIN_MASK_COVERAGE) continue;
          const triMaskPoly = clipPolygon(tri, maskPoly);
          if (!triMaskPoly || triMaskPoly.length < 3) continue;
          const xs = triMaskPoly.map(p=>p[0]); const ys = triMaskPoly.map(p=>p[1]);
          const bx0 = Math.floor(Math.min(...xs)); const by0 = Math.floor(Math.min(...ys));
          const bx1 = Math.ceil(Math.max(...xs)); const by1 = Math.ceil(Math.max(...ys));
          const wLocal = Math.max(1, bx1 - bx0); const hLocal = Math.max(1, by1 - by0);

          // Create a temp canvas with the region of the base image
          const tempCanvas = document.createElement('canvas'); tempCanvas.width = wLocal; tempCanvas.height = hLocal;
          const tctx = tempCanvas.getContext('2d');

          // Draw the relevant region of the base canvas onto tempCanvas
          // (use source rectangle to copy exact pixels)
          tctx.clearRect(0,0,wLocal,hLocal);
          tctx.drawImage(baseCanvas, bx0, by0, wLocal, hLocal, 0, 0, wLocal, hLocal);

          // Create a mask canvas of the same size and draw the triangle polygon onto it
          // IMPORTANT: Do NOT fill the background — leave it transparent and draw only the polygon
          const maskCanvas = document.createElement('canvas'); maskCanvas.width = wLocal; maskCanvas.height = hLocal;
          const mctx = maskCanvas.getContext('2d');
          mctx.clearRect(0,0,wLocal,hLocal);
          mctx.beginPath();
          mctx.moveTo(triMaskPoly[0][0] - bx0, triMaskPoly[0][1] - by0);
          for (let i=1;i<triMaskPoly.length;i++) mctx.lineTo(triMaskPoly[i][0] - bx0, triMaskPoly[i][1] - by0);
          mctx.closePath();
          // fill polygon with opaque (alpha = 1). Color doesn't matter; alpha channel does.
          mctx.fillStyle = 'rgba(0,0,0,1)';
          mctx.fill();

          // Apply the mask: destination-in will keep only pixels where the mask canvas has alpha>0
          tctx.globalCompositeOperation = 'destination-in';
          tctx.drawImage(maskCanvas, 0, 0);
          tctx.globalCompositeOperation = 'source-over';

          // resize to export
          const outCanvas = document.createElement('canvas'); outCanvas.width = exportSize; outCanvas.height = exportSize;
          const outCtx = outCanvas.getContext('2d'); outCtx.clearRect(0,0,exportSize,exportSize);
          outCtx.drawImage(tempCanvas, 0, 0, exportSize, exportSize);

          // rotate according to rules
          const angleCW = getRotationCW(r, c, triIndex);
          const pillowAngle = cwToPillowCCW(angleCW);
          const rotCanvas = document.createElement('canvas'); rotCanvas.width = exportSize; rotCanvas.height = exportSize;
          const rotCtx = rotCanvas.getContext('2d');
          rotCtx.save(); rotCtx.translate(exportSize/2, exportSize/2); rotCtx.rotate(pillowAngle * Math.PI/180);
          rotCtx.drawImage(outCanvas, -exportSize/2, -exportSize/2);
          rotCtx.restore();

          outPieces.push(rotCanvas);
        }
      }
    }
    return outPieces;
  }

  async function onExportClick() {
    const canvas = canvasRef.current;
    if (!canvas) { alert('Canvas not ready'); return; }
    const maskPoly = maskPolyRef.current || [];
    const pieces = await cutImageIntoTrianglesFromCanvas(canvas, maskPoly);
    if (!pieces.length) { alert('No triangles produced (maybe mask coverage too small)'); return; }

    // simple preview sheet: arrange pieces into a single image and download
    const previewCols = Math.ceil(Math.sqrt(pieces.length));
    const previewSize = EXPORT_SIZE * previewCols;
    const previewCanvas = document.createElement('canvas'); previewCanvas.width = previewSize; previewCanvas.height = previewSize;
    const pctx = previewCanvas.getContext('2d'); pctx.fillStyle = 'white'; pctx.fillRect(0,0,previewSize,previewSize);
    let x = 0, y = 0;
    for (const p of pieces) {
      pctx.drawImage(p, x, y);
      x += EXPORT_SIZE; if (x >= previewSize) { x = 0; y += EXPORT_SIZE; }
    }
    previewCanvas.toBlob(blob => {
      if (!blob) return; const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'triangles_preview.png'; link.click(); URL.revokeObjectURL(link.href);
    });

    // store pieces for sheet generator if desired
    piecesRef.current = pieces;

    // advance mask index like original app
    const nextIndex = currentMaskIndex + 1;
    if (nextIndex < maskSequence.length) {
      const id = maskSequence[nextIndex]; setCurrentMaskIndex(nextIndex); setMaskId(id); maskPolyRef.current = MASKS[id]; imgRef.current = null; draw(); alert('Mask exported. Load next photo.');
    } else {
      alert('All masks processed. You can now generate sheets.');
    }
  }

  // Simplified sheet generator — uses piecesRef.current (if any) and mappings. Downloads RED & GREEN sheets.
  function generateSheets() {
    const SHEET_SIZE = 1200; const CELL_COUNT = 8; const CELL_SIZE = Math.floor(SHEET_SIZE / CELL_COUNT);
    const createSheet = (mapping, overlays, filename) => {
      const sheet = document.createElement('canvas'); sheet.width = SHEET_SIZE; sheet.height = SHEET_SIZE; const sctx = sheet.getContext('2d'); sctx.fillStyle = 'white'; sctx.fillRect(0,0,SHEET_SIZE,SHEET_SIZE);

      // helper to get image (from pieces or fallback to static filename)
      const getImg = (file) => {
        // if piecesRef contains file data (we stored canvases), find by index or name
        // For prototype, if file matches 'NNN.png' we try to use one piece; otherwise attempt to load file path
        const img = new Image();
        // attempt to use a piece by index if numeric
        const numeric = parseInt(file.replace(/\.png$/i, ''), 10);
        if (!isNaN(numeric)) {
          // map numeric onto available pieces
          const pieces = piecesRef.current || [];
          if (pieces.length) {
            const idx = numeric % pieces.length; // deterministic but simple
            return pieces[idx]; // already a canvas
          }
        }
        img.src = file; // fallback
        return img;
      };

      for (let row = 0; row < CELL_COUNT; row++){
        for (let col = 0; col < CELL_COUNT; col++){
          ['A','B'].forEach(triType => {
            const found = mapping.find(m => m[0] === row && m[1] === col && m[2] === triType);
            let filePath = null;
            if (found) filePath = found[3];
            else if ((piecesRef.current || []).length) {
              // pick random piece
              const arr = piecesRef.current; filePath = null; // will use direct canvas below
            }

            if (!filePath && (piecesRef.current || []).length === 0) return;

            let imgOrCanvas = null;
            if (filePath) imgOrCanvas = getImg(filePath); else imgOrCanvas = piecesRef.current[Math.floor(Math.random() * piecesRef.current.length)];

            const rot = getRotationCW(row, col, triType === 'A' ? 0 : 1);
            // draw: if canvas, draw directly; if Image, wait for load
            if (imgOrCanvas instanceof HTMLCanvasElement) {
              sctx.save();
              const w = imgOrCanvas.width; const h = imgOrCanvas.height;
              const x = col * CELL_SIZE + Math.floor((CELL_SIZE - w)/2);
              const y = row * CELL_SIZE + Math.floor((CELL_SIZE - h)/2);
              sctx.translate(x + w/2, y + h/2);
              sctx.rotate(rot * Math.PI/180);
              sctx.drawImage(imgOrCanvas, -w/2, -h/2);
              sctx.restore();
            } else {
              imgOrCanvas.onload = () => {
                sctx.save();
                const w = imgOrCanvas.width; const h = imgOrCanvas.height;
                const x = col * CELL_SIZE + Math.floor((CELL_SIZE - w)/2);
                const y = row * CELL_SIZE + Math.floor((CELL_SIZE - h)/2);
                sctx.translate(x + w/2, y + h/2);
                sctx.rotate(rot * Math.PI/180);
                sctx.drawImage(imgOrCanvas, -w/2, -h/2);
                sctx.restore();
              };
              imgOrCanvas.onerror = () => { /* ignore missing */ };
            }
          });
        }
      }

      // apply overlays (best-effort: will draw if file available in public)
      overlays.forEach(([letter, px, py]) => {
        const overlayImg = new Image(); overlayImg.src = `${letter}.png`;
        overlayImg.onload = () => {
          const ow = overlayImg.width; const oh = overlayImg.height;
          const cx = Math.round(SHEET_SIZE * (px/100)); const cy = Math.round(SHEET_SIZE * (py/100));
          sctx.drawImage(overlayImg, cx - ow/2, cy - oh/2);
        };
      });

      // download
      sheet.toBlob(blob => { if (!blob) return; const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href); });
    };

    createSheet(TRIANGLE_MAPPING_RED, OVERLAY_RED, 'RED.png');
    createSheet(TRIANGLE_MAPPING_GREEN, OVERLAY_GREEN, 'GREEN.png');
  }

  return (
    <div style={{fontFamily: 'sans-serif', padding: 12}}>
      <h2>Triangulator (Web) — Fixed clipping bug</h2>
      <div style={{display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8}}>
        <input type="file" accept="image/*" onChange={handleFile} />
        <button onClick={onExportClick}>Cut this part</button>
        <button onClick={generateSheets}>Generate sheets</button>
        <label style={{display:'flex', alignItems:'center', gap:8}}>Rotate:
          <input type="range" min="-180" max="180" value={rotation} onChange={e => { setRotation(Number(e.target.value)); draw(); }} />
        </label>
      </div>
      <div style={{border: '1px solid #333', width: CANVAS_SIZE, height: CANVAS_SIZE, overflow: 'hidden'}}>
        <canvas
          ref={canvasRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          style={{display:'block', background:'#222', cursor: dragStart ? 'grabbing' : 'grab'}}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onWheel={onWheel}
        />
      </div>
      <div style={{marginTop:8}}>Mask {maskId} — index {currentMaskIndex+1}/{maskSequence.length}</div>
    </div>
  );
}
