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
const TRIANGLE_MAPPING_RED = [     
    [0, 0, "B", 816], [0, 0, "A", 815],
    [0, 1, "A", 807], [0, 1, "B", 806],
    [0, 2, "B", 414], [0, 2, "A", 413],
    [0, 3, "A", 415],
    [0, 4, "A", 409],
    [0, 5, "A", 407], [0, 5, "B", 406],
    [0, 6, "B", 702], [0, 6, "A", 831],
    [0, 7, "A", 825], [0, 7, "B", 824],
    [1, 0, "A", 216],
    [1, 2, "A", 420], [1, 2, "B", 217],
    [1, 3, "B", 222],
    [1, 4, "B", 106],
    [1, 5, "B", 114], [1, 5, "A", 402],
    [1, 6, "A", 706],
    [2, 0, "B", 422], [2, 0, "A", 423],
    [2, 1, "A", 421],
    [2, 4, "B", 220], [2, 4, "A", 221],
    [2, 5, "A", 219], [2, 5, "B", 218],
    [2, 6, "B", 115], [2, 6, "A", 401],
    [2, 7, "A", 403], [2, 7, "B", 404],
    [3, 0, "A", 416], [3, 0, "B", 709],
    [3, 1, "B", 708],
    [3, 2, "B", 302],
    [3, 4, "A", 215], [3, 4, "B", 214],
    [3, 5, "B", 212], [3, 5, "A", 213],
    [3, 6, "A", 116], [3, 6, "B", 707],
    [3, 7, "A", 408],
    [4,0,"B",813], [4,0,"A",117],
    [4,1,"A",118], [4,1,"B",119],
    [4,2,"B",121], [4,2,"A",120],
    [4,3,"A",122], [4,3,"B",814],
    [4,4,"B",822], [4,4,"A",209],
    [4,5,"A",207], [4,5,"B",206],
    [4,6,"B",712], [4,6,"A",711],
    [4,7,"B",823],
    [5,0,"A",805], [5,0,"B",804],
    [5,1,"B",802], [5,1,"A",127],
    [5,2,"A",128], [5,2,"B",803],
    [5,3,"B",811], [5,3,"A",812],
    [5,4,"A",820], [5,4,"B",821],
    [5,5,"B",827], [5,5,"A",202],
    [5,6,"B",828],
    [5,7,"B",830], [5,7,"A",829],
    [6,0,"A",518],
    [6,1,"A",516],
    [6,2,"B",129], [6,2,"A",801],
    [6,3,"A",809], [6,3,"B",810],
    [6,4,"B",818], [6,4,"A",819],
    [6,5,"A",826], [6,5,"B",201],
    [6,6,"A",510],
    [6,7,"A",505],
    [7,1,"B",515],
    [7,2,"A",131], [7,2,"B",130],
    [7,3,"B",123], [7,3,"A",808],
    [7,4,"A",817], [7,4,"B",208],
    [7,5,"B",204], [7,5,"A",203],
    [7,6,"B",511] ];
const TRIANGLE_MAPPING_GREEN = [
    [0,0,"A",509],
    [0,1,"A",507], [0,1,"B",506],
    [0,3,"B",303],
    [0,4,"B",608],
    [0,5,"B",512],
    [0,6,"B",104], [0,6,"A",105],
    [0,7,"A",112], [0,7,"B",113],
    [1,1,"A",502],
    [1,3,"A",301],
    [1,4,"A",604], [1,4,"B",603],
    [1,5,"B",601], [1,5,"A",513],
    [1,6,"A",102], [1,6,"B",103],
    [1,7,"B",110], [1,7,"A",111],
    [2,1,"B",501],
    [2,2,"B",611], [2,2,"A",610],
    [2,3,"A",605], [2,3,"B",308],
    [2,4,"A",701],
    [2,5,"A",704], [2,5,"B",514],
    [2,6,"B",602], [2,6,"A",101],
    [2,7,"A",108], [2,7,"B",109],
    [3,0,"B",508],
    [3,1,"B",504], [3,1,"A",503],
    [3,2,"A",612], [3,2,"B",314],
    [3,3,"B",310], [3,3,"A",309],
    [3,5,"A",517],
    [3,6,"A",606], [3,6,"B",607],
    [3,7,"B",609], [3,7,"A",107],
    [4,5,"A",211], [4,5,"B",613],
    [4,6,"A",424],
    [4,7,"A",418], [4,7,"B",705],
    [5,2,"A",619], [5,2,"B",618],
    [5,3,"B",616], [5,3,"A",617],
    [5,4,"A",615], [5,4,"B",205],
    [5,5,"B",210], [5,5,"A",614],
    [5,7,"A",703],
    [6,0,"B",126],
    [6,2,"B",312], [6,2,"A",311],
    [6,3,"A",313], [6,3,"B",132],
    [6,5,"A",306], [6,5,"B",307],
    [6,7,"B",412],
    [7,0,"A",124],
    [7,2,"A",315], [7,2,"B",419],
    [7,3,"B",417], [7,3,"A",125],
    [7,5,"B",304], [7,5,"A",305],
    [7,6,"A",710], [7,6,"B",405],
    [7,7,"B",410], [7,7,"A",411] ];
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
  const originalImgRef = useRef(null); // 👈 ORYGINALNE ZDJĘCIE (DO CIĘCIA)
  const piecesRef = useRef({});
const circleImgRef = useRef(null);

const CIRCLE_ORIGINAL_CANVAS = 1200;

const circlePointsPerMask = {
  1: [[510,174],[210,474],[510,726],[774,474],[726,426]],
  2: [[624,360],[324,840]],
  3: [[876,540],[660,624]],
  4: [[324,360],[624,360],[624,576],[540,576],[324,840]],
  5: [[576,576]],
  6: [[360,324],[576,540],[540,624],[840,624]],
  7: [[540,576],[540,624],[576,660]],
  8: [[210,426],[210,474],[774,426],[774,474],[726,510],[510,726]]
};

  const [maskSequence, setMaskSequence] = useState([1]);
  const [currentMaskIndex, setCurrentMaskIndex] = useState(0);
  const [maskId, setMaskId] = useState(1);
  const [offset, setOffset] = useState({x:0,y:0});
  const [scale, setScale] = useState(1.0);
  const [rotation, setRotation] = useState(0);
  const [dragStart, setDragStart] = useState(null);

  useEffect(() => {
    // ask user once for number of photos (simple prompt for prototype)
    const n = parseInt(prompt('How many photos? Type how many photos to be used (1–8):', '4') || '4');
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

  img.onload = () => {
    originalImgRef.current = img; // 
    imgRef.current = img;         // 
    draw();
  };

  img.onerror = () => alert('Could not load image');
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

    // ===== draw circle points for current mask =====
    const pts = circlePointsPerMask[maskId];
    if (pts && pts.length) {
      const ctx = canvas.getContext('2d');
      const scale = CANVAS_SIZE / CIRCLE_ORIGINAL_CANVAS;

      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';

      pts.forEach(([x, y]) => {
        const px = Math.round(x * scale);
        const py = Math.round(y * scale);
        ctx.beginPath();
        ctx.arc(px, py, 12, 0, Math.PI * 2);
        ctx.fill();
      });

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

function renderOriginalToWorkingCanvas() {
  const img = originalImgRef.current;
  if (!img) return null;

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const w = img.width * scale;
  const h = img.height * scale;

  ctx.save();
  ctx.translate(canvas.width / 2 + offset.x, canvas.height / 2 + offset.y);
  ctx.rotate(-rotation * Math.PI / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.restore();

  return canvas;
}

  function onMouseDown(e){ setDragStart({x:e.clientX, y:e.clientY}); }
  function onMouseMove(e){ if (!dragStart) return; const dx = e.clientX - dragStart.x; const dy = e.clientY - dragStart.y; setOffset(prev => ({x: prev.x + dx, y: prev.y + dy})); setDragStart({x: e.clientX, y: e.clientY}); }
  function onMouseUp(){ setDragStart(null); }
  function onWheel(e){ e.preventDefault(); const factor = 1 + e.deltaY * -0.001; setScale(prev => Math.max(0.1, Math.min(5.0, prev * factor))); }

// cutting logic — Python-compatible triangle numbering
async function cutImageIntoTrianglesFromCanvas(
  baseCanvas,
  maskPoly,
  gridCell = GRID_CELL,
  exportSize = EXPORT_SIZE
) {
  if (!baseCanvas) return {};

  const W = baseCanvas.width;
  const H = baseCanvas.height;
  const cols = Math.ceil(W / gridCell);
  const rows = Math.ceil(H / gridCell);

  const piecesById = {};
  let localIndex = 1;              // 1,2,3...
  const currentMaskId = maskId;    // 1,2,3...

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {

      const x0 = c * gridCell;
      const y0 = r * gridCell;
      const x1 = Math.min((c + 1) * gridCell, W);
      const y1 = Math.min((r + 1) * gridCell, H);
      const x1a = x1 - 1;
      const y1a = y1 - 1;

      const flip = (r + c) % 2 === 1;

      const triA = !flip
        ? [[x0,y0],[x1a,y0],[x1a,y1a]]
        : [[x0,y0],[x1a,y0],[x0,y1a]];

      const triB = !flip
        ? [[x0,y0],[x1a,y1a],[x0,y1a]]
        : [[x1a,y0],[x1a,y1a],[x0,y1a]];

      const tris = [[0, triA], [1, triB]];

      for (const [triIndex, tri] of tris) {

        if (triangleCoverage(tri, maskPoly) < MIN_MASK_COVERAGE) continue;

        const clipped = clipPolygon(tri, maskPoly);
        if (!clipped || clipped.length < 3) continue;

        const xs = clipped.map(p => p[0]);
        const ys = clipped.map(p => p[1]);
        const bx0 = Math.floor(Math.min(...xs));
        const by0 = Math.floor(Math.min(...ys));
        const bx1 = Math.ceil(Math.max(...xs));
        const by1 = Math.ceil(Math.max(...ys));

        const w = bx1 - bx0;
        const h = by1 - by0;

        const temp = document.createElement('canvas');
        temp.width = w;
        temp.height = h;
        const tctx = temp.getContext('2d');

        tctx.drawImage(baseCanvas, bx0, by0, w, h, 0, 0, w, h);

        const mask = document.createElement('canvas');
        mask.width = w;
        mask.height = h;
        const mctx = mask.getContext('2d');

        mctx.beginPath();
        mctx.moveTo(clipped[0][0] - bx0, clipped[0][1] - by0);
        for (let i = 1; i < clipped.length; i++) {
          mctx.lineTo(clipped[i][0] - bx0, clipped[i][1] - by0);
        }
        mctx.closePath();
        mctx.fillStyle = 'rgba(0,0,0,1)';
        mctx.fill();

        tctx.globalCompositeOperation = 'destination-in';
        tctx.drawImage(mask, 0, 0);
        tctx.globalCompositeOperation = 'source-over';

        const out = document.createElement('canvas');
        out.width = exportSize;
        out.height = exportSize;
        out.getContext('2d').drawImage(temp, 0, 0, exportSize, exportSize);

        const angleCW = getRotationCW(r, c, triIndex);
        const angle = cwToPillowCCW(angleCW);

        const rot = document.createElement('canvas');
        rot.width = exportSize;
        rot.height = exportSize;
        const rctx = rot.getContext('2d');

        rctx.translate(exportSize/2, exportSize/2);
        rctx.rotate(angle * Math.PI/180);
        rctx.drawImage(out, -exportSize/2, -exportSize/2);

        const pieceId = currentMaskId * 100 + localIndex;
        piecesById[pieceId] = rot;
        localIndex++;
      }
    }
  }

  return piecesById;
}


async function onExportClick() {
  const canvas = canvasRef.current;
  if (!canvas) { alert('Canvas not ready'); return; }
  const maskPoly = maskPolyRef.current || [];
  const workingCanvas = renderOriginalToWorkingCanvas();
  if (!workingCanvas) {
    alert('Original image not ready');
    return;
  }

  const pieces = await cutImageIntoTrianglesFromCanvas(
    workingCanvas,
    maskPoly
  );

  if (!pieces || Object.keys(pieces).length === 0) { 
    alert('No triangles produced (maybe mask coverage too small)'); 
    return; 
  }

  // dodajemy nowe trójkąty do istniejących
  piecesRef.current = { ...piecesRef.current, ...pieces };

  // przechodzimy do następnej maski
  const nextIndex = currentMaskIndex + 1;
  if (nextIndex < maskSequence.length) {
    const id = maskSequence[nextIndex]; 
    setCurrentMaskIndex(nextIndex); 
    setMaskId(id); 
    maskPolyRef.current = MASKS[id]; 
    imgRef.current = null; 
    draw(); 
    alert('Mask exported. Load next photo.');
  } else {
    alert('All masks processed. You can now generate sheets.');
  }
}

// ================= Export & Sheets =================

function generateSheets() {
    const getImgById = (id) => {
        const pieces = piecesRef.current || {};
        return pieces[id] || null;
    };
    const SHEET_SIZE = 1200;
    const CELL_COUNT = 8;
    const CELL_SIZE = Math.floor(SHEET_SIZE / CELL_COUNT);

    const createSheet = (mapping, overlays, filename) => {
        const allPieceIds = Object.keys(piecesRef.current || {}).map(Number);
        const getRandomPiece = () => {
            if (!allPieceIds.length) return null;
            const id = allPieceIds[Math.floor(Math.random() * allPieceIds.length)];
            return piecesRef.current[id] || null;
        };

        const sheet = document.createElement('canvas');
        sheet.width = SHEET_SIZE;
        sheet.height = SHEET_SIZE;
        const sctx = sheet.getContext('2d');
        sctx.fillStyle = 'white';
        sctx.fillRect(0, 0, SHEET_SIZE, SHEET_SIZE);

        for (let row = 0; row < CELL_COUNT; row++) {
            for (let col = 0; col < CELL_COUNT; col++) {
                ['A', 'B'].forEach(triType => {
                    const triIndex = triType === 'A' ? 0 : 1;
                    const rotCW = getRotationCW(row, col, triIndex);
                    let img = null;

                    const found = mapping.find(m => m[0] === row && m[1] === col && m[2] === triType);
                    if (found) {
                        img = getImgById(found[3]);
                    }

                    if (!img) {
                        img = getRandomPiece();
                        if (!img) return;
                    }

                    const w = img.width;
                    const h = img.height;
                    const x = col * CELL_SIZE + Math.floor((CELL_SIZE - w) / 2);
                    const y = row * CELL_SIZE + Math.floor((CELL_SIZE - h) / 2);

                    sctx.save();
                    sctx.translate(x + w / 2, y + h / 2);
                    sctx.rotate(rotCW * Math.PI / 180);
                    sctx.drawImage(img, -w / 2, -h / 2);
                    sctx.restore();
                });
            }
        }

        // Dodajemy PNG overlays + zawsze comR / comG
        const overlayList = [...overlays];
        if (filename === 'RED.png') overlayList.push(['comR', 50, 50]);
        if (filename === 'GREEN.png') overlayList.push(['comG', 50, 50]);

        const overlayPromises = overlayList.map(([name, px, py]) => {
            return new Promise(resolve => {
                const img = new Image();
                img.onload = () => {
                    const ow = img.width;
                    const oh = img.height;
                    const cx = Math.round(SHEET_SIZE * (px / 100));
                    const cy = Math.round(SHEET_SIZE * (py / 100));
                    sctx.drawImage(img, cx - ow / 2, cy - oh / 2);
                    resolve();
                };
                img.onerror = () => resolve();
                img.src = `${name}.png`;
            });
        });

        Promise.all(overlayPromises).then(() => {
            sheet.toBlob(blob => {
                if (!blob) return;
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = filename;
                a.click();
                URL.revokeObjectURL(a.href);
            });
        });
    };

    createSheet(TRIANGLE_MAPPING_RED, OVERLAY_RED, 'RED.png');
    createSheet(TRIANGLE_MAPPING_GREEN, OVERLAY_GREEN, 'GREEN.png');
}

const [processedMasks, setProcessedMasks] = useState(0);

async function onExportClick() {
  const workingCanvas = renderOriginalToWorkingCanvas();
  if (!workingCanvas) {
    alert('Original image not ready');
    return;
  }

  const pieces = await cutImageIntoTrianglesFromCanvas(
    workingCanvas,
    maskPolyRef.current
  );

  if (!pieces || Object.keys(pieces).length === 0) {
    alert('No triangles produced');
    return;
  }

  // dodajemy wycięte trójkąty
  piecesRef.current = { ...piecesRef.current, ...pieces };

  // zwiększamy licznik wyciętych masek
  setProcessedMasks(prev => prev + 1);

  const nextIndex = currentMaskIndex + 1;
  if (nextIndex < maskSequence.length) {
    // przechodzimy do następnej maski
    const nextMaskId = maskSequence[nextIndex];
    setCurrentMaskIndex(nextIndex);
    setMaskId(nextMaskId);
    maskPolyRef.current = MASKS[nextMaskId];
    imgRef.current = null; // wymuszamy nowe zdjęcie
    alert('Mask exported. Load next photo.');
  } else {
    // ostatnia maska przetworzona
    alert('All masks processed. You can now generate sheets.');
  }
}

return (
  <div style={{fontFamily: 'sans-serif', padding: 12}}>
    <h2>Triangulator (Web) — Fixed clipping bug</h2>
    <div style={{display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8}}>
      <input type="file" accept="image/*" onChange={handleFile} />

      <button
        onClick={onExportClick}
        disabled={processedMasks >= maskSequence.length}
      >
        Cut this part
      </button>

      <button
        onClick={generateSheets}
        disabled={processedMasks < maskSequence.length}
      >
        Generate sheets
      </button>

      <label style={{display:'flex', alignItems:'center', gap:8}}>
        Rotate:
        <input
          type="range"
          min="-180"
          max="180"
          value={rotation}
          onChange={e => { setRotation(Number(e.target.value)); draw(); }}
        />
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

    <div style={{marginTop:8}}>
      Mask {maskId} — index {currentMaskIndex + 1}/{maskSequence.length}
    </div>
  </div>
);
}